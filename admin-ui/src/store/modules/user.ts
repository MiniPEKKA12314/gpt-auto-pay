import { defineStore } from "pinia";
import { authApi } from "@/api/admin";
import { store } from "@/store";
import router from "@/router";

interface LoginPayload {
  username: string;
  password: string;
}

export const useUserStore = defineStore("admin-user", {
  state: () => ({
    avatar: "",
    username: sessionStorage.getItem("admin-username") || "",
    nickname: "",
    roles: ["admin"],
    permissions: ["*:*:*"],
    isRemembered: false,
    loginDay: 1,
    authenticated: false,
    checked: false
  }),
  actions: {
    SET_AVATAR(value: string) { this.avatar = value; },
    SET_USERNAME(value: string) { this.username = value; },
    SET_NICKNAME(value: string) { this.nickname = value; },
    SET_ROLES(value: string[]) { this.roles = value; },
    SET_PERMS(value: string[]) { this.permissions = value; },
    SET_ISREMEMBERED(value: boolean) { this.isRemembered = value; },
    SET_LOGINDAY(value: number) { this.loginDay = Number(value); },
    setAuthenticated(username = "admin") {
      this.username = username;
      this.nickname = username;
      this.authenticated = true;
      this.checked = true;
      sessionStorage.setItem("admin-username", username);
    },
    clearSession() {
      this.authenticated = false;
      this.checked = true;
      this.username = "";
      this.nickname = "";
      sessionStorage.removeItem("admin-username");
    },
    async loginByUsername(payload: LoginPayload) {
      const result = await authApi.login(payload);
      this.setAuthenticated(result.data?.username || payload.username);
      return result;
    },
    async checkSession(force = false) {
      if (this.checked && !force) return this.authenticated;
      try {
        const result = await authApi.me();
        this.setAuthenticated(result.data?.username || "admin");
      } catch {
        this.clearSession();
      }
      return this.authenticated;
    },
    async logOut() {
      try { await authApi.logout(); } catch {}
      this.clearSession();
      await router.replace("/login");
    }
  }
});

export function useUserStoreHook() {
  return useUserStore(store);
}
