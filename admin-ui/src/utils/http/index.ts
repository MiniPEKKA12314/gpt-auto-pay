import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data: T;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class AdminApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, status = 0, code = "REQUEST_FAILED", details = {}) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 30_000,
  withCredentials: true,
  headers: {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest"
  }
});

instance.interceptors.response.use(
  response => response,
  (error: AxiosError<ApiEnvelope>) => {
    const payload = error.response?.data;
    const normalized = new AdminApiError(
      payload?.message || error.message || "请求失败",
      error.response?.status || 0,
      payload?.code || "REQUEST_FAILED",
      payload?.details || {}
    );
    if (normalized.status === 401 && !String(error.config?.url).endsWith("/login")) {
      window.dispatchEvent(new CustomEvent("admin:unauthorized"));
    }
    return Promise.reject(normalized);
  }
);

export const http = {
  async request<T>(config: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
    const response = await instance.request<ApiEnvelope<T>>(config);
    return response.data;
  },
  get<T>(url: string, config: AxiosRequestConfig = {}) {
    return this.request<T>({ ...config, method: "GET", url });
  },
  post<T>(url: string, data: unknown = {}, config: AxiosRequestConfig = {}) {
    return this.request<T>({ ...config, method: "POST", url, data });
  },
  patch<T>(url: string, data: unknown = {}, config: AxiosRequestConfig = {}) {
    return this.request<T>({ ...config, method: "PATCH", url, data });
  },
  put<T>(url: string, data: unknown = {}, config: AxiosRequestConfig = {}) {
    return this.request<T>({ ...config, method: "PUT", url, data });
  },
  async download(url: string, data: unknown): Promise<{ blob: Blob; filename: string }> {
    const response = await instance.post(url, data, { responseType: "blob" });
    const disposition = String(response.headers["content-disposition"] || "");
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "export.txt";
    return { blob: response.data, filename };
  }
};
