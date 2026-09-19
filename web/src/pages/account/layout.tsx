import { useState } from "react";
import { App, Button, Popconfirm } from "antd";
import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { apiErrorMessage } from "@/services/api/request";
import { logout } from "@/services/api/session";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/use-session-store";
import { useUserCenterSession } from "@/pages/account/components/session-gate";

const tabs = [
    { to: "/account", labelKey: "account.navOverview", end: true },
    { to: "/account/keys", labelKey: "account.navKeys", end: false },
    { to: "/account/usage", labelKey: "account.navUsage", end: false },
    { to: "/account/balance", labelKey: "account.navBalance", end: false },
    { to: "/account/redeem", labelKey: "account.navRedeem", end: false },
];

export default function AccountLayout() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useSessionStore((state) => state.user);
    const clear = useSessionStore((state) => state.clear);
    const { ready } = useUserCenterSession();
    const [loggingOut, setLoggingOut] = useState(false);

    const signOut = async () => {
        setLoggingOut(true);
        try {
            await logout();
            clear();
            message.success(t("account.logoutSuccess"));
            navigate("/", { replace: true });
        } catch (error) {
            message.error(apiErrorMessage(error, t("account.logoutFailed"), t("common.networkError")));
        } finally {
            setLoggingOut(false);
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-800 dark:text-stone-100">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("account.title")}</h1>
                        {ready && user ? <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{user.username || user.email}</p> : null}
                    </div>
                    {ready ? (
                        <Popconfirm title={t("account.logout")} description={t("account.logoutConfirm")} okText={t("account.confirm")} cancelText={t("account.cancel")} onConfirm={signOut}>
                            <Button icon={<LogOut className="size-4" />} loading={loggingOut}>
                                {t("account.logout")}
                            </Button>
                        </Popconfirm>
                    ) : null}
                </header>

                <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
                    <nav className="hide-scrollbar flex gap-1 overflow-x-auto border-b border-stone-200 pb-2 lg:sticky lg:top-6 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4 dark:border-stone-800">
                        {tabs.map((tab) => (
                            <NavLink
                                key={tab.to}
                                to={tab.to}
                                end={tab.end}
                                className={({ isActive }) =>
                                    cn(
                                        "shrink-0 rounded-lg px-3 py-2 text-sm transition whitespace-nowrap",
                                        isActive ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                                    )
                                }
                            >
                                {t(tab.labelKey)}
                            </NavLink>
                        ))}
                    </nav>
                    <section className="min-w-0">
                        <Outlet />
                    </section>
                </div>
            </div>
        </main>
    );
}
