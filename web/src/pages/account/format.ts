/** 用户中心页面共用的展示格式化。金额与额度沿用 Sub2API 的记账精度，统一保留 4 位后去掉尾零。 */

/**
 * API Key 展示打码，规则与 Sub2API 面板 `frontend/src/utils/maskApiKey.ts` 保持一致：
 * 长 key 露前 6 与后 4，短 key（<=12）只露前 4。明文只在复制时使用。
 */
export function maskAPIKey(value?: string | null) {
    const key = (value ?? "").trim();
    if (!key) return "-";
    if (key.length <= 12) return `${key.slice(0, 4)}***`;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/** 毫秒 → 可读时长。延迟列用它格式化首字与总耗时，与 Sub2API 面板同口径。 */
export function formatDuration(value?: number | null) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(1)}s`;
}

export function formatAmount(value?: number | null, digits = 4) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    const fixed = value.toFixed(digits);
    return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

export function formatCount(value?: number | null) {
    return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "-";
}

export function formatTime(value?: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 接口按 YYYY-MM-DD 收发日期，这里把本地日期转成同格式，避免用 UTC 导致跨天偏移。 */
export function formatDateParam(date: Date) {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

export function browserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}
