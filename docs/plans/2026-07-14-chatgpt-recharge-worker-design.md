# ChatGPT 自助充值核心脚本设计

日期：2026-07-14

## 目标

构建一个由线上系统启动的单订单长驻 Node.js 子进程。线上系统只向子进程提交订单 ID 和用户 access token；子进程从本地配置读取套餐、代理与运营方银行卡池，自动创建 ChatGPT checkout、完成 Stripe 支付、等待并处理 3DS、核验订阅生效、关闭自动续订，最终以 JSON Lines 输出阶段状态。

## 范围

- 固定地区 `PH`、币种 `PHP`。
- 固定代理 `http://127.0.0.1:7890`，允许从配置覆盖。
- 套餐由本地 `payment.json` 配置。
- 支持一张或多张运营方银行卡以及跨进程并发锁。
- 每个订单使用独立子进程和 Playwright 浏览器上下文。
- 用户侧只提交 access token；3DS OTP 由后台管理端经同一子进程的标准输入提交。
- Stripe 扣款成功、ChatGPT 订阅更新、自动续订关闭分别输出状态。
- 取消续订真实请求由后续取消操作 HAR 补齐；当前先实现适配器契约、状态机、复核逻辑和模拟测试。

## 架构

采用 HTTP 与 Playwright 混合执行：

```text
线上充值系统
  | stdin: START / 3DS_CODE / CANCEL
  | stdout: JSONL 业务事件
  v
recharge_worker.mjs
  |- ProtocolController
  |- PaymentConfigStore / CardPool
  |- ChatGptCheckoutClient
  |- StripeBrowserExecutor
  |- ThreeDsController
  |- SubscriptionVerifier
  |- CancellationAdapter
  `- OrderStateMachine
```

ChatGPT checkout 创建、订阅查询和续订状态复核走 HTTP；Stripe Elements、卡片填写、支付确认和 3DS challenge 走 Playwright。这样减少对 ChatGPT 页面结构的依赖，同时保留 Stripe.js 生成动态支付上下文的能力。

## 输入输出协议

子进程启动后从标准输入接收一行 JSON：

```json
{"type":"start","order_id":"ORDER_ID","access_token":"ACCESS_TOKEN"}
```

3DS 等待期间接收：

```json
{"type":"3ds_code","order_id":"ORDER_ID","code":"OTP_CODE"}
```

线上系统也可发送：

```json
{"type":"cancel","order_id":"ORDER_ID"}
```

标准输出仅承载单行 JSON 业务事件；诊断日志写入标准错误。事件至少包含 `event`、`order_id`、`stage`、`retryable`、`message` 和 `timestamp`。access token、完整卡号、CVC、OTP、Cookie、checkout client secret 与 Stripe secret 不进入日志。

## 配置与卡池

`payment.json` 包含：

- `plan`：例如 `chatgptplusplan`。
- `country`：固定为 `PH`。
- `currency`：固定为 `PHP`。
- `proxy`：默认 `http://127.0.0.1:7890`。
- `cards[]`：卡片 ID、启用状态、最大并发、卡片字段与账单字段。
- `timeouts`：支付、3DS、订阅同步与取消续订等待时间。

卡片选择只考虑启用、未达并发上限且未处于冷却期的条目。每张卡使用跨进程锁。锁和运行统计存放在独立运行目录，不改写支付资料文件。订单事件只记录卡片 ID 和卡号末四位。

## 主流程与状态机

```text
STARTED
  -> TOKEN_VALIDATED
  -> CHECKOUT_CREATED
  -> PAYMENT_SUBMITTED
  |    -> WAITING_3DS -> PAYMENT_SUBMITTED
  |    -> CARD_DECLINED
  |    `-> STRIPE_PAYMENT_SUCCEEDED
  -> SUBSCRIPTION_PENDING
  -> SUBSCRIPTION_UPDATED
  -> CANCELLATION_REQUESTED
  |    `-> PAID_CANCELLATION_PENDING
  -> RENEWAL_DISABLED
  `-> SUCCESS
```

付款前的确定失败可以结束订单。付款提交后的网络超时进入 `PAYMENT_STATUS_UNKNOWN`，只执行 checkout、Stripe 与订阅状态核对；在状态明确前不再次提交银行卡。

## 3DS

Playwright 扫描 Stripe challenge iframe。检测到 OTP 输入型 challenge 时输出 `WAITING_3DS` 并保持浏览器和子进程存活。收到匹配订单 ID 的 `3ds_code` 后填写并提交；验证码被拒时输出 `3DS_CODE_REJECTED` 并继续等待下一条输入。

银行 App 推送或无 OTP 输入框的 challenge 输出 `3DS_MANUAL_ACTION_REQUIRED`，同时保持订单为等待态。3DS 等待超时输出可恢复状态并保留非敏感订单快照。

## 订阅核验与取消续订

Stripe 确认扣款后立即输出 `STRIPE_PAYMENT_SUCCEEDED`，随后轮询 ChatGPT 账户接口，确认目标套餐已生效后输出 `SUBSCRIPTION_UPDATED`。

订阅生效后调用 `CancellationAdapter.requestCancellation`。最终复核使用账户响应中的以下语义字段：

- `last_active_subscription.will_renew === false`
- `entitlement.cancels_at` 已设置
- 目标套餐在当前周期仍有效

满足条件后输出 `RENEWAL_DISABLED` 和 `SUCCESS`。取消请求暂时失败时输出 `PAID_CANCELLATION_PENDING`，后续只重试取消和复核，不重新发起支付。

当前 HAR 已覆盖复核字段，但没有取消请求。适配器先提供模拟实现和 fixture 测试；补充取消操作 HAR 后实现真实请求提取、认证调用和响应解析，外部 JSONL 协议保持不变。

## 幂等与恢复

- `order_id` 是全流程幂等键。
- 同一订单只允许一个活动执行器。
- 创建 checkout、提交支付和取消续订分别记录阶段检查点。
- 进程异常退出后，恢复流程先查询支付和订阅状态，再决定恢复阶段。
- 已出现扣款成功证据的订单跳过 checkout 和支付提交。
- `PAID_CANCELLATION_PENDING` 订单只进入取消续订适配器。

## 错误分类

- `TOKEN_INVALID`：access token 校验失败。
- `NO_CARD_AVAILABLE`：卡池暂时没有可用条目。
- `CHECKOUT_FAILED`：checkout 创建失败。
- `CARD_DECLINED`：发卡行或 Stripe 明确拒付。
- `WAITING_3DS`：等待管理端 OTP。
- `3DS_CODE_REJECTED`：OTP 被 challenge 页面拒绝。
- `PAYMENT_STATUS_UNKNOWN`：支付提交后状态暂时不明确。
- `SUBSCRIPTION_PENDING`：扣款成功，订阅同步中。
- `PAID_CANCELLATION_PENDING`：订阅生效，取消续订待完成。
- `SUCCESS`：订阅有效且自动续订已关闭。

## 测试

1. 单元测试：配置解析、卡池选择与锁、JSONL 协议、状态转换、脱敏、幂等判断。
2. HAR fixture：checkout 提取、请求构造、代理、订阅与续订状态解析。
3. 本地浏览器 fixture：Stripe Elements、卡片拒付、OTP 3DS iframe、OTP 重试、支付成功页。
4. 子进程集成：stdin/stdout、并发卡锁、超时、取消命令和异常恢复。
5. 取消续订适配器：当前使用模拟响应；后续 HAR 加入真实请求 fixture。

自动测试不产生真实扣款。真实验收按单个订单执行，并依次核对 Stripe 成功、订阅生效和续订关闭三个阶段。

## 验收条件

- 线上系统仅通过 stdin 提交订单 ID 和 access token 即可启动订单。
- 普通支付全程自动完成。
- 3DS 时进程保持等待，后台 OTP 可以恢复原任务。
- Stripe 扣款成功和 ChatGPT 订阅生效分阶段输出。
- 最终 `SUCCESS` 只在自动续订已关闭后出现。
- 网络超时和进程恢复不会触发重复支付。
- 多进程不会超过单卡并发限制。
- 业务事件和诊断日志不泄露支付与认证秘密。
