export function formatTime(value: unknown) {
  const seconds = Number(value || 0);
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

export function formatDuration(value: unknown) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(value || 0)));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
}

export function compactJson(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value)); } catch { return value; }
  }
  return JSON.stringify(value);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
