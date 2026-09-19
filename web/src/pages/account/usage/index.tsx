import { useState } from "react";
import { Button, DatePicker, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { AccountEmptyState, AccountErrorState, AccountPanel, AccountStatTile } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { browserTimezone, formatAmount, formatCount, formatDateParam, formatTime } from "@/pages/account/format";
import { fetchAPIKeys, fetchDashboardModels, fetchDashboardStats, fetchUsage, type UsageLog } from "@/services/api/user-center";

const PAGE_SIZE = 20;

export default function AccountUsagePage() {
    return (
        <AccountSessionGate>
            <AccountUsage />
        </AccountSessionGate>
    );
}

function AccountUsage() {
    const { t } = useTranslation();
    const [page, setPage] = useState(1);
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
    const [model, setModel] = useState<string | undefined>();
    const [apiKeyId, setAPIKeyId] = useState<number | undefined>();

    const startDate = range ? formatDateParam(range[0].toDate()) : undefined;
    const endDate = range ? formatDateParam(range[1].toDate()) : undefined;
    const dateRange = { start_date: startDate, end_date: endDate, timezone: browserTimezone() };

    const stats = useAccountResource((signal) => fetchDashboardStats(signal));
    const models = useAccountResource((signal) => fetchDashboardModels(dateRange, signal), [startDate, endDate]);
    const keys = useAccountResource((signal) => fetchAPIKeys(1, 100, signal));
    const usage = useAccountResource((signal) => fetchUsage({ page, page_size: PAGE_SIZE, ...dateRange, model, api_key_id: apiKeyId }, signal), [page, startDate, endDate, model, apiKeyId]);

    const resetFilters = () => {
        setRange(null);
        setModel(undefined);
        setAPIKeyId(undefined);
        setPage(1);
    };

    const columns: ColumnsType<UsageLog> = [
        { title: t("account.usageTime"), dataIndex: "created_at", width: 170, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
        { title: t("account.usageModel"), dataIndex: "model", render: (value: string) => <span className="font-medium text-stone-950 dark:text-stone-100">{value || "-"}</span> },
        { title: "Endpoint", dataIndex: "inbound_endpoint", width: 200, render: (value: string | null) => <code className="break-all text-xs text-stone-500 dark:text-stone-400">{value || "-"}</code> },
        {
            title: t("account.usageAmount"),
            key: "amount",
            width: 130,
            render: (_, log) => <span className="tabular-nums">{(log.image_count ?? 0) > 0 ? `${formatCount(log.image_count)} 张` : formatCount(log.input_tokens + log.output_tokens)}</span>,
        },
        { title: t("account.usageStandardCost"), dataIndex: "total_cost", width: 120, render: (value: number) => <span className="tabular-nums text-stone-500 dark:text-stone-400">{formatAmount(value)}</span> },
        { title: t("account.usageCost"), dataIndex: "actual_cost", width: 120, render: (value: number) => <span className="font-medium tabular-nums text-stone-950 dark:text-stone-100">{formatAmount(value)}</span> },
    ];

    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <AccountStatTile label={t("account.overviewTotalRequests")} value={formatCount(stats.data?.total_requests)} />
                <AccountStatTile label={t("account.usageTokens")} value={formatCount(stats.data?.total_tokens)} />
                <AccountStatTile label={t("account.overviewTotalCost")} value={formatAmount(stats.data?.total_actual_cost)} />
                <AccountStatTile label={t("account.overviewTodayCost")} value={formatAmount(stats.data?.today_actual_cost)} />
            </div>

            <AccountPanel title={t("account.usageTitle")} description={t("account.usageHint")}>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <DatePicker.RangePicker
                        value={range}
                        onChange={(value) => {
                            setRange(value && value[0] && value[1] ? [value[0], value[1]] : null);
                            setPage(1);
                        }}
                    />
                    <Select
                        allowClear
                        className="min-w-48"
                        placeholder={t("account.usageModelPlaceholder")}
                        value={model}
                        onChange={(value) => {
                            setModel(value);
                            setPage(1);
                        }}
                        options={(models.data?.models ?? []).map((item) => ({ value: item.model, label: `${item.model}（${formatCount(item.requests)}）` }))}
                    />
                    <Select
                        allowClear
                        className="min-w-48"
                        placeholder={t("account.usageAPIKeyPlaceholder")}
                        value={apiKeyId}
                        onChange={(value) => {
                            setAPIKeyId(value);
                            setPage(1);
                        }}
                        options={(keys.data?.items ?? []).map((key) => ({ value: key.id, label: key.name }))}
                    />
                    <Button onClick={resetFilters}>{t("account.usageReset")}</Button>
                </div>

                {usage.error ? (
                    <AccountErrorState error={usage.error} onRetry={usage.reload} />
                ) : (
                    <Table<UsageLog>
                        rowKey="id"
                        size="small"
                        columns={columns}
                        dataSource={usage.data?.items ?? []}
                        loading={usage.loading}
                        scroll={{ x: 900 }}
                        locale={{ emptyText: <AccountEmptyState text={t("account.empty")} /> }}
                        pagination={{ current: page, pageSize: PAGE_SIZE, total: usage.data?.total ?? 0, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                    />
                )}
            </AccountPanel>

            <AccountPanel title={t("account.usageModelBreakdown")}>
                {models.error ? (
                    <AccountErrorState error={models.error} onRetry={models.reload} />
                ) : (
                    <Table
                        rowKey="model"
                        size="small"
                        loading={models.loading}
                        dataSource={models.data?.models ?? []}
                        pagination={false}
                        locale={{ emptyText: <AccountEmptyState text={t("account.empty")} /> }}
                        columns={[
                            { title: t("account.usageModel"), dataIndex: "model" },
                            { title: t("account.usageRequests"), dataIndex: "requests", width: 140, render: (value: number) => <span className="tabular-nums">{formatCount(value)}</span> },
                            { title: t("account.usageTokens"), dataIndex: "total_tokens", width: 160, render: (value: number) => <span className="tabular-nums">{formatCount(value)}</span> },
                            { title: t("account.usageCost"), dataIndex: "actual_cost", width: 140, render: (value: number) => <span className="tabular-nums">{formatAmount(value)}</span> },
                        ]}
                    />
                )}
            </AccountPanel>
        </div>
    );
}
