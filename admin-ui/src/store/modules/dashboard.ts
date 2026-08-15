import { defineStore } from "pinia";
import { dashboardApi, type RowData } from "@/api/admin";
import { store } from "@/store";

export const useDashboardStore = defineStore("admin-dashboard", {
  state: () => ({
    snapshot: {} as RowData,
    queue: {} as RowData,
    loading: false,
    lastUpdated: 0,
    eventSource: null as EventSource | null
  }),
  actions: {
    async refresh() {
      this.loading = true;
      try {
        const [snapshot, queue] = await Promise.all([dashboardApi.snapshot(), dashboardApi.queue()]);
        this.snapshot = snapshot.data || {};
        this.queue = queue.data || this.snapshot.queue || {};
        this.lastUpdated = Date.now();
      } finally {
        this.loading = false;
      }
    },
    async saveQueue(payload: RowData) {
      const result = await dashboardApi.updateQueue(payload);
      this.queue = { ...this.queue, ...(result.data || {}) };
      await this.refresh();
    },
    async queueAction(action: "pause" | "resume" | "process") {
      if (action === "pause") await dashboardApi.pauseQueue();
      else if (action === "resume") await dashboardApi.resumeQueue();
      else await dashboardApi.processOnce();
      await this.refresh();
    },
    connectEvents() {
      if (this.eventSource) return;
      const source = new EventSource("/api/admin/events", { withCredentials: true });
      source.addEventListener("queue.snapshot", event => {
        try { this.queue = JSON.parse((event as MessageEvent).data); } catch {}
      });
      source.addEventListener("dashboard.snapshot", event => {
        try {
          const snapshot = JSON.parse((event as MessageEvent).data);
          this.snapshot = snapshot || {};
          this.queue = snapshot?.queue || this.queue;
          this.lastUpdated = Date.now();
        } catch {}
      });
      this.eventSource = source;
    },
    disconnectEvents() {
      this.eventSource?.close();
      this.eventSource = null;
    }
  }
});

export function useDashboardStoreHook() { return useDashboardStore(store); }
