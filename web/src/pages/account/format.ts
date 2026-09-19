/** 用户中心页面共用的展示格式化。金额与额度沿用 Sub2API 的记账精度，统一保留 4 位后去掉尾零。 */

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
