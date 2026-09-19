import axios from "axios";

export type ApiParams = Record<string, string | string[] | number | number[] | undefined>;

export function compactApiParams(params: ApiParams) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && (!Array.isArray(value) || value.length > 0))) as ApiParams;
}

export function serializeApiParams(params?: ApiParams) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => queryParams.append(key, String(item)));
        else queryParams.set(key, String(value));
    }
    return queryParams;
}

/**
 * Media 代理层直接透传 Sub2API 的响应体，错误信息在 `message` 字段里。
 * 读取失败时返回空串，由调用方给出本地的兜底文案。
 */
export function apiResponseMessage(data: unknown) {
    if (!data || typeof data !== "object") return "";
    const message = (data as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : "";
}

/** 后端不可达时 axios 没有 response，状态码记为 0。 */
export function apiErrorStatus(error: unknown) {
    return axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
}

/** networkError 由调用方按当前语言传入，本模块不持有任何界面文案。 */
export function apiErrorMessage(error: unknown, fallback: string, networkError: string = fallback) {
    if (!axios.isAxiosError(error)) return error instanceof Error && error.message ? error.message : fallback;
    const status = apiErrorStatus(error);
    if (status === 0) return networkError;
    return apiResponseMessage(error.response?.data) || `${fallback}（HTTP ${status}）`;
}
