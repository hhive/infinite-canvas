import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { App, Button, Input, Spin } from "antd";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthShell } from "@/components/auth/auth-shell";
import { CaptchaField, type CaptchaHandle } from "@/components/auth/captcha-field";
import { usePublicSettings } from "@/hooks/use-public-settings";
import { safeRedirect } from "@/lib/safe-redirect";
import { apiErrorMessage } from "@/services/api/request";
import { login as loginRequest, loginWithTotp, type PendingLogin } from "@/services/api/session";
import { ensureSessionLoaded, refreshSession, useSessionStore } from "@/stores/use-session-store";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirectTo = safeRedirect(searchParams.get("redirect"));
    const { settings, error: settingsError, retry: retrySettings } = usePublicSettings();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [pending, setPending] = useState<PendingLogin | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const captcha = useRef<CaptchaHandle | null>(null);
    const authSource = useSessionStore((state) => state.authSource);
    const sessionLoaded = useSessionStore((state) => state.loaded);

    useEffect(() => {
        void ensureSessionLoaded();
    }, []);

    // 已通过 media 账号登录时不再展示登录表单；launch 会话不在这里跳转，避免挡住另一条进入路径
    useEffect(() => {
        if (sessionLoaded && authSource === "password") navigate(redirectTo, { replace: true });
    }, [authSource, navigate, redirectTo, sessionLoaded]);

    const finishLogin = async () => {
        await refreshSession();
        message.success(t("auth.loginSuccess"));
        navigate(redirectTo, { replace: true });
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const normalizedEmail = email.trim();
        if (!normalizedEmail) return message.error(t("auth.emailRequired"));
        if (!EMAIL_PATTERN.test(normalizedEmail)) return message.error(t("auth.emailInvalid"));
        if (!password) return message.error(t("auth.passwordRequired"));
        const proof = await captcha.current?.ensure();
        if (!proof) return message.error(t("auth.captchaRequired"));
        setSubmitting(true);
        try {
            const result = await loginRequest({ email: normalizedEmail, password, ...proof });
            if (result) {
                setPassword("");
                setTotpCode("");
                setPending(result);
                return;
            }
            await finishLogin();
        } catch (error) {
            // 一次性凭据已随请求消耗，失败后必须重新验证
            captcha.current?.reset();
            message.error(apiErrorMessage(error, t("auth.loginFailed"), t("common.networkError")));
        } finally {
            setSubmitting(false);
        }
    };

    const submitTotp = async (event: FormEvent) => {
        event.preventDefault();
        if (!pending) return;
        const code = totpCode.trim();
        if (!/^\d{6}$/.test(code)) return message.error(t("auth.totpRequired"));
        setSubmitting(true);
        try {
            await loginWithTotp(code);
            await finishLogin();
        } catch (error) {
            setTotpCode("");
            message.error(apiErrorMessage(error, t("auth.loginFailed"), t("common.networkError")));
        } finally {
            setSubmitting(false);
        }
    };

    if (pending) {
        return (
            <AuthShell title={t("auth.totpTitle")} subtitle={t("auth.totpSubtitle")}>
                <form className="space-y-4" onSubmit={submitTotp}>
                    {pending.emailMasked ? <p className="text-xs text-stone-500 dark:text-stone-400">{t("auth.totpHint", { email: pending.emailMasked })}</p> : null}
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.totpCode")}</span>
                        <Input size="large" autoFocus inputMode="numeric" maxLength={6} placeholder={t("auth.totpCodePlaceholder")} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))} />
                    </label>
                    <Button type="primary" size="large" block htmlType="submit" loading={submitting}>
                        {t("auth.totpSubmit")}
                    </Button>
                    <Button type="text" block onClick={() => setPending(null)}>
                        {t("auth.totpBack")}
                    </Button>
                </form>
            </AuthShell>
        );
    }

    if (settingsError) {
        return (
            <AuthShell title={t("auth.loginTitle")} subtitle={t("auth.loginSubtitle")}>
                <div className="space-y-4 text-center">
                    <ExclamationCircleOutlined className="text-2xl text-stone-400" />
                    <p className="break-words text-sm text-stone-500 dark:text-stone-400">{settingsError}</p>
                    <Button block onClick={retrySettings}>
                        {t("account.retry")}
                    </Button>
                </div>
            </AuthShell>
        );
    }

    if (!settings) {
        return (
            <AuthShell title={t("auth.loginTitle")} subtitle={t("auth.loginSubtitle")}>
                <div className="flex h-32 items-center justify-center">
                    <Spin />
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title={t("auth.loginTitle")}
            subtitle={t("auth.loginSubtitle")}
            footer={
                settings.registrationEnabled ? (
                    <Link to="/register" className="font-medium text-stone-950 hover:underline dark:text-stone-100">
                        {t("auth.toRegister")}
                    </Link>
                ) : null
            }
        >
            <form className="space-y-4" onSubmit={submit}>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.email")}</span>
                    <Input size="large" type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.password")}</span>
                    <Input.Password size="large" autoComplete="current-password" placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <CaptchaField ref={captcha} settings={settings} />
                <Button type="primary" size="large" block htmlType="submit" loading={submitting}>
                    {t("auth.submitLogin")}
                </Button>
            </form>
        </AuthShell>
    );
}

