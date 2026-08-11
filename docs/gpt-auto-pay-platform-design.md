# gpt-auto-pay 平台设计开发文档

日期：2026-08-11

## 1. 项目定位

`gpt-auto-pay` 是一个单 VPS 部署的兑换码驱动充值平台。

平台由两个前端、一个主后端、一个执行器体系组成：

- 用户前台：用户输入兑换码并查看订单摘要状态。
- 管理员后台：管理员管理兑换码、订单、卡池、账单地址、代理、队列、日志和备份。
- 主后端：提供用户 API、管理员 API、状态流、兑换码模块、订单队列和配置管理。
- 执行器：负责提链、直卡、点击付款、结果识别、重试与异常恢复。

第一版部署在一台 VPS 上，内部按模块拆分，但不拆成多台机器或多套服务。

## 2. 已确认业务规则

### 2.1 前台与后台

- 用户前台和管理员后台使用不同域名。
- 用户前台无需登录。
- 管理员后台使用独立登录体系。
- 管理员账号第一版只有一个，不允许删除。
- 管理员登录不限制 IP。
- 管理员登录使用强密码。
- 2FA 接口预留，默认关闭。

### 2.2 兑换码

- 兑换码是一次性的。
- 兑换码不绑定邮箱、用户、设备或其他身份信息。
- 兑换码只表示套餐类型。
- 支持套餐类型：
  - `go`
  - `plus`
  - `pro5x`
  - `pro20x`
- 兑换码格式使用“套餐前缀 + 随机码”。
- 支持批量生成。
- 支持批次管理。
- 批次支持备注。
- 渠道字段可选，默认关闭。
- 支持按状态导出兑换码。
- 导出格式支持：
  - `txt`
  - `csv`
  - `json`
- 兑换码导出操作写入审计日志。

### 2.3 兑换码状态

兑换码状态固定为：

```text
unused        可用
locked        已提交，正在处理
used          已成功使用
unavailable   VPS 重启或进程异常后待管理员核对
disabled      管理员禁用
deleted       软删除
```

用户提交 `unused` 兑换码后，后端必须原子地将其改为 `locked`。

同一个兑换码在 `locked` 状态期间不能重复提交。

流程成功后，兑换码改为 `used`。

流程失败后，兑换码返还为 `unused`。

VPS 重启或运行进程异常时，正在运行的兑换码不自动返还，改为 `unavailable`，等待管理员核对。

### 2.4 用户可见状态

用户前台只显示简短状态和摘要。

用户可以看到：

```text
兑换码校验中
排队中
正在处理
Go 充值成功
Plus 充值成功
Pro 5x 充值成功
Pro 20x 充值成功
充值失败
```

失败文案使用后台可配置字段。

默认失败文案：

```text
充值失败，兑换码已返还，请稍后重试或联系管理员。
```

用户前台不显示卡、代理、提链、直卡、Stripe、浏览器、付款失败详情等内部信息。

### 2.5 队列

- 使用普通 FIFO 队列。
- 先提交的订单先运行。
- 后提交的订单后运行。
- 管理员后台支持暂停队列。
- 管理员后台支持恢复队列。
- 管理员后台支持手动重新入队。
- 全局并发由管理员配置。
- 默认并发为 `1`。
- 并发配置范围为 `1` 到 `1000`。
- 实际并发仍受 VPS 性能、卡池、代理池和浏览器资源限制。

### 2.6 重试策略

重试策略由管理员配置。

核心配置项：

```text
max_proxy_attempts_per_card
allow_card_switch
max_card_switches
```

示例：

```text
每张卡最多尝试 4 个代理 IP
允许换卡
最多换 2 张卡
```

执行顺序：

```text
card_1 + proxy_1
card_1 + proxy_2
card_1 + proxy_3
card_1 + proxy_4
card_2 + proxy_1
card_2 + proxy_2
...
```

如果在管理员配置的规则内仍失败：

- 订单标记失败。
- 兑换码返还为 `unused`。
- 用户前台显示统一失败文案。
- 管理员后台记录详细失败原因。

### 2.7 成功判定

只有识别到实际订阅成功，才算成功。

成功信号包括但不限于：

```text
已订阅
订阅成功
付款成功
支付成功
Payment successful
subscription active
```

卡成功次数只在订阅成功后加一。

点击付款、提交付款、付款处理中均不计入卡成功次数。

### 2.8 套餐配置

每个套餐单独配置。

每个套餐可以配置：

```text
套餐类型
展示名称
默认付款地区
默认付款币种
checkout 模板
提链代理组
直卡代理组
卡组优先级
账单地址组
失败文案覆盖
重试策略覆盖
是否启用
备注
```

套餐配置采用“全局默认 + 套餐覆盖”模式。

### 2.9 卡池

卡和账单地址不强绑定。

卡池保存卡相关信息：

```text
卡号
有效期月
有效期年
CVC
卡组
最大订阅成功次数
当前订阅成功次数
备注
状态
```

卡状态：

```text
enabled   自动选择时可用
standby   备用标记，不参与自动选择，只给管理员手动指定
disabled  不可用
deleted   软删除
```

卡信息列表默认打码。

管理员点开详情可以查看完整卡信息。

查看完整卡信息写入审计日志。

完整卡信息加密落库。

加密密钥放在 VPS 环境变量：

```text
APP_SECRET_KEY
```

数据库不保存加密密钥。

VPS 迁移时必须同时迁移数据库和 `APP_SECRET_KEY`。

### 2.10 卡选择规则

套餐可以选择多个卡组。

卡组按管理员配置的优先级使用。

优先级数字越小，越先使用。

同一个卡组内，卡也支持优先级。

卡选择规则：

```text
优先使用 priority 小的卡
priority 相同则轮换
standby 卡不参与自动选择
disabled 卡不参与选择
deleted 卡不参与选择
success_count >= max_success_count 的卡不参与选择
```

### 2.11 账单地址

账单地址独立保存，不和卡强绑定。

账单地址字段：

```text
姓名
国家
州/省
城市
地址
邮编
地址组
优先级
备注
状态
```

账单地址状态：

```text
enabled
disabled
deleted
```

### 2.12 账单地址选择规则

套餐选择账单地址组。

账单地址组内支持优先级。

账单地址选择规则：

```text
优先使用 priority 小的地址
priority 相同则轮换
disabled 地址不参与选择
deleted 地址不参与选择
```

### 2.13 代理

提链代理池和直卡代理池分开。

两个进程分别调代理商 API。

同时保留复用同一个 IP 的能力。

通过代理商 API 的 `session_id` 或等价机制实现同 IP 复用。

代理模块需要支持：

```text
提链代理组
直卡代理组
代理商 API 适配器
session 复用
代理获取日志
代理失败日志
代理重试
```

代理商 API 文档后续提供。

第一版应保留代理适配器边界，避免后续接入时改动订单和执行器核心逻辑。

### 2.14 通知

第一版不实现邮件通知。

通知模块作为后续功能预留。

后续通知模块目标：

```text
SMTP
邮件服务商 API
企业微信
QQ
微信
```

第一版管理员后台仍要显示全部实时状态。

### 2.15 实时状态

管理员后台需要实时查看：

```text
当前队列
正在运行的订单
每个订单实时日志
邮件发送状态预留
代理获取状态
卡池状态
系统运行状态
执行器进程状态
```

实时状态使用 SSE。

按钮操作仍使用普通 HTTP API。

### 2.16 限速

用户前台无登录，因此必须做 IP 限速。

限速规则：

```text
提交兑换码：同 IP 每分钟 5 次
同一个兑换码：30 秒内只能提交 1 次
查询订单状态：同 IP 每分钟 5 次
```

验证码接口保留，默认关闭。

部署在 Cloudflare 后面时，真实 IP 优先读取：

```text
CF-Connecting-IP
X-Forwarded-For
remoteAddress
```

### 2.17 备份

需要备份。

第一版备份规则：

```text
VPS 本地每日自动备份
保留最近 30 份每日备份
管理员后台支持手动下载备份
手动下载不影响自动备份保留规则
```

备份内容至少包括：

```text
SQLite 数据库
运行配置
加密字段所需元信息
```

备份不包含 `APP_SECRET_KEY`。

管理员必须单独保存 `APP_SECRET_KEY`。

没有 `APP_SECRET_KEY` 时，备份中的加密卡信息无法解密。

### 2.18 删除

使用软删除。

允许软删除：

```text
兑换码
订单
卡
日志
批次
```

不允许删除：

```text
管理员账号
审计日志
```

软删除字段：

```text
deleted_at
deleted_by
delete_reason
```

恢复规则：

```text
兑换码、卡、批次支持恢复
订单和运行日志只隐藏，不建议恢复
审计日志不允许删除
```

## 3. 总体架构

```text
用户浏览器
  |
  v
用户前台域名
  |
  v
public_frontend
  |
  v
backend_api / public API
  |
  v
redeem_module
  |
  v
order_queue
  |
  v
runner_module
  |----> proxy_module
  |----> card_module
  |----> billing_module
  |
  v
order result
  |
  v
public_frontend summary


管理员浏览器
  |
  v
管理员后台域名
  |
  v
admin_frontend
  |
  |---- HTTP API 操作
  |---- SSE 实时状态
  |
  v
backend_api / admin API
  |
  |---- redeem_module
  |---- order_queue
  |---- runner_module
  |---- card_module
  |---- billing_module
  |---- proxy_module
  |---- backup_module
  |---- audit_module
```

## 4. 模块设计

### 4.1 public_frontend

职责：

- 展示原站外貌。
- 提供兑换码输入框。
- 提交兑换码。
- 展示订单摘要状态。
- 订单运行中轮询状态。
- 页面刷新后支持通过 locked 兑换码恢复查询当前订单。

不负责：

- 不展示内部执行细节。
- 不展示卡信息。
- 不展示代理信息。
- 不展示管理员日志。
- 不处理套餐业务逻辑。

页面建议：

```text
/
/recharge
/status/:order_id
```

用户提交兑换码后的前台流程：

```text
输入兑换码
  -> POST /api/public/redeem
  -> 返回 order_id + plan_type + status
  -> 前端轮询 GET /api/public/orders/:order_id
  -> 显示摘要状态
```

### 4.2 admin_frontend

职责：

- 管理员登录。
- 展示仪表盘。
- 管理兑换码。
- 批量生成兑换码。
- 导出兑换码。
- 管理批次。
- 管理套餐配置。
- 管理卡组。
- 管理卡。
- 管理账单地址组。
- 管理账单地址。
- 管理代理配置。
- 查看订单。
- 查看运行日志。
- 查看审计日志。
- 暂停/恢复队列。
- 重新入队订单。
- 下载备份。
- 查看 SSE 实时状态。

建议菜单：

```text
仪表盘
订单队列
兑换码
兑换码批次
套餐配置
卡组
卡池
账单地址组
账单地址
代理配置
运行日志
审计日志
备份
系统设置
```

### 4.3 backend_api

职责：

- 统一 HTTP API。
- 统一鉴权。
- 统一限速。
- 统一错误格式。
- 提供 public API。
- 提供 admin API。
- 提供 SSE 状态流。
- 调用各业务模块。

错误返回格式：

```json
{
  "ok": false,
  "code": "RATE_LIMITED",
  "message": "请求过于频繁，请稍后再试"
}
```

成功返回格式：

```json
{
  "ok": true,
  "data": {}
}
```

### 4.4 redeem_module

职责：

- 生成兑换码。
- 批量生成兑换码。
- 锁定兑换码。
- 返还兑换码。
- 标记兑换码已使用。
- 禁用兑换码。
- 软删除兑换码。
- 恢复兑换码。
- 导出兑换码。
- 管理批次。

兑换码提交必须是原子操作：

```text
UPDATE redeem_codes
   SET status='locked', locked_at=now, locked_order_id=:order_id
 WHERE code_hash=:hash
   AND status='unused'
   AND deleted_at IS NULL
```

如果更新行数为 `1`，说明锁定成功。

如果更新行数为 `0`，需要查询当前状态并返回对应错误。

### 4.5 order_queue

职责：

- 创建订单。
- 入队。
- 出队。
- 控制并发。
- 暂停/恢复。
- 崩溃恢复。
- 重新入队。
- 记录订单状态。

订单状态：

```text
created
queued
running
succeeded
failed
interrupted_review
cancelled
deleted
```

队列控制状态：

```text
running
paused
```

### 4.6 runner_module

职责：

- 根据订单套餐读取套餐配置。
- 获取卡。
- 获取账单地址。
- 获取提链代理。
- 生成付款链接。
- 获取直卡代理。
- 执行直卡。
- 点击付款。
- 监控结果。
- 更新订单状态。
- 更新卡成功次数。
- 更新兑换码状态。
- 写运行日志。

执行器必须支持：

- 可终止。
- 可超时。
- 可记录阶段日志。
- 可记录 attempt。
- 可被队列调度。
- 崩溃后由恢复逻辑接管。

### 4.7 card_module

职责：

- 管理卡组。
- 管理卡。
- 加密保存完整卡信息。
- 列表打码。
- 详情解密。
- 记录查看审计。
- 选择可用卡。
- 更新成功次数。
- 跳过达到成功次数上限的卡。
- 预留卡台 API 适配器。

卡台 API 适配器后续接口：

```text
listCards
getCard
openCard
closeCard
refreshCard
syncCardStatus
```

第一版可先实现手动卡池。

### 4.8 billing_module

职责：

- 管理账单地址组。
- 管理账单地址。
- 根据套餐配置选择账单地址组。
- 按 priority 和轮换规则选择地址。

### 4.9 proxy_module

职责：

- 管理提链代理配置。
- 管理直卡代理配置。
- 调用代理商 API。
- 根据 session_id 复用 IP。
- 记录代理获取状态。
- 记录代理失败。
- 为 runner 提供代理。

代理接口抽象：

```text
getCheckoutProxy(context)
getDirectCardProxy(context)
releaseProxy(proxyLease)
markProxyFailed(proxyLease, reason)
```

### 4.10 backup_module

职责：

- 每日自动备份。
- 清理超过 30 份的自动备份。
- 管理员手动创建备份。
- 管理员下载备份。
- 展示备份列表。

备份文件命名：

```text
backup-YYYYMMDD-HHMMSS.zip
```

备份记录：

```text
backup_id
type
path
size
created_at
created_by
status
error
```

### 4.11 audit_module

职责：

- 记录管理员关键操作。
- 不允许删除。
- 支持查询。
- 支持按管理员、动作、目标、时间过滤。

审计操作包括：

```text
管理员登录
修改密码
查看完整卡信息
新增卡
修改卡
禁用卡
软删除卡
恢复卡
批量生成兑换码
导出兑换码
禁用兑换码
返还兑换码
标记兑换码 used
修改套餐配置
修改代理配置
暂停队列
恢复队列
手动重新入队订单
下载备份
```

审计日志结构：

```json
{
  "id": 1,
  "admin_id": 1,
  "action": "view_card_secret",
  "target_type": "card",
  "target_id": "card_12",
  "ip": "1.2.3.4",
  "user_agent": "Chrome",
  "before": {},
  "after": {},
  "created_at": "2026-08-11T12:00:00Z"
}
```

查看完整卡信息时，不记录完整卡号，只记录发生过查看行为。

## 5. 数据库设计

第一版继续使用 SQLite。

单 VPS 单实例下 SQLite 足够。

如果后续多 VPS 或多实例，需要迁移到 PostgreSQL。

### 5.1 admin_users

```sql
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  last_login_at REAL DEFAULT 0,
  disabled_at REAL DEFAULT 0
);
```

说明：

- 第一版只有一个管理员。
- 不允许删除管理员。
- 可修改密码。
- 可禁用登录，但需要保留恢复入口。

### 5.2 admin_sessions

```sql
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at REAL NOT NULL,
  expires_at REAL NOT NULL,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  FOREIGN KEY(admin_id) REFERENCES admin_users(id)
);
```

### 5.3 redeem_batches

```sql
CREATE TABLE redeem_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT DEFAULT '',
  channel_enabled INTEGER NOT NULL DEFAULT 0,
  channel TEXT DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);
```

### 5.4 redeem_codes

```sql
CREATE TABLE redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  code_display TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  locked_order_id INTEGER DEFAULT 0,
  locked_at REAL DEFAULT 0,
  used_order_id INTEGER DEFAULT 0,
  used_at REAL DEFAULT 0,
  unavailable_at REAL DEFAULT 0,
  unavailable_reason TEXT DEFAULT '',
  disabled_at REAL DEFAULT 0,
  disabled_by INTEGER DEFAULT 0,
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(batch_id) REFERENCES redeem_batches(id)
);
```

索引：

```sql
CREATE INDEX idx_redeem_codes_status ON redeem_codes(status);
CREATE INDEX idx_redeem_codes_batch ON redeem_codes(batch_id);
CREATE INDEX idx_redeem_codes_plan ON redeem_codes(plan_type);
CREATE INDEX idx_redeem_codes_locked_order ON redeem_codes(locked_order_id);
```

说明：

- `code_hash` 用于查询。
- `code_display` 用于管理员导出和查看。
- 如果后续要避免数据库泄漏后直接看到兑换码，可将 `code_display` 也加密保存。

### 5.5 plan_configs

```sql
CREATE TABLE plan_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  payment_country TEXT DEFAULT '',
  payment_currency TEXT DEFAULT '',
  checkout_template_key TEXT DEFAULT '',
  checkout_proxy_group_id INTEGER DEFAULT 0,
  direct_card_proxy_group_id INTEGER DEFAULT 0,
  billing_group_id INTEGER DEFAULT 0,
  failure_message TEXT DEFAULT '',
  max_proxy_attempts_per_card INTEGER NOT NULL DEFAULT 4,
  allow_card_switch INTEGER NOT NULL DEFAULT 0,
  max_card_switches INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
```

### 5.6 plan_card_groups

```sql
CREATE TABLE plan_card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_type TEXT NOT NULL,
  card_group_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at REAL NOT NULL
);
```

说明：

- 套餐可以配置多个卡组。
- `priority` 越小越优先。

### 5.7 card_groups

```sql
CREATE TABLE card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);
```

### 5.8 cards

```sql
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_group_id INTEGER NOT NULL,
  encrypted_number TEXT NOT NULL,
  encrypted_exp_month TEXT NOT NULL,
  encrypted_exp_year TEXT NOT NULL,
  encrypted_cvc TEXT NOT NULL,
  masked_number TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  max_success_count INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  note TEXT DEFAULT '',
  last_used_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(card_group_id) REFERENCES card_groups(id)
);
```

索引：

```sql
CREATE INDEX idx_cards_group_status ON cards(card_group_id, status);
CREATE INDEX idx_cards_priority ON cards(priority, last_used_at);
```

### 5.9 billing_groups

```sql
CREATE TABLE billing_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);
```

### 5.10 billing_addresses

```sql
CREATE TABLE billing_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  state TEXT DEFAULT '',
  city TEXT NOT NULL,
  line1 TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'enabled',
  note TEXT DEFAULT '',
  last_used_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(billing_group_id) REFERENCES billing_groups(id)
);
```

### 5.11 proxy_groups

```sql
CREATE TABLE proxy_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);
```

`kind`：

```text
checkout
direct_card
```

### 5.12 orders

```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  redeem_code_id INTEGER NOT NULL,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  user_ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  public_message TEXT DEFAULT '',
  admin_error TEXT DEFAULT '',
  queued_at REAL DEFAULT 0,
  started_at REAL DEFAULT 0,
  finished_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(redeem_code_id) REFERENCES redeem_codes(id)
);
```

### 5.13 order_attempts

```sql
CREATE TABLE order_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  card_id INTEGER DEFAULT 0,
  billing_address_id INTEGER DEFAULT 0,
  checkout_proxy TEXT DEFAULT '',
  direct_card_proxy TEXT DEFAULT '',
  checkout_proxy_session TEXT DEFAULT '',
  direct_card_proxy_session TEXT DEFAULT '',
  status TEXT NOT NULL,
  stage TEXT DEFAULT '',
  error_code TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  started_at REAL DEFAULT 0,
  finished_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
```

### 5.14 run_logs

```sql
CREATE TABLE run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  attempt_id INTEGER DEFAULT 0,
  level TEXT NOT NULL,
  stage TEXT DEFAULT '',
  message TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}',
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
```

### 5.15 audit_logs

```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  before_json TEXT DEFAULT '{}',
  after_json TEXT DEFAULT '{}',
  created_at REAL NOT NULL,
  FOREIGN KEY(admin_id) REFERENCES admin_users(id)
);
```

### 5.16 system_settings

```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at REAL NOT NULL,
  updated_by INTEGER DEFAULT 0
);
```

建议配置项：

```text
queue.global_concurrency
queue.status
rate_limit.redeem_per_ip_per_minute
rate_limit.same_code_seconds
rate_limit.order_status_per_ip_per_minute
captcha.enabled
two_factor.enabled
backup.retention_days
public.default_failure_message
```

## 6. 状态机

### 6.1 兑换码状态机

```text
unused
  -> locked
  -> used

locked
  -> unused
  -> unavailable
  -> used

unavailable
  -> unused
  -> used
  -> disabled

unused
  -> disabled
  -> deleted

disabled
  -> unused
  -> deleted

deleted
  -> unused
  -> disabled
```

说明：

- 正常成功路径：`unused -> locked -> used`
- 正常失败路径：`unused -> locked -> unused`
- 崩溃恢复路径：`locked -> unavailable`
- 管理员核对后：`unavailable -> unused / used / disabled`

### 6.2 订单状态机

```text
created
  -> queued
  -> running
  -> succeeded

running
  -> failed
  -> interrupted_review

failed
  -> queued
  -> deleted

interrupted_review
  -> queued
  -> succeeded
  -> failed
  -> deleted

queued
  -> cancelled

cancelled
  -> queued
  -> deleted
```

### 6.3 attempt 状态机

```text
created
  -> checkout_running
  -> checkout_succeeded
  -> direct_card_running
  -> payment_submitted
  -> success

checkout_running
  -> checkout_failed

direct_card_running
  -> direct_card_failed

payment_submitted
  -> success
  -> declined
  -> verification_required
  -> unknown
```

## 7. 核心流程

### 7.1 用户提交兑换码

```text
1. 用户输入兑换码
2. 后端做 IP 限速
3. 后端做同码 30 秒限速
4. 查询兑换码 hash
5. 如果 unused，原子锁定为 locked
6. 创建订单
7. 订单入队
8. 返回 order_id
9. 前台开始轮询订单状态
```

### 7.2 队列消费

```text
1. 检查队列是否 paused
2. 检查当前 running 数量是否低于 global_concurrency
3. 获取最早 queued 订单
4. 标记 running
5. 启动 runner
6. runner 写入实时日志
7. runner 结束后更新订单和兑换码
```

### 7.3 runner 执行

```text
1. 读取 plan_config
2. 按套餐选择卡组
3. 按 priority + 轮换选择卡
4. 按套餐选择账单地址组
5. 按 priority + 轮换选择账单地址
6. 获取提链代理
7. 生成付款链接
8. 获取直卡代理
9. 执行直卡和点击付款
10. 监控付款结果
11. 判断成功/失败/未知/验证
12. 更新 attempt
13. 成功则更新订单、兑换码、卡 success_count
14. 失败则按重试策略继续或终止
```

### 7.4 失败返还

如果所有尝试失败：

```text
1. order.status = failed
2. redeem_code.status = unused
3. redeem_code.locked_order_id = 0
4. 写 run_logs
5. 前台显示失败文案
```

### 7.5 成功完成

如果识别订阅成功：

```text
1. order.status = succeeded
2. redeem_code.status = used
3. redeem_code.used_order_id = order.id
4. card.success_count += 1
5. card.last_used_at = now
6. billing_address.last_used_at = now
7. 写 run_logs
8. 前台显示套餐名充值成功
```

### 7.6 VPS 重启恢复

服务启动时执行恢复：

```text
1. 查询 status=running 的订单
2. 标记 order.status = interrupted_review
3. 查询关联 redeem_code
4. 标记 redeem_code.status = unavailable
5. 写 run_logs
6. 管理员后台显示待核对
```

管理员核对动作：

```text
返还兑换码：
  order.status = failed
  redeem_code.status = unused

标记成功：
  order.status = succeeded
  redeem_code.status = used

重新入队：
  order.status = queued
  redeem_code.status = locked

废弃：
  order.status = failed
  redeem_code.status = disabled 或 unavailable
```

## 8. API 设计

### 8.1 Public API

#### POST /api/public/redeem

请求：

```json
{
  "code": "PLUS-ABCD-EFGH"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "order_id": "ord_20260811_000001",
    "plan_type": "plus",
    "plan_name": "Plus",
    "status": "queued",
    "message": "排队中"
  }
}
```

#### GET /api/public/orders/:order_id

响应：

```json
{
  "ok": true,
  "data": {
    "order_id": "ord_20260811_000001",
    "plan_type": "plus",
    "plan_name": "Plus",
    "status": "running",
    "message": "正在处理"
  }
}
```

#### POST /api/public/recover

用于页面刷新后，用户重新输入 locked 兑换码查询当前订单。

请求：

```json
{
  "code": "PLUS-ABCD-EFGH"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "order_id": "ord_20260811_000001",
    "status": "running",
    "message": "正在处理"
  }
}
```

### 8.2 Admin API

#### POST /api/admin/login

#### POST /api/admin/logout

#### GET /api/admin/me

#### GET /api/admin/dashboard

返回：

```json
{
  "ok": true,
  "data": {
    "queue": {
      "status": "running",
      "queued": 12,
      "running": 1,
      "failed_today": 2,
      "succeeded_today": 9
    },
    "cards": {
      "enabled": 5,
      "standby": 2,
      "disabled": 1,
      "exhausted": 3
    },
    "redeem_codes": {
      "unused": 100,
      "locked": 1,
      "used": 50,
      "unavailable": 0
    }
  }
}
```

#### GET /api/admin/events

SSE 实时状态流。

事件类型：

```text
queue.snapshot
order.created
order.updated
order.log
card.updated
proxy.status
runner.status
system.notice
```

#### POST /api/admin/redeem/batches

批量生成兑换码。

请求：

```json
{
  "name": "2026-08-Plus-第一批",
  "plan_type": "plus",
  "quantity": 100,
  "note": "手动发放",
  "channel_enabled": false,
  "channel": ""
}
```

#### GET /api/admin/redeem/codes

支持过滤：

```text
status
plan_type
batch_id
channel
deleted
```

#### POST /api/admin/redeem/export

请求：

```json
{
  "format": "csv",
  "status": "unused",
  "batch_id": 1,
  "plan_type": "plus"
}
```

#### POST /api/admin/orders/:id/requeue

手动重新入队。

#### POST /api/admin/orders/:id/delete

软删除订单。

#### POST /api/admin/queue/pause

暂停队列。

#### POST /api/admin/queue/resume

恢复队列。

#### GET /api/admin/cards

列表返回打码信息。

#### GET /api/admin/cards/:id

详情返回完整信息，写审计。

#### POST /api/admin/cards

新增卡。

#### PATCH /api/admin/cards/:id

修改卡。

#### POST /api/admin/cards/:id/delete

软删除卡。

#### POST /api/admin/cards/:id/restore

恢复卡。

#### GET /api/admin/billing-addresses

#### POST /api/admin/billing-addresses

#### PATCH /api/admin/billing-addresses/:id

#### POST /api/admin/billing-addresses/:id/delete

#### GET /api/admin/backups

#### POST /api/admin/backups

手动创建备份。

#### GET /api/admin/backups/:id/download

下载备份。

## 9. SSE 设计

SSE 连接：

```text
GET /api/admin/events
```

响应头：

```text
Content-Type: text/event-stream
Cache-Control: no-store
Connection: keep-alive
```

事件示例：

```text
event: order.log
data: {"order_id":"ord_1","level":"info","stage":"checkout","message":"提链开始","ts":1786420000}

event: order.updated
data: {"order_id":"ord_1","status":"running","stage":"direct_card","ts":1786420001}

event: queue.snapshot
data: {"status":"running","queued":12,"running":1,"concurrency":1}
```

前端需要支持断线重连。

后端可以每 15 秒发送心跳：

```text
event: ping
data: {}
```

## 10. 加密设计

### 10.1 加密对象

需要加密保存：

```text
卡号
有效期月
有效期年
CVC
```

可明文保存：

```text
masked_number
card_group_id
priority
max_success_count
success_count
status
note
```

### 10.2 密钥来源

密钥来自环境变量：

```text
APP_SECRET_KEY
```

启动时检查：

- 如果没有配置密钥，后台禁止新增卡。
- 如果已有加密卡但密钥缺失，后台卡详情无法查看，runner 不允许启动。

### 10.3 展示规则

列表展示：

```text
**** **** **** 4242
```

详情展示：

```text
完整卡号
有效期
CVC
```

查看详情写审计。

## 11. 备份设计

### 11.1 自动备份

每日生成一份备份。

建议目录：

```text
output/backups/auto/
```

保留最近 30 份。

### 11.2 手动备份

管理员后台可以点击创建备份。

建议目录：

```text
output/backups/manual/
```

手动备份不受 30 份自动备份限制。

### 11.3 备份内容

```text
webui.db
runtime config
uploaded static config
```

不包含：

```text
APP_SECRET_KEY
浏览器缓存
临时日志
```

### 11.4 备份恢复

第一版可以只提供下载。

恢复操作先写文档，不在后台提供一键恢复。

原因：

- 恢复涉及覆盖数据库。
- 需要同时确认 `APP_SECRET_KEY`。
- 误操作影响较大。

## 12. 后台页面设计

### 12.1 仪表盘

展示：

```text
队列状态
当前并发
排队订单数
运行订单数
今日成功
今日失败
兑换码库存
卡池可用数量
代理状态摘要
异常待核对订单
```

操作：

```text
暂停队列
恢复队列
```

### 12.2 订单队列

列表字段：

```text
订单号
套餐
状态
兑换码
当前阶段
尝试次数
创建时间
开始时间
结束时间
```

详情内容：

```text
订单基础信息
兑换码信息
attempt 列表
运行日志
使用卡
使用账单地址
使用代理
失败原因
管理员操作
```

操作：

```text
重新入队
软删除
返还兑换码
标记成功
标记失败
```

### 12.3 兑换码

功能：

```text
批量生成
筛选
导出
禁用
返还
软删除
恢复
```

筛选：

```text
状态
套餐
批次
渠道
创建时间
```

### 12.4 批次

字段：

```text
批次名
套餐
数量
已用数量
未用数量
异常数量
备注
渠道
创建时间
```

操作：

```text
导出本批次
软删除
恢复
```

### 12.5 套餐配置

每个套餐一张配置卡片：

```text
启用状态
展示名称
付款国家
付款币种
checkout 模板
提链代理组
直卡代理组
账单地址组
卡组优先级
重试策略
失败文案
备注
```

### 12.6 卡池

列表字段：

```text
卡号打码
卡组
priority
success_count / max_success_count
状态
备注
最后使用时间
```

详情字段：

```text
完整卡号
有效期
CVC
使用记录
审计记录
```

### 12.7 账单地址

列表字段：

```text
姓名
国家
州/省
城市
邮编
地址组
priority
状态
最后使用时间
```

### 12.8 代理配置

第一版保留配置壳：

```text
提链代理组
直卡代理组
provider
config_json
enabled
备注
```

代理商 API 文档到位后实现具体 provider。

### 12.9 运行日志

筛选：

```text
订单号
level
stage
时间
```

日志级别：

```text
debug
info
warn
error
success
```

### 12.10 审计日志

筛选：

```text
管理员
动作
目标类型
目标 ID
时间
IP
```

审计日志不允许删除。

### 12.11 备份

展示：

```text
备份文件名
类型 auto/manual
大小
创建时间
状态
```

操作：

```text
创建手动备份
下载
```

## 13. 开发阶段规划

### Phase 1：基础骨架

目标：

- 建立后端模块边界。
- 建立数据库 schema。
- 建立管理员登录。
- 建立基础配置。
- 建立 public/admin API 框架。
- 建立 SSE 通道。

交付：

```text
管理员可登录
前台可访问
数据库可初始化
SSE 可连接
基础健康检查可用
```

### Phase 2：兑换码模块

目标：

- 批量生成兑换码。
- 批次管理。
- 兑换码查询。
- 兑换码导出。
- public redeem API。
- locked/unlock/used/unavailable 状态。

交付：

```text
管理员可生成兑换码
用户可提交兑换码
订单可创建并排队
```

### Phase 3：订单队列

目标：

- FIFO 队列。
- 暂停/恢复。
- 全局并发。
- running 状态管理。
- 崩溃恢复。
- 手动重新入队。

交付：

```text
订单可排队
管理员可暂停恢复
VPS 重启后 running 订单进入 interrupted_review
```

### Phase 4：卡池和账单地址

目标：

- 卡组。
- 卡池。
- 卡信息加密。
- 卡详情审计。
- 账单地址组。
- 账单地址。
- 选择算法。

交付：

```text
管理员可录入卡
管理员可录入账单地址
runner 可选择卡和账单地址
```

### Phase 5：套餐配置

目标：

- go/plus/pro5x/pro20x 配置。
- 卡组优先级。
- 账单地址组。
- 代理组。
- 重试策略。
- 失败文案。

交付：

```text
不同套餐可走不同配置
```

### Phase 6：runner 接入

目标：

- 接入现有提链逻辑。
- 接入现有直卡逻辑。
- 接入点击付款。
- 接入成功/失败识别。
- 接入 attempt 记录。
- 接入运行日志。
- 接入重试策略。

交付：

```text
完整订单可从兑换码跑到成功/失败
```

### Phase 7：后台实时状态

目标：

- 队列实时状态。
- 订单实时日志。
- 卡池状态。
- 代理状态。
- runner 状态。

交付：

```text
管理员后台可实时看到系统运行状态
```

### Phase 8：备份和软删除

目标：

- 自动备份。
- 手动备份。
- 下载备份。
- 软删除。
- 恢复。

交付：

```text
管理员可下载备份
系统每日自动备份
支持软删除和恢复
```

### Phase 9：前端替换和联调

目标：

- 接入原站外观前台。
- 接入管理员后台页面。
- 调整 UI 状态。
- 联调 public API。
- 联调 admin API。

交付：

```text
用户前台和管理员后台完整可用
```

### Phase 10：后续扩展

后续功能：

```text
卡台 API
代理商 API
邮件通知
企业微信/QQ/微信通知
2FA
验证码
一键恢复备份
多管理员
PostgreSQL
多 VPS
```

## 14. 测试计划

### 14.1 单元测试

覆盖：

```text
兑换码生成
兑换码状态转换
兑换码导出
订单状态机
队列调度
卡选择算法
账单地址选择算法
重试策略
限速
加密解密
软删除恢复
审计日志
备份清理
```

### 14.2 集成测试

覆盖：

```text
用户提交兑换码到订单创建
订单排队到 runner 启动
runner 成功后兑换码 used
runner 失败后兑换码 unused
VPS 重启恢复 unavailable
管理员重新入队
管理员返还兑换码
管理员标记成功
```

### 14.3 UI 测试

覆盖：

```text
前台兑换码输入
前台状态轮询
管理员登录
兑换码批量生成
兑换码导出
卡详情查看
SSE 实时日志
队列暂停恢复
备份下载
```

### 14.4 回归测试

每次修改 runner 相关逻辑必须跑：

```text
node --test checkout_ph_dry_run.test.mjs
py -3 -m py_compile card-related/CTF-pay/card.py card-related/CTF-pay/card/_monolith.py
```

## 15. 部署设计

### 15.1 VPS 进程

建议服务：

```text
gpt-auto-pay.service
```

职责：

- 后端 API。
- 静态前端服务。
- 管理员后台服务。
- 队列 worker。
- SSE。

第一版可以单进程。

后续可拆：

```text
gpt-auto-pay-api.service
gpt-auto-pay-worker.service
```

### 15.2 Nginx

用户前台域名：

```text
server_name 用户前台域名;
proxy_pass http://127.0.0.1:8787;
```

管理员后台域名：

```text
server_name 管理员后台域名;
proxy_pass http://127.0.0.1:8787;
```

后端根据 `Host` 区分 public/admin。

SSE 需要关闭代理缓冲：

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
```

### 15.3 环境变量

```text
NODE_ENV=production
PORT=8787
HOST=127.0.0.1
APP_SECRET_KEY=...
WEBUI_DATA_DIR=/home/ubuntu/gpt-auto-pay/output
```

### 15.4 必需目录

```text
output/
output/backups/auto/
output/backups/manual/
output/runtime/
output/logs/
```

## 16. 未接入但需预留的外部资料

后续需要用户提供：

```text
用户前台域名
管理员后台域名
卡台 API 文档
代理商 API 文档
最终前端资源范围
```

邮件通知第一版不做，后续需要时再提供：

```text
SMTP 配置
邮件 API 服务商
收件人配置
```

## 17. 设计原则

### 17.1 前台简单

用户前台只负责：

- 输入兑换码。
- 展示状态。
- 显示成功/失败。

### 17.2 后台完整

管理员后台负责：

- 所有资源管理。
- 所有运行状态。
- 所有配置。
- 所有异常处理。

### 17.3 执行器独立

runner 不直接依赖前端。

runner 只依赖：

- 订单。
- 套餐配置。
- 卡。
- 账单地址。
- 代理。

### 17.4 状态可恢复

任何运行中状态都必须能恢复。

VPS 重启后不自动猜测成功或失败。

统一进入 `interrupted_review` 和 `unavailable`。

### 17.5 用户少暴露

用户前台不暴露内部失败原因。

详细原因只给管理员。

### 17.6 操作可追踪

管理员关键操作全部写审计。

运行日志和审计日志分开。

## 18. 第一版验收标准

第一版完成后应满足：

```text
管理员可以登录后台
管理员可以生成兑换码批次
管理员可以导出兑换码 txt/csv/json
用户可以提交兑换码
兑换码可以 locked/used/unused/unavailable
订单可以排队
队列可以暂停/恢复
管理员可以录入卡
管理员可以录入账单地址
套餐可以配置卡组和账单地址组
runner 可以执行提链和直卡
成功后兑换码 used
失败后兑换码 unused
VPS 重启后 running 订单进入人工核对
管理员可以查看实时状态
管理员可以下载备份
卡信息列表打码
卡详情可查看完整信息并写审计
```

## 19. 风险点和处理方式

### 19.1 VPS 重启

处理：

```text
running -> interrupted_review
locked code -> unavailable
管理员核对后处理
```

### 19.2 APP_SECRET_KEY 丢失

影响：

```text
已加密卡信息无法解密
runner 无法使用已保存卡
```

处理：

```text
管理员必须单独保存 APP_SECRET_KEY
备份下载提示不包含 APP_SECRET_KEY
```

### 19.3 并发过高

影响：

```text
浏览器资源不足
VPS 内存不足
代理失败率上升
```

处理：

```text
默认并发 1
后台允许提高
运行状态展示资源压力
```

### 19.4 前台被刷

处理：

```text
IP 限速
同码限速
验证码接口预留
Cloudflare 可额外加规则
```

### 19.5 卡达到成功次数上限

处理：

```text
自动跳过
后台标记 exhausted
管理员可调整 max_success_count
```

## 20. 下一步

建议下一步不是直接改 runner，而是先建立新平台骨架：

```text
1. 创建数据库 schema 和迁移
2. 创建 admin/public API 框架
3. 创建兑换码模块
4. 创建订单队列模块
5. 创建 SSE 实时状态
6. 创建后台基础页面
7. 再接入现有提链和直卡 runner
```

这样不会把新平台和当前单文件 UI 继续缠在一起。
