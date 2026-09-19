import { useEffect, type ReactNode } from "react";
import { Button, Spin, Tag } from "antd";
import { KeyRound, Receipt, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AccountErrorState, AccountPanel, AccountStatTile } from "@/pages/account/components/panel";
import { AccountSessionGate, useUserCenterSession } from "@/pages/account/components/session-gate";
import { formatAmount, formatCount } from "@/pages/account/format";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { fetchDashboardStats, fetchProfile } from "@/services/api/user-center";
import { useSessionStore } from "@/stores/use-session-store";
import { ensureMediaAPIKeysLoaded, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

export default function AccountOverviewPage() {
    return (
        <AccountSessionGate>
            <AccountOverview />
        </AccountSessionGate>
    );
}

function AccountOverview() {
    const { t } = useTranslation();
    const sessionUser = useSessionStore((state) => state.user);
    const { ready } = useUserCenterSession();
    const profile = useAccountResource((signal) => fetchProfile(signal));
    const stats = useAccountResource((signal) => fetchDashboardStats(signal));
    const keys = useMediaAPIKeyStore((state) => state.keys);
    const keyStatus = useMediaAPIKeyStore((state) => state.status);

    useEffect(() => {
        if (ready) void ensureMediaAPIKeysLoaded();
    }, [ready]);

    const currentKey = keys.find((key) => key.current) ?? null;
    const name = profile.data?.username || sessionUser?.username || profile.data?.email || sessionUser?.email || "";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{t("account.overviewGreeting", { name })}</h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t("account.overviewBalanceHint")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <AccountStatTile label={t("account.overviewTodayRequests")} value={formatCount(stats.data?.today_requests)} />
                <AccountStatTile label={t("account.overviewTodayCost")} value={formatAmount(stats.data?.today_actual_cost)} />
                <AccountStatTile label={t("account.overviewTotalRequests")} value={formatCount(stats.data?.total_requests)} />
                <AccountStatTile label={t("account.overviewTotalCost")} value={formatAmount(stats.data?.total_actual_cost)} />
            </div>

            <AccountPanel title={t("account.overviewBalance")} extra={<Link to="/account/balance"><Button size="small">{t("account.navBalance")}</Button></Link>}>
                {profile.error ? (
                    <AccountErrorState error={profile.error} onRetry={profile.reload} />
                ) : profile.loading ? (
                    <div className="flex h-20 items-center justify-center">
                        <Spin />
                    </div>
                ) : (
                    <div className="text-3xl font-bold tabular-nums text-stone-950 dark:text-stone-100">{formatAmount(profile.data?.balance)}</div>
                )}
            </AccountPanel>

            <AccountPanel title={t("account.overviewCurrentKey")} description={t("account.overviewCurrentKeyHint")} extra={<Link to="/account/keys"><Button size="small">{t("account.manageKeys")}</Button></Link>}>
                {keyStatus === "loading" || keyStatus === "idle" ? (
                    <div className="flex h-16 items-center justify-center">
                        <Spin />
                    </div>
                ) : currentKey ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <Tag color="blue">{currentKey.groupName}</Tag>
                        <span className="font-medium text-stone-950 dark:text-stone-100">{currentKey.name}</span>
                        <code className="text-xs text-stone-500 dark:text-stone-400">{currentKey.maskedKey}</code>
                    </div>
                ) : (
                    <div className="text-sm text-stone-500 dark:text-stone-400">
                        <p>{t("account.overviewNoKey")}</p>
                        <p className="mt-1 text-xs">{t("account.overviewNoKeyHint")}</p>
                    </div>
                )}
            </AccountPanel>

            <AccountPanel title={t("account.overviewShortcuts")}>
                <div className="grid gap-3 sm:grid-cols-3">
                    <Shortcut to="/account/keys" icon={<KeyRound className="size-4" />} label={t("account.navKeys")} />
                    <Shortcut to="/account/usage" icon={<Receipt className="size-4" />} label={t("account.navUsage")} />
                    <Shortcut to="/account/redeem" icon={<Ticket className="size-4" />} label={t("account.navRedeem")} />
                </div>
            </AccountPanel>
        </div>
    );
}

function Shortcut({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
    return (
        <Link to={to} className="flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-3 text-sm transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-600 dark:hover:bg-stone-900">
            {icon}
            <span className="font-medium text-stone-950 dark:text-stone-100">{label}</span>
        </Link>
    );
}
