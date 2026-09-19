import { useState } from "react";
import { App, Button, Input, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AccountEmptyState, AccountErrorState, AccountPanel } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { formatAmount, formatTime } from "@/pages/account/format";
import { usePublicSettings } from "@/hooks/use-public-settings";
import { apiErrorMessage } from "@/services/api/request";
import { fetchRedeemHistory, redeemCode, type RedeemHistoryItem } from "@/services/api/user-center";

const PAGE_SIZE = 20;

export default function AccountRedeemPage() {
    const { t } = useTranslation();
    const { settings } = usePublicSettings();
    const purchaseUrl = settings?.redeemPurchaseUrl ?? "";

    return (
        <div className="space-y-6">
            {/*
              购买跳转来自 Sub2API 的公开设置，为空时整块隐藏，不展示一个不可用的按钮。

              刻意不把跳转地址打印在界面上：那是第三方购码站域名，对客户只暴露我们自己的入口即可
              （说明文案保持中性，不出现该域名）。
            */}
            {purchaseUrl ? (
                <AccountPanel
                    title={t("account.redeemPurchase")}
                    description={t("account.redeemPurchaseHint")}
                    extra={
                        <Button type="primary" icon={<ExternalLink className="size-4" />} href={purchaseUrl} target="_blank" rel="noopener noreferrer">
                            {t("account.redeemPurchase")}
                        </Button>
                    }
                />
            ) : null}

            <AccountSessionGate>
                <AccountRedeem />
            </AccountSessionGate>
        </div>
    );
}

function AccountRedeem() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [code, setCode] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const history = useAccountResource((signal) => fetchRedeemHistory(page, PAGE_SIZE, signal), [page]);

    const typeText = (type: string) => ({ balance: t("account.redeemTypeBalance"), concurrency: t("account.redeemTypeConcurrency") })[type] ?? type;

    const submit = () => {
        const trimmed = code.trim();
        if (!trimmed) return message.error(t("account.redeemCodeRequired"));
        modal.confirm({
            title: t("account.redeemTitle"),
            content: t("account.redeemConfirm"),
            okText: t("account.confirm"),
            cancelText: t("account.cancel"),
            onOk: async () => {
                setSubmitting(true);
                try {
                    const result = await redeemCode(trimmed);
                    setCode("");
                    message.success(t("account.redeemSuccess", { value: formatAmount(result.value) }));
                    if (history.data && history.data.items.length === PAGE_SIZE && page === 1) history.reload();
                    else setPage(1);
                } catch (error) {
                    message.error(apiErrorMessage(error, t("account.redeemFailed"), t("common.networkError")));
                } finally {
                    setSubmitting(false);
                }
            },
        });
    };

    const columns: ColumnsType<RedeemHistoryItem> = [
        { title: t("account.redeemHistoryCode"), dataIndex: "code", render: (value: string) => <code className="break-all text-xs text-stone-500 dark:text-stone-400">{value}</code> },
        { title: t("account.redeemHistoryValue"), key: "value", width: 160, render: (_, item) => <span className="tabular-nums">{`${typeText(item.type)} ${formatAmount(item.value)}`}</span> },
        { title: t("account.redeemHistoryStatus"), dataIndex: "status", width: 110, render: (value: string) => <Tag color={value === "used" ? "green" : "default"}>{value === "used" ? t("account.redeemHistoryUsed") : value}</Tag> },
        { title: t("account.redeemHistoryUsedAt"), dataIndex: "used_at", width: 170, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
        { title: t("account.redeemHistoryCreatedAt"), dataIndex: "created_at", width: 170, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
    ];

    return (
        <div className="space-y-6">
            <AccountPanel title={t("account.redeemTitle")} description={t("account.redeemHint")}>
                <div className="flex flex-wrap items-center gap-3">
                    <Input className="min-w-64 flex-1" size="large" placeholder={t("account.redeemCodePlaceholder")} value={code} onChange={(event) => setCode(event.target.value)} onPressEnter={submit} />
                    <Button type="primary" size="large" loading={submitting} onClick={submit}>
                        {t("account.redeemSubmit")}
                    </Button>
                </div>
            </AccountPanel>

            <AccountPanel title={t("account.redeemHistory")}>
                {history.error ? (
                    <AccountErrorState error={history.error} onRetry={history.reload} />
                ) : (
                    <Table<RedeemHistoryItem>
                        rowKey="id"
                        size="small"
                        columns={columns}
                        dataSource={history.data?.items ?? []}
                        loading={history.loading}
                        scroll={{ x: 840 }}
                        locale={{ emptyText: <AccountEmptyState text={t("account.redeemHistoryEmpty")} /> }}
                        pagination={{ current: page, pageSize: PAGE_SIZE, total: history.data?.total ?? 0, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                    />
                )}
            </AccountPanel>
        </div>
    );
}
