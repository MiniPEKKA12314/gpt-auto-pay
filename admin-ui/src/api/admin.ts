import { http } from "@/utils/http";

export type RowData = Record<string, any>;

export const authApi = {
  login: (payload: { username: string; password: string }) =>
    http.post<RowData>("/api/admin/login", payload),
  logout: () => http.post<void>("/api/admin/logout"),
  me: () => http.get<RowData>("/api/admin/me"),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    http.post<void>("/api/admin/password", payload)
};

export const dashboardApi = {
  snapshot: () => http.get<RowData>("/api/admin/dashboard"),
  queue: () => http.get<RowData>("/api/admin/queue"),
  updateQueue: (payload: RowData) => http.patch<RowData>("/api/admin/queue/settings", payload),
  pauseQueue: () => http.post<RowData>("/api/admin/queue/pause"),
  resumeQueue: () => http.post<RowData>("/api/admin/queue/resume"),
  processOnce: () => http.post<RowData>("/api/admin/queue/process-once")
};

export const ordersApi = {
  list: (params: RowData = {}) => http.get<RowData[]>("/api/admin/orders", { params }),
  details: (id: number) => http.get<RowData>(`/api/admin/orders/${id}/details`),
  action: (id: number, action: string, payload: RowData = {}) =>
    http.post<RowData>(`/api/admin/orders/${id}/${action}`, payload),
  createManual: (payload: RowData) => http.post<RowData>("/api/admin/manual-orders", payload)
};

export const redeemApi = {
  batches: () => http.get<RowData[]>("/api/admin/redeem/batches"),
  createBatch: (payload: RowData) => http.post<RowData>("/api/admin/redeem/batches", payload),
  codes: (params: RowData = {}) => http.get<RowData>("/api/admin/redeem/codes", { params }),
  action: (id: number, action: string) => http.post<RowData>(`/api/admin/redeem/codes/${id}/${action}`),
  exportCodes: (payload: RowData) => http.download("/api/admin/redeem/export", payload)
};

export const plansApi = {
  list: () => http.get<RowData[]>("/api/admin/plans"),
  detail: (type: string) => http.get<RowData>(`/api/admin/plans/${type}`),
  update: (type: string, payload: RowData) => http.patch<RowData>(`/api/admin/plans/${type}`, payload),
  readiness: (type: string) => http.get<RowData>(`/api/admin/plans/${type}/runtime-readiness`)
};

export const cardsApi = {
  groups: () => http.get<RowData[]>("/api/admin/card-groups"),
  createGroup: (payload: RowData) => http.post<RowData>("/api/admin/card-groups", payload),
  groupAction: (id: number, action: string) => http.post<RowData>(`/api/admin/card-groups/${id}/${action}`),
  list: () => http.get<RowData[]>("/api/admin/cards"),
  create: (payload: RowData) => http.post<RowData>("/api/admin/cards", payload),
  detail: (id: number, secret = false) => http.get<RowData>(`/api/admin/cards/${id}`, { params: secret ? { secret: 1 } : {} }),
  update: (id: number, payload: RowData) => http.patch<RowData>(`/api/admin/cards/${id}`, payload),
  action: (id: number, action: string, payload: RowData = {}) => http.post<RowData>(`/api/admin/cards/${id}/${action}`, payload)
};

export const providerApi = {
  config: (provider: string) => http.get<RowData>(`/api/admin/card-providers/${provider}/config`),
  saveConfig: (provider: string, payload: RowData) => http.patch<RowData>(`/api/admin/card-providers/${provider}/config`, payload),
  get: (provider: string, action: string, params: RowData = {}) => http.get<RowData>(`/api/admin/card-providers/${provider}/${action}`, { params }),
  post: (provider: string, action: string, payload: RowData = {}) => http.post<RowData>(`/api/admin/card-providers/${provider}/${action}`, payload)
};

export const billingApi = {
  groups: () => http.get<RowData[]>("/api/admin/billing-groups"),
  createGroup: (payload: RowData) => http.post<RowData>("/api/admin/billing-groups", payload),
  groupAction: (id: number, action: string) => http.post<RowData>(`/api/admin/billing-groups/${id}/${action}`),
  addresses: () => http.get<RowData[]>("/api/admin/billing-addresses"),
  createAddress: (payload: RowData) => http.post<RowData>("/api/admin/billing-addresses", payload),
  updateAddress: (id: number, payload: RowData) => http.patch<RowData>(`/api/admin/billing-addresses/${id}`, payload),
  addressAction: (id: number, action: string) => http.post<RowData>(`/api/admin/billing-addresses/${id}/${action}`)
};

export const proxiesApi = {
  list: () => http.get<RowData[]>("/api/admin/proxy-groups"),
  detail: (id: number) => http.get<RowData>(`/api/admin/proxy-groups/${id}`),
  create: (payload: RowData) => http.post<RowData>("/api/admin/proxy-groups", payload),
  update: (id: number, payload: RowData) => http.patch<RowData>(`/api/admin/proxy-groups/${id}`, payload),
  action: (id: number, action: string, payload: RowData = {}) => http.post<RowData>(`/api/admin/proxy-groups/${id}/${action}`, payload)
};

export const systemApi = {
  audits: () => http.get<RowData[]>("/api/admin/audit-logs"),
  legacyEntry: () => http.get<RowData>("/api/admin/legacy-entry"),
  saveLegacyEntry: (payload: RowData) => http.patch<RowData>("/api/admin/legacy-entry", payload)
};
