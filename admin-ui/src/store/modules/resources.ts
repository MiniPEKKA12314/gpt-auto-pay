import { defineStore } from "pinia";
import { billingApi, cardsApi, plansApi, proxiesApi, type RowData } from "@/api/admin";
import { store } from "@/store";

export const useResourcesStore = defineStore("admin-resources", {
  state: () => ({
    plans: [] as RowData[],
    cardGroups: [] as RowData[],
    cards: [] as RowData[],
    billingGroups: [] as RowData[],
    billingAddresses: [] as RowData[],
    proxyGroups: [] as RowData[],
    loading: false,
    loaded: false
  }),
  actions: {
    async load(force = false) {
      if (this.loading || (this.loaded && !force)) return;
      this.loading = true;
      try {
        const [plans, cardGroups, cards, billingGroups, billingAddresses, proxyGroups] = await Promise.all([
          plansApi.list(), cardsApi.groups(), cardsApi.list(), billingApi.groups(), billingApi.addresses(), proxiesApi.list()
        ]);
        this.plans = plans.data || [];
        this.cardGroups = cardGroups.data || [];
        this.cards = cards.data || [];
        this.billingGroups = billingGroups.data || [];
        this.billingAddresses = billingAddresses.data || [];
        this.proxyGroups = proxyGroups.data || [];
        this.loaded = true;
      } finally { this.loading = false; }
    }
  }
});

export function useResourcesStoreHook() { return useResourcesStore(store); }
