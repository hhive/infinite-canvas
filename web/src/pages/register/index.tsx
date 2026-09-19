import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { App, Button, Input, Result, Spin } from "antd";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthShell } from "@/components/auth/auth-shell";
import { CaptchaField, type CaptchaHandle } from "@/components/auth/captcha-field";
import { usePublicSettings } from "@/hooks/use-public-settings";
import { safeRedirect } from "@/lib/safe-redirect";
import { apiErrorMessage } from "@/services/api/request";
import { register, sendVerifyCode, type CaptchaPayload } from "@/services/api/session";
import { refreshSession } from "@/stores/use-session-store";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // 与登录页一样消费 redirect：从 /account/keys 来的用户注册完应该回到原页，而不是被丢到概览。
    const redirectTo = safeRedirect(searchParams.get("redirect"));
    const { settings, error: settingsError, retry: retrySettings } = usePublicSettings();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [verifyCode, setVerifyCode] = useState("");
    const [invitationCode, setInvitationCode] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const captcha = useRef<CaptchaHandle | null>(null);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
        return () => window.clearTimeout(timer);
    }, [countdown]);

    const sendCode = async () => {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) return message.error(t("auth.emailRequired"));
        if (!EMAIL_PATTERN.test(normalizedEmail)) return message.error(t("auth.emailInvalid"));
        const proof = await captcha.current?.ensure();
        if (!proof) return message.error(t("auth.captchaRequired"));
        setSendingCode(true);
        try {
            setCountdown(await sendVerifyCode(normalizedEmail, proof));
            message.success(t("auth.verifyCodeSent"));
        } catch (error) {
            message.error(apiErrorMessage(error, t("auth.sendVerifyCodeFailed"), t("common.networkError")));
        } finally {
            // 凭据已随请求消耗，成功与否都要重新验证
            captcha.current?.reset();
            setSendingCode(false);
        }
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const normalizedEmail = email.trim();
        if (!normalizedEmail) return message.error(t("auth.emailRequired"));
        if (!EMAIL_PATTERN.test(normalizedEmail)) return message.error(t("auth.emailInvalid"));
        if (!password) return message.error(t("auth.passwordRequired"));
        if (password.length < 6) return message.error(t("auth.passwordTooShort"));
        if (!confirmPassword) return message.error(t("auth.confirmPasswordRequired"));
        if (password !== confirmPassword) return message.error(t("auth.passwordMismatch"));
        if (settings?.invitationCodeEnabled && !invitationCode.trim()) return message.error(t("auth.invitationCodeRequired"));
        if (settings?.emailVerifyEnabled && !verifyCode.trim()) return message.error(t("auth.verifyCodeRequired"));
        // 走邮箱验证注册时验证码已在「发送验证码」那一步消耗，上游也会跳过重复校验，
        // 此时再要一份凭据会直接把用户卡在客户端校验上。
        const verifyCodeUsed = Boolean(settings?.emailVerifyEnabled && verifyCode.trim());
        let proof: CaptchaPayload = {};
        if (!verifyCodeUsed) {
            const result = await captcha.current?.ensure();
            if (!result) return message.error(t("auth.captchaRequired"));
            proof = result;
        }
        setSubmitting(true);
        try {
            await register({
                email: normalizedEmail,
                password,
                ...(verifyCodeUsed ? { verify_code: verifyCode.trim() } : {}),
                ...(settings?.invitationCodeEnabled ? { invitation_code: invitationCode.trim() } : {}),
                ...proof,
            });
            await refreshSession();
            message.success(t("auth.registerSuccess"));
            navigate(redirectTo, { replace: true });
        } catch (error) {
            if (!verifyCodeUsed) captcha.current?.reset();
            message.error(apiErrorMessage(error, t("auth.registerFailed"), t("common.networkError")));
        } finally {
            setSubmitting(false);
        }
    };

    const shell = (children: ReactNode) => (
        <AuthShell
            title={t("auth.registerTitle")}
            subtitle={t("auth.registerSubtitle")}
            footer={
                <Link to="/login" className="font-medium text-stone-950 hover:underline dark:text-stone-100">
                    {t("auth.toLogin")}
                </Link>
            }
        >
            {children}
        </AuthShell>
    );

    if (settingsError) {
        return shell(
            <div className="space-y-4 text-center">
                <ExclamationCircleOutlined className="text-2xl text-stone-400" />
                <p className="break-words text-sm text-stone-500 dark:text-stone-400">{settingsError}</p>
                <Button block onClick={retrySettings}>
                    {t("account.retry")}
                </Button>
            </div>,
        );
    }

    if (!settings) {
        return shell(
            <div className="flex h-32 items-center justify-center">
                <Spin />
            </div>,
        );
    }

    // 注册开关关闭时直接给出说明，不渲染一个必然被服务端拒绝的表单
    if (!settings.registrationEnabled) {
        return shell(<Result status="info" title={t("auth.registrationClosed")} subTitle={t("auth.registrationClosedHint")} extra={<Link to="/login">{t("auth.submitLogin")}</Link>} />);
    }

    return shell(
        <form className="space-y-4" onSubmit={submit}>
            <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.email")}</span>
                <Input size="large" type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {settings.emailVerifyEnabled ? (
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.verifyCode")}</span>
                    <div className="flex gap-2">
                        <Input className="min-w-0 flex-1" size="large" inputMode="numeric" placeholder={t("auth.verifyCodePlaceholder")} value={verifyCode} onChange={(event) => setVerifyCode(event.target.value)} />
                        {/* 必须显式声明 button：否则在表单里会被当成提交按钮，点发送会连带提交注册 */}
                        <Button htmlType="button" size="large" className="shrink-0" loading={sendingCode} disabled={countdown > 0} onClick={sendCode}>
                            {countdown > 0 ? t("auth.resendVerifyCode", { seconds: countdown }) : t("auth.sendVerifyCode")}
                        </Button>
                    </div>
                </label>
            ) : null}
            <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.password")}</span>
                <Input.Password size="large" autoComplete="new-password" placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.confirmPassword")}</span>
                <Input.Password size="large" autoComplete="new-password" placeholder={t("auth.confirmPasswordPlaceholder")} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {settings.invitationCodeEnabled ? (
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{t("auth.invitationCode")}</span>
                    <Input size="large" placeholder={t("auth.invitationCodePlaceholder")} value={invitationCode} onChange={(event) => setInvitationCode(event.target.value)} />
                </label>
            ) : null}
            <CaptchaField ref={captcha} settings={settings} />
            <Button type="primary" size="large" block htmlType="submit" loading={submitting}>
                {t("auth.submitRegister")}
            </Button>
        </form>,
    );
}
