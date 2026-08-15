const Layout = () => import("@/layout/index.vue");

export default [
  {
    path: "/operations",
    name: "Operations",
    component: Layout,
    redirect: "/dashboard",
    meta: { icon: "ep/odometer", title: "运营中心", rank: 1 },
    children: [
      { path: "/dashboard", name: "Dashboard", component: () => import("@/views/dashboard/index.vue"), meta: { title: "运营概览", icon: "ep/data-analysis" } },
      { path: "/manual-orders", name: "ManualOrders", component: () => import("@/views/manual-orders/index.vue"), meta: { title: "手动充值", icon: "ep/edit-pen" } },
      { path: "/orders", name: "Orders", component: () => import("@/views/orders/index.vue"), meta: { title: "订单管理", icon: "ep/list" } },
      { path: "/redeem", name: "Redeem", component: () => import("@/views/redeem/index.vue"), meta: { title: "兑换码", icon: "ep/ticket" } }
    ]
  },
  {
    path: "/resources",
    name: "Resources",
    component: Layout,
    redirect: "/plans",
    meta: { icon: "ep/setting", title: "资源配置", rank: 2 },
    children: [
      { path: "/plans", name: "Plans", component: () => import("@/views/plans/index.vue"), meta: { title: "套餐配置", icon: "ep/set-up" } },
      { path: "/cards", name: "Cards", component: () => import("@/views/cards/index.vue"), meta: { title: "卡池管理", icon: "ep/credit-card" } },
      { path: "/billing", name: "Billing", component: () => import("@/views/billing/index.vue"), meta: { title: "账单资料", icon: "ep/location" } },
      { path: "/proxies", name: "Proxies", component: () => import("@/views/proxies/index.vue"), meta: { title: "代理管理", icon: "ep/connection" } }
    ]
  },
  {
    path: "/system",
    name: "System",
    component: Layout,
    redirect: "/system/settings",
    meta: { icon: "ep/tools", title: "系统管理", rank: 3 },
    children: [
      { path: "/system/settings", name: "SystemSettings", component: () => import("@/views/system/index.vue"), meta: { title: "安全与审计", icon: "ep/lock" } }
    ]
  },
  { path: "/", redirect: "/dashboard", meta: { title: "首页", showLink: false } }
] satisfies Array<RouteConfigsTable>;
