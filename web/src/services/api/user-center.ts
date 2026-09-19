import axios, { type AxiosRequestConfig } from "axios";

/**
 * 用户中心接口。media 代理层做纯前缀重写：/api/user-center/<rest> → /api/v1/<rest>，
 * 不重塑字段，前端直接消费 Sub2API 的响应结构，类型按上游 DTO 声明。
 */

const PREFIX = "/api/user-center";

/** Sub2API 统一响应信封；代理层透传原始响应体。 */
type Envelope<T> = { code: number; message: string; data: T };

export type Paginated<T> = {
    items: T[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
};

export type UserProfile = {
    id: number;
    username: string;
    email: string;
    role: "admin" | "user";
    balance: number;
    frozen_balance?: number;
    concurrency: number;
    status: "active" | "disabled";
    created_at: string;
};

export type APIKeyGroup = {
    id: number;
    name: string;
    rate_multiplier: number;
};

export type APIKey = {
    id: number;
    key: string;
    name: string;
    group_id: number | null;
    status: "active" | "inactive" | "quota_exhausted" | "expired";
    quota: number;
    quota_used: number;
    expires_at: string | null;
    last_used_at: string | null;
    last_used_ip?: string | null;
    created_at: string;
    group?: APIKeyGroup;
};

export type CreateAPIKeyPayload = {
    name: string;
    group_id?: number | null;
};

export type UpdateAPIKeyPayload = {
    name?: string;
    group_id?: number | null;
    status?: "active" | "inactive";
};

export type BalanceCredit = {
    id: number;
    source_type: string;
    source_code: string;
    amount: number;
    remaining_amount: number;
    expires_at: string | null;
    expired_at: string | null;
    status: string;
    created_at: string;
};

export type UsageKeyRef = { id: number; name: string };
export type UsageGroupRef = { id: number; name: string };

export type UsageLog = {
    id: number;
    request_id: string;
    api_key_id: number;
    api_key?: UsageKeyRef | null;
    group?: UsageGroupRef | null;
    model: string;
    inbound_endpoint?: string | null;
    reasoning_effort?: string | null;
    ip_address?: string | null;
    billing_mode?: string | null;
    request_type?: string | null;
    stream?: boolean;
    first_token_ms?: number | null;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    total_cost: number;
    actual_cost: number;
    image_count?: number;
    duration_ms: number | null;
    created_at: string;
};

/**
 * 单条记录的 Token 总数口径与 Sub2API 一致：输入 + 输出 + 缓存创建 + 缓存读取。
 *
 * 用户端 DTO 没有 `total_tokens` 字段（见 `backend/internal/handler/dto/types.go` 的 UsageLog），
 * 必须在这里求和；口径与 `/usage/*` 统计端点使用的定义相同，否则表格与统计卡会互相矛盾。
 */
export function usageLogTotalTokens(log: Pick<UsageLog, "input_tokens" | "output_tokens" | "cache_creation_tokens" | "cache_read_tokens">) {
    return (log.input_tokens || 0) + (log.output_tokens || 0) + (log.cache_creation_tokens || 0) + (log.cache_read_tokens || 0);
}

/** `/usage/stats` 的响应，字段与 Sub2API 面板统计卡同源。 */
export type UsageStats = {
    total_requests: number;
    total_tokens: number;
    total_cost: number;
    total_actual_cost: number;
    average_duration_ms: number;
};

export type UsageQuery = {
    page?: number;
    page_size?: number;
    api_key_id?: number;
    model?: string;
    start_date?: string;
    end_date?: string;
    timezone?: string;
};

export type DashboardStats = {
    total_api_keys: number;
    active_api_keys: number;
    total_requests: number;
    total_tokens: number;
    total_cost: number;
    total_actual_cost: number;
    today_requests: number;
    today_tokens: number;
    today_cost: number;
    today_actual_cost: number;
};

export type ModelStat = {
    model: string;
    requests: number;
    total_tokens: number;
    actual_cost: number;
};

export type RedeemResult = {
    message: string;
    type: string;
    value: number;
    new_balance?: number;
    new_concurrency?: number;
};

export type RedeemHistoryItem = {
    id: number;
    code: string;
    type: string;
    value: number;
    status: string;
    used_at: string;
    created_at: string;
    notes?: string;
};

export async function fetchProfile(signal?: AbortSignal) {
    return get<UserProfile>("/user/profile", { signal });
}

export async function fetchBalanceCredits(page: number, pageSize: number, signal?: AbortSignal) {
    return get<Paginated<BalanceCredit>>("/user/balance-credits", { params: { page, page_size: pageSize }, signal });
}

export async function fetchAPIKeys(page: number, pageSize: number, signal?: AbortSignal) {
    return get<Paginated<APIKey>>("/keys", { params: { page, page_size: pageSize }, signal });
}

export async function createAPIKey(payload: CreateAPIKeyPayload) {
    return send<APIKey>("post", "/keys", { data: payload });
}

export async function updateAPIKey(id: number, payload: UpdateAPIKeyPayload) {
    return send<APIKey>("put", `/keys/${id}`, { data: payload });
}

export async function deleteAPIKey(id: number) {
    await send<unknown>("delete", `/keys/${id}`);
}

export async function fetchAvailableGroups(signal?: AbortSignal) {
    return get<APIKeyGroup[]>("/groups/available", { signal });
}

export async function fetchUsage(query: UsageQuery, signal?: AbortSignal) {
    return get<Paginated<UsageLog>>("/usage", { params: query, signal });
}

export async function fetchDashboardStats(signal?: AbortSignal) {
    return get<DashboardStats>("/usage/dashboard/stats", { signal });
}

/** 使用记录页统计卡：与 Sub2API 面板同用 `/usage/stats`（随日期范围与筛选变化）。 */
export async function fetchUsageStats(query: UsageQuery, signal?: AbortSignal) {
    return get<UsageStats>("/usage/stats", { params: query, signal });
}

export async function fetchDashboardModels(query: UsageQuery, signal?: AbortSignal) {
    return get<{ models: ModelStat[] }>("/usage/dashboard/models", { params: query, signal });
}

export async function redeemCode(code: string) {
    return send<RedeemResult>("post", "/redeem", { data: { code } });
}

export async function fetchRedeemHistory(page: number, pageSize: number, signal?: AbortSignal) {
    return get<Paginated<RedeemHistoryItem>>("/redeem/history", { params: { page, page_size: pageSize }, signal });
}

async function get<T>(path: string, config: AxiosRequestConfig = {}) {
    const response = await axios.get<Envelope<T>>(`${PREFIX}${path}`, { withCredentials: true, ...config });
    return response.data.data;
}

async function send<T>(method: "post" | "put" | "delete", path: string, config: AxiosRequestConfig = {}) {
    const response = await axios.request<Envelope<T>>({ method, url: `${PREFIX}${path}`, withCredentials: true, ...config });
    return response.data.data;
}
