import { useState } from "react";
import { Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";

import { AccountEmptyState, AccountErrorState, AccountPanel } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { formatAmount, formatTime } from "@/pages/account/format";
import { fetchBalanceCredits, fetchProfile, type BalanceCredit } from "@/services/api/user-center";

const PAGE_SIZE = 20;

export default function AccountBalancePage() {
    return (
        <AccountSessionGate>
            <AccountBalance />
        </AccountSessionGate>
    );
}

function AccountBalance() {
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const profile = useAccountResource((signal) => fetchProfile(signal));
    const credits = useAccountResource((signal) => fetchBalanceCredits(page, PAGE_SIZE, signal), [page]);

    const statusText = (status: string) =>
        ({ active: t("account.balanceCreditStatusActive"), consumed: t("account.balanceCreditStatusConsumed"), expired: t("account.balanceCreditStatusExpired") })[status] ?? status;

    const statusColor = (status: string) => ({ active: "green", consumed: "default", expired: "red" })[status] ?? "default";

    const sourceText = (source: string) => ({ redeem: t("account.balanceCreditSourceRedeem"), admin: t("account.balanceCreditSourceAdmin") })[source] ?? source;

    const columns: ColumnsType<BalanceCredit> = [
        { title: t("account.balanceCreditSource"), dataIndex: "source_type", width: 130, render: (value: string) => sourceText(value) },
        { title: t("account.balanceCreditAmount"), dataIndex: "amount", width: 130, render: (value: number) => <span className="tabular-nums text-stone-500 dark:text-stone-400">{formatAmount(value)}</span> },
        { title: t("account.balanceCreditRemaining"), dataIndex: "remaining_amount", width: 130, render: (value: number) => <span className="font-medium tabular-nums text-stone-950 dark:text-stone-100">{formatAmount(value)}</span> },
        { title: t("account.balanceCreditStatus"), dataIndex: "status", width: 110, render: (value: string) => <Tag color={statusColor(value)}>{statusText(value)}</Tag> },
        { title: t("account.balanceCreditExpires"), dataIndex: "expires_at", width: 170, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value ? formatTime(value) : t("account.balanceCreditNeverExpires")}</span> },
        { title: t("account.redeemHistoryCreatedAt"), dataIndex: "created_at", width: 170, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
    ];

    return (
        <div className="space-y-6">
            <AccountPanel title={t("account.balanceTitle")} description={t("account.balanceHint")}>
                {profile.error ? (
                    <AccountErrorState error={profile.error} onRetry={profile.reload} />
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <div className="text-xs text-stone-500 dark:text-stone-400">{t("account.balanceAvailable")}</div>
                            <div className={`mt-1 text-3xl font-bold tabular-nums ${profile.loading ? "text-stone-300 dark:text-stone-700" : "text-stone-950 dark:text-stone-100"}`}>{formatAmount(profile.data?.balance)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-stone-500 dark:text-stone-400">{t("account.balanceFrozen")}</div>
                            <div className="mt-1 text-3xl font-bold tabular-nums text-stone-400 dark:text-stone-600">{formatAmount(profile.data?.frozen_balance ?? 0)}</div>
                        </div>
                    </div>
                )}
            </AccountPanel>

            <AccountPanel title={t("account.balanceCredits")}>
                {credits.error ? (
                    <AccountErrorState error={credits.error} onRetry={credits.reload} />
                ) : (
                    <Table<BalanceCredit>
                        rowKey="id"
                        size="small"
                        columns={columns}
                        dataSource={credits.data?.items ?? []}
                        loading={credits.loading}
                        scroll={{ x: 840 }}
                        locale={{ emptyText: <AccountEmptyState text={t("account.balanceCreditsEmpty")} /> }}
                        pagination={{ current: page, pageSize: PAGE_SIZE, total: credits.data?.total ?? 0, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                    />
                )}
            </AccountPanel>
        </div>
    );
}
