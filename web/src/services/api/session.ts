import axios from "axios";

/**
 * media 会话接口（由 media_playground BFF 提供）。
 * 浏览器全程不持有 Sub2API 的 token，access / refresh token 都加密存在服务端，
 * 这里只负责建立会话与读取会话身份。
 */

/** launch = 从 Sub2API 菜单跳转带过来的身份；password = 在 media 站密码登录建立的身份。 */
export type SessionAuthSource = "launch" | "password";

export type SessionUser = {
    id: number;
    email: string;
    username: string;
    role: string;
};

export type SessionState = {
    authSource: SessionAuthSource | null;
    /**
     * 会话是否已绑定一个可用的 API Key（后端 `has_api_key`，即 `api_key_id > 0`）。
     * 用于「有账号但没有可用 Key」的分诊：这类用户点了生成才会失败，应在入口就引导去建 Key。
     */
    hasApiKey: boolean;
    user: SessionUser | null;
};

/** 登录 / 注册时随表单提交的验证码凭据；三家验证码按后端约定复用这三个字段。 */
export type CaptchaPayload = {
    turnstile_token?: string;
    tencent_captcha_ticket?: string;
    tencent_captcha_randstr?: string;
};

export type LoginPayload = CaptchaPayload & {
    email: string;
    password: string;
};

export type RegisterPayload = CaptchaPayload & {
    email: string;
    password: string;
    verify_code?: string;
    invitation_code?: string;
};

/** 上游没给出倒计时时的兜底秒数，只用于防重复点击。 */
const DEFAULT_SEND_COUNTDOWN = 60;

/** 登录返回两步验证时的中间态；temp_token 与待验证会话都只由服务端持有，这里只拿回用于回显的掩码邮箱。 */
export type PendingLogin = {
    emailMasked: string;
};

export async function fetchSessionState(signal?: AbortSignal): Promise<SessionState> {
    const response = await axios.get<unknown>("/api/session/me", { withCredentials: true, signal });
    return parseSessionState(response.data);
}

/** 返回 null 表示登录完成；返回 PendingLogin 表示需要继续提交 TOTP 动态码。 */
export async function login(payload: LoginPayload): Promise<PendingLogin | null> {
    const response = await axios.post<unknown>("/api/session/login", payload, { withCredentials: true });
    return parsePendingLogin(response.data);
}

/**
 * 提交 TOTP 动态码完成登录。
 * 待验证会话由服务端的 `ip_pending_login` cookie 绑定，浏览器全程不知道它的 id，
 * 因此请求体只带动态码。
 */
export async function loginWithTotp(totpCode: string): Promise<void> {
    await axios.post("/api/session/login/2fa", { totp_code: totpCode }, { withCredentials: true });
}

export async function register(payload: RegisterPayload): Promise<PendingLogin | null> {
    const response = await axios.post<unknown>("/api/session/register", payload, { withCredentials: true });
    return parsePendingLogin(response.data);
}

/**
 * 发送注册邮箱验证码。开启邮箱验证的站点只能用这里发出的验证码完成注册。
 * 上游的限流、验证码校验失败、邮箱已注册等语义原样透传，调用方直接展示响应里的 message。
 */
export async function sendVerifyCode(email: string, captcha: CaptchaPayload): Promise<number> {
    const response = await axios.post<unknown>("/api/session/send-verify-code", { email, ...captcha }, { withCredentials: true });
    const body = unwrap(response.data) ?? {};
    const countdown = Number(body.countdown);
    return Number.isFinite(countdown) && countdown > 0 ? countdown : DEFAULT_SEND_COUNTDOWN;
}

export async function logout(): Promise<void> {
    await axios.post("/api/logout", undefined, { withCredentials: true });
}

/**
 * `/api/session/me` 无会话时返回 401，成功时返回
 * `{auth_source, user_id, email, username, role, api_key_id, has_api_key}`。
 * 身份字段是平铺的，这里组装成 SessionUser；balance 不在这里返回，余额一律走用户中心的 profile。
 */
export function parseSessionState(payload: unknown): SessionState {
    const body = unwrap(payload) ?? {};
    const authSource = text(body.auth_source);
    const id = Number(body.user_id);
    return {
        authSource: authSource === "launch" || authSource === "password" ? authSource : null,
        hasApiKey: body.has_api_key === true,
        user:
            Number.isSafeInteger(id) && id > 0
                ? {
                      id,
                      email: text(body.email),
                      username: text(body.username),
                      role: text(body.role) || "user",
                  }
                : null,
    };
}

function parsePendingLogin(payload: unknown): PendingLogin | null {
    const body = unwrap(payload);
    if (body?.requires_2fa !== true) return null;
    return { emailMasked: text(body.user_email_masked) };
}

function unwrap(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as Record<string, unknown>;
    const data = body.data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : body;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
