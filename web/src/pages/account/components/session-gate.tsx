import { useEffect, type ReactNode } from "react";
import { Button, Spin } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ensureSessionLoaded, useSessionStore } from "@/stores/use-session-store";

/**
 * 只有密码登录建立的会话才视为用户中心可用会话。
 * launch 会话的身份来自 Sub2API 跳转，用户中心在原站更完整；
 * 无会话是 C 模式（生成页手填 API Key）的正常状态。
 * 两种情况下都只做引导，绝不重定向——重定向会直接堵死 C 模式。
 */
export function useUserCenterSession() {
    const authSource = useSessionStore((state) => state.authSource);
    const loaded = useSessionStore((state) => state.loaded);

    useEffect(() => {
        void ensureSessionLoaded();
    }, []);

    return { authSource, loaded, ready: loaded && authSource === "password" };
}

export function AccountSessionGate({ children }: { children: ReactNode }) {
    const { loaded, authSource, ready } = useUserCenterSession();

    if (!loaded) {
        return (
            <div className="flex h-60 items-center justify-center">
                <Spin />
            </div>
        );
    }
    if (ready) return <>{children}</>;
    return <AccountLoginGuide launch={authSource === "launch"} />;
}

export function AccountLoginGuide({ launch }: { launch: boolean }) {
    const { t } = useTranslation();
    const { pathname, search } = useLocation();
    const redirectTo = encodeURIComponent(`${pathname}${search}`);

    return (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center dark:border-stone-800 dark:bg-stone-950">
            <h2 className="text-base font-semibold text-stone-950 dark:text-stone-100">{t("account.loginRequired")}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-500 dark:text-stone-400">{launch ? t("account.launchGuideHint") : t("account.loginRequiredHint")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Link to={`/login?redirect=${redirectTo}`}>
                    <Button type="primary">{t("account.goLogin")}</Button>
                </Link>
                <Link to={`/register?redirect=${redirectTo}`}>
                    <Button>{t("account.goRegister")}</Button>
                </Link>
            </div>
        </div>
    );
}
