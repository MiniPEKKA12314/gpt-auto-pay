export default [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/login/index.vue"),
    meta: { title: "管理员登录", showLink: false }
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/error/404.vue"),
    meta: { title: "页面未找到", showLink: false }
  }
] satisfies Array<RouteConfigsTable>;
