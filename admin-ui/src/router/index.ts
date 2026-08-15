import NProgress from "@/utils/progress";
import { useUserStoreHook } from "@/store/modules/user";
import adminRoutes from "./modules/home";
import remainingRoutes from "./modules/remaining";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw
} from "vue-router";

const menuRoutes = adminRoutes as RouteRecordRaw[];
export const constantRoutes = menuRoutes;
export const constantMenus = menuRoutes;
export const remainingPaths = (remainingRoutes as RouteRecordRaw[]).map(route => route.path);

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...menuRoutes, ...(remainingRoutes as RouteRecordRaw[])],
  scrollBehavior: () => ({ left: 0, top: 0 })
});

export function resetRouter() {}

router.beforeEach(async to => {
  NProgress.start();
  const auth = useUserStoreHook();
  const isLogin = to.path === "/login";
  const authenticated = await auth.checkSession();

  if (!authenticated && !isLogin) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }
  if (authenticated && isLogin) return { path: "/dashboard" };

  const title = String(to.meta.title || "管理后台");
  document.title = `${title} | GPT Auto Pay`;
  return true;
});

router.afterEach(() => NProgress.done());

window.addEventListener("admin:unauthorized", () => {
  const auth = useUserStoreHook();
  auth.clearSession();
  if (router.currentRoute.value.path !== "/login") {
    router.replace({ path: "/login", query: { redirect: router.currentRoute.value.fullPath } });
  }
});

export default router;
