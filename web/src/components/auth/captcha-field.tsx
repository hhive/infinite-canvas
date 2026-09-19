import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { captchaProvider, type PublicSettings } from "@/services/api/public-settings";
import type { CaptchaPayload } from "@/services/api/session";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 人机验证组件。启用哪一家由公开设置决定，取回的一次性凭据统一按 CaptchaPayload 返回，
 * 未启用任何验证码时 ensure() 返回空对象直接放行。
 */
export type CaptchaHandle = {
    /** 返回 null 表示凭据还没拿到（未完成 / 用户关闭弹窗 / 脚本加载失败），由调用方提示重试。 */
    ensure: () => Promise<CaptchaPayload | null>;
    reset: () => void;
};

export const CaptchaField = forwardRef<CaptchaHandle, { settings: PublicSettings }>(function CaptchaField({ settings }, ref) {
    const provider = captchaProvider(settings);
    const inner = useRef<CaptchaHandle | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            ensure: async () => (provider === "none" ? {} : ((await inner.current?.ensure()) ?? null)),
            reset: () => inner.current?.reset(),
        }),
        [provider],
    );

    if (provider === "turnstile") return <TurnstileField ref={inner} siteKey={settings.turnstileSiteKey} />;
    if (provider === "tencent") return <TencentCaptchaField ref={inner} appId={settings.tencentCaptchaAppId} region={settings.tencentCaptchaRegion} />;
    if (provider === "aliyun") return <AliyunCaptchaField ref={inner} sceneId={settings.aliyunCaptchaSceneId} prefix={settings.aliyunCaptchaPrefix} region={settings.aliyunCaptchaRegion} />;
    return null;
});

function CaptchaFailure({ text }: { text: string }) {
    return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{text}</p>;
}

// ==================== Cloudflare Turnstile ====================

type TurnstileApi = {
    render: (container: HTMLElement, options: Record<string, unknown>) => string;
    reset: (widgetId?: string) => void;
    remove: (widgetId?: string) => void;
};

declare global {
    interface Window {
        turnstile?: TurnstileApi;
        onTurnstileLoad?: () => void;
    }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
let turnstilePromise: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstilePromise) {
        turnstilePromise = new Promise<TurnstileApi>((resolve, reject) => {
            window.onTurnstileLoad = () => {
                if (window.turnstile) resolve(window.turnstile);
                else reject(new Error("Turnstile API is unavailable"));
            };
            const script = document.createElement("script");
            script.src = TURNSTILE_SCRIPT;
            script.async = true;
            script.defer = true;
            script.onerror = () => {
                turnstilePromise = null;
                reject(new Error("Failed to load Turnstile"));
            };
            document.head.append(script);
        });
    }
    return turnstilePromise;
}

const TurnstileField = forwardRef<CaptchaHandle, { siteKey: string }>(function TurnstileField({ siteKey }, ref) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const container = useRef<HTMLDivElement | null>(null);
    const widgetId = useRef<string | null>(null);
    const token = useRef("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void loadTurnstile()
            .then((turnstile) => {
                if (cancelled || !container.current) return;
                container.current.innerHTML = "";
                widgetId.current = turnstile.render(container.current, {
                    sitekey: siteKey,
                    theme,
                    callback: (value: string) => {
                        token.current = value;
                    },
                    "expired-callback": () => {
                        token.current = "";
                    },
                    "error-callback": () => {
                        token.current = "";
                    },
                });
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
            token.current = "";
            if (widgetId.current) window.turnstile?.remove(widgetId.current);
            widgetId.current = null;
        };
    }, [siteKey, theme]);

    useImperativeHandle(
        ref,
        () => ({
            ensure: async () => (token.current ? { turnstile_token: token.current } : null),
            reset: () => {
                token.current = "";
                if (widgetId.current) window.turnstile?.reset(widgetId.current);
            },
        }),
        [],
    );

    if (failed) return <CaptchaFailure text={t("auth.captchaLoadFailed")} />;
    return <div ref={container} className="min-h-[65px] w-full" />;
});

// ==================== 腾讯天御验证码 ====================

type TencentResult = { ret: number; ticket?: string | null; randstr?: string | null; errorCode?: number };
type TencentInstance = { show: () => void; destroy: () => void };
type TencentConstructor = {
    new (appId: string, callback: (result: TencentResult) => void, options?: Record<string, unknown>): TencentInstance;
    new (container: HTMLElement, appId: string, callback: (result: TencentResult) => void, options?: Record<string, unknown>): TencentInstance;
};

declare global {
    interface Window {
        TencentCaptcha?: TencentConstructor;
        TCaptchaGlobal?: boolean;
    }
}

const TENCENT_SCRIPT = {
    cn: "https://turing.captcha.qcloud.com/TJCaptcha.js",
    intl: "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js",
};

function tencentRegion(value: string) {
    return value === "intl" ? ("intl" as const) : ("cn" as const);
}

let tencentPromise: Promise<TencentConstructor> | null = null;

/** 两个站点注册同名全局且构造签名不兼容，缓存必须按站点隔离，否则切换区域后会拿到错误构造函数。 */
function loadTencentCaptcha(region: "cn" | "intl") {
    const globalRegion = window.TCaptchaGlobal === true ? "intl" : "cn";
    if (window.TencentCaptcha && globalRegion === region) return Promise.resolve(window.TencentCaptcha);
    if (!tencentPromise) {
        tencentPromise = new Promise<TencentConstructor>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = TENCENT_SCRIPT[region];
            script.async = true;
            script.onload = () => {
                if (window.TencentCaptcha && (window.TCaptchaGlobal === true ? "intl" : "cn") === region) resolve(window.TencentCaptcha);
                else {
                    tencentPromise = null;
                    reject(new Error("Tencent Captcha SDK is unavailable"));
                }
            };
            script.onerror = () => {
                tencentPromise = null;
                reject(new Error("Failed to load Tencent Captcha"));
            };
            document.head.append(script);
        });
    }
    return tencentPromise;
}

const TencentCaptchaField = forwardRef<CaptchaHandle, { appId: string; region: string }>(function TencentCaptchaField({ appId, region }, ref) {
    const { i18n, t } = useTranslation();
    const resolved = tencentRegion(region);
    const container = useRef<HTMLDivElement | null>(null);
    const instance = useRef<TencentInstance | null>(null);
    const pending = useRef<((value: CaptchaPayload | null) => void) | null>(null);
    const [failed, setFailed] = useState(false);

    const settle = useCallback((value: CaptchaPayload | null) => {
        const resolve = pending.current;
        pending.current = null;
        resolve?.(value);
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            ensure: async () => {
                try {
                    const TencentCaptcha = await loadTencentCaptcha(resolved);
                    const userLanguage = i18n.resolvedLanguage === "zh-CN" ? "zh-cn" : "en";
                    return await new Promise<CaptchaPayload | null>((resolve) => {
                        pending.current = resolve;
                        const handleResult = (result: TencentResult) => {
                            const ticket = result.ticket?.trim() ?? "";
                            // ret === 2 表示用户主动关闭；trerror_ 前缀是 SDK 的错误占位票据
                            if (result.ret === 2 || !ticket || ticket.startsWith("trerror_") || result.errorCode !== undefined) {
                                settle(null);
                                return;
                            }
                            settle({ tencent_captcha_ticket: ticket, tencent_captcha_randstr: result.randstr?.trim() ?? "" });
                        };
                        if (resolved === "intl") {
                            // 国际站首参必须是承载 Robot checkbox 的容器，传字符串会直接抛错
                            const host = container.current;
                            if (!host) {
                                settle(null);
                                return;
                            }
                            instance.current = new TencentCaptcha(host, appId, handleResult, { enableAutoCheck: false, userLanguage, type: "popup" });
                        } else {
                            instance.current = new TencentCaptcha(appId, handleResult, { userLanguage });
                        }
                        instance.current.show();
                    });
                } catch {
                    setFailed(true);
                    return null;
                }
            },
            reset: () => {
                instance.current?.destroy();
                instance.current = null;
                settle(null);
            },
        }),
        [appId, i18n.resolvedLanguage, resolved, settle],
    );

    useEffect(
        () => () => {
            instance.current?.destroy();
            instance.current = null;
            settle(null);
        },
        [settle],
    );

    if (failed) return <CaptchaFailure text={t("auth.captchaLoadFailed")} />;
    return resolved === "intl" ? <div ref={container} className="flex min-h-[60px] w-full justify-center" /> : null;
});

// ==================== 阿里云验证码 ====================

type AliyunInitOptions = {
    SceneId: string;
    prefix: string;
    mode: "popup" | "embed";
    element: string;
    button: string;
    captchaVerifyCallback: (captchaVerifyParam: string) => { captchaResult: boolean };
    onBizResultCallback: () => void;
    getInstance: () => void;
    slideStyle?: { width: number; height: number };
    language?: string;
};

declare global {
    interface Window {
        initAliyunCaptcha?: (options: AliyunInitOptions) => void;
        AliyunCaptchaConfig?: { region: string; prefix: string };
    }
}

const ALIYUN_SCRIPT = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const ALIYUN_POPUP_ID = "aliyunCaptcha-window-popup";
const ALIYUN_MASK_ID = "aliyunCaptcha-mask";
const ALIYUN_POPUP_OPEN_TIMEOUT_MS = 8000;
const ALIYUN_POPUP_WATCH_INTERVAL_MS = 300;

let aliyunPromise: Promise<void> | null = null;

function loadAliyunCaptcha(region: string, prefix: string) {
    // 全局配置必须在脚本求值前就位；region / prefix 全站一致，重复赋值无副作用
    window.AliyunCaptchaConfig = { region: region === "sgp" ? "sgp" : "cn", prefix };
    if (!aliyunPromise) {
        aliyunPromise = new Promise<void>((resolve, reject) => {
            if (window.initAliyunCaptcha) {
                resolve();
                return;
            }
            const script = document.createElement("script");
            script.src = ALIYUN_SCRIPT;
            script.async = true;
            script.onload = () => (window.initAliyunCaptcha ? resolve() : reject(new Error("Aliyun Captcha SDK is unavailable")));
            script.onerror = () => {
                aliyunPromise = null;
                reject(new Error("Failed to load Aliyun Captcha"));
            };
            document.head.append(script);
        });
    }
    return aliyunPromise;
}

const AliyunCaptchaField = forwardRef<CaptchaHandle, { sceneId: string; prefix: string; region: string }>(function AliyunCaptchaField({ sceneId, prefix, region }, ref) {
    const { i18n, t } = useTranslation();
    const id = useRef(`aliyun-captcha-${Math.random().toString(36).slice(2, 10)}`);
    const param = useRef("");
    const pending = useRef<((value: CaptchaPayload | null) => void) | null>(null);
    const watchTimer = useRef<number | null>(null);
    // initAliyunCaptcha 绑定的是按钮事件，重复初始化会叠加回调，因此只做一次
    const initialized = useRef(false);
    const [verified, setVerified] = useState(false);
    const [failed, setFailed] = useState(false);

    const buttonId = `${id.current}-button`;
    const elementId = `${id.current}-element`;

    const settle = useCallback((value: CaptchaPayload | null) => {
        const resolve = pending.current;
        pending.current = null;
        resolve?.(value);
    }, []);

    const stopWatch = useCallback(() => {
        if (watchTimer.current !== null) {
            window.clearInterval(watchTimer.current);
            watchTimer.current = null;
        }
    }, []);

    const initialize = useCallback(() => {
        if (!window.initAliyunCaptcha) return;
        window.initAliyunCaptcha({
            SceneId: sceneId,
            prefix,
            mode: "popup",
            element: `#${elementId}`,
            button: `#${buttonId}`,
            // 这里不发业务请求，只把 captchaVerifyParam 作为凭据交给后端，由后端在业务接口内调阿里云校验
            captchaVerifyCallback: (captchaVerifyParam: string) => {
                stopWatch();
                param.current = captchaVerifyParam;
                setVerified(true);
                settle({ turnstile_token: captchaVerifyParam });
                return { captchaResult: true };
            },
            onBizResultCallback: () => {},
            getInstance: () => {},
            slideStyle: { width: 360, height: 40 },
            language: i18n.resolvedLanguage === "zh-CN" ? "cn" : "en",
        });
    }, [buttonId, elementId, i18n.resolvedLanguage, prefix, sceneId, settle, stopWatch]);

    const isPopupVisible = useCallback(() => {
        const popup = document.getElementById(ALIYUN_POPUP_ID);
        return popup !== null && window.getComputedStyle(popup).display !== "none";
    }, []);

    /**
     * SDK 没有用户关闭弹窗的回调，靠轮询弹窗可见性兜底：
     * 出现过又消失且没产生 param 视为用户主动关闭；迟迟不出现视为打开失败。
     * initAliyunCaptcha 对触发按钮的事件绑定是异步完成的，首次 click 可能落空，因此弹窗出现前每个 tick 重试触发。
     */
    const startWatch = useCallback(() => {
        if (watchTimer.current !== null) return;
        const startedAt = Date.now();
        let seen = false;
        watchTimer.current = window.setInterval(() => {
            if (param.current) {
                stopWatch();
                return;
            }
            if (isPopupVisible()) {
                seen = true;
                return;
            }
            if (seen || Date.now() - startedAt > ALIYUN_POPUP_OPEN_TIMEOUT_MS) {
                stopWatch();
                settle(null);
                return;
            }
            document.getElementById(buttonId)?.click();
        }, ALIYUN_POPUP_WATCH_INTERVAL_MS);
    }, [buttonId, isPopupVisible, settle, stopWatch]);

    useImperativeHandle(
        ref,
        () => ({
            ensure: async () => {
                if (param.current) return { turnstile_token: param.current };
                try {
                    await loadAliyunCaptcha(region, prefix);
                    if (!initialized.current) {
                        initialize();
                        initialized.current = true;
                    }
                } catch {
                    initialized.current = false;
                    setFailed(true);
                    return null;
                }
                return await new Promise<CaptchaPayload | null>((resolve) => {
                    pending.current = resolve;
                    startWatch();
                    document.getElementById(buttonId)?.click();
                });
            },
            reset: () => {
                stopWatch();
                settle(null);
                param.current = "";
                setVerified(false);
            },
        }),
        [buttonId, initialize, prefix, region, settle, startWatch, stopWatch],
    );

    useEffect(
        () => () => {
            stopWatch();
            settle(null);
            // SDK 不会自清理弹窗 DOM，残留会导致下次挂载时回调重复触发
            document.getElementById(ALIYUN_MASK_ID)?.remove();
            document.getElementById(ALIYUN_POPUP_ID)?.remove();
        },
        [settle, stopWatch],
    );

    if (failed) return <CaptchaFailure text={t("auth.captchaLoadFailed")} />;
    return (
        <div className="w-full">
            <button
                id={buttonId}
                type="button"
                className="flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:bg-stone-100 disabled:border-green-300 disabled:bg-green-50 disabled:text-green-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:disabled:border-green-800 dark:disabled:bg-green-950/40 dark:disabled:text-green-400"
                disabled={verified}
            >
                {t(verified ? "auth.captchaVerified" : "auth.captchaClickToVerify")}
            </button>
            <div id={elementId} />
        </div>
    );
});
