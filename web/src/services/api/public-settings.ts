import axios from "axios";

/**
 * 公开设置（GET /api/settings/public，匿名可达）。
 * 登录页与注册页的验证码、开关全部由这里驱动，因此本模块只保留这两个页面实际用到的字段。
 */
export type PublicSettings = {
    registrationEnabled: boolean;
    emailVerifyEnabled: boolean;
    invitationCodeEnabled: boolean;
    turnstileEnabled: boolean;
    turnstileSiteKey: string;
    tencentCaptchaEnabled: boolean;
    tencentCaptchaAppId: string;
    tencentCaptchaRegion: string;
    aliyunCaptchaEnabled: boolean;
    aliyunCaptchaSceneId: string;
    aliyunCaptchaPrefix: string;
    aliyunCaptchaRegion: string;
    redeemPurchaseUrl: string;
};

export async function fetchPublicSettings(signal?: AbortSignal): Promise<PublicSettings> {
    const response = await axios.get<unknown>("/api/settings/public", { withCredentials: true, signal });
    return parsePublicSettings(response.data);
}

export function parsePublicSettings(payload: unknown): PublicSettings {
    const body = unwrap(payload) ?? {};
    return {
        registrationEnabled: flag(body.registration_enabled, true),
        emailVerifyEnabled: flag(body.email_verify_enabled, false),
        invitationCodeEnabled: flag(body.invitation_code_enabled, false),
        turnstileEnabled: flag(body.turnstile_enabled, false),
        turnstileSiteKey: text(body.turnstile_site_key),
        tencentCaptchaEnabled: flag(body.tencent_captcha_enabled, false),
        tencentCaptchaAppId: text(body.tencent_captcha_app_id),
        tencentCaptchaRegion: text(body.tencent_captcha_region),
        aliyunCaptchaEnabled: flag(body.aliyun_captcha_enabled, false),
        aliyunCaptchaSceneId: text(body.aliyun_captcha_scene_id),
        aliyunCaptchaPrefix: text(body.aliyun_captcha_prefix),
        aliyunCaptchaRegion: text(body.aliyun_captcha_region),
        redeemPurchaseUrl: text(body.redeem_purchase_url),
    };
}

/** 三家验证码按 Turnstile → 腾讯 → 阿里云的顺序取第一个配置完整的。 */
export function captchaProvider(settings: PublicSettings) {
    if (settings.turnstileEnabled && settings.turnstileSiteKey) return "turnstile" as const;
    if (settings.tencentCaptchaEnabled && settings.tencentCaptchaAppId) return "tencent" as const;
    if (settings.aliyunCaptchaEnabled && settings.aliyunCaptchaSceneId && settings.aliyunCaptchaPrefix) return "aliyun" as const;
    return "none" as const;
}

function unwrap(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as Record<string, unknown>;
    const data = body.data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : body;
}

function flag(value: unknown, fallback: boolean) {
    return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
