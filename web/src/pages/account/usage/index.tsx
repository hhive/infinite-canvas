import { useState } from "react";
import { Button, DatePicker, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { AccountEmptyState, AccountErrorState, AccountPanel, AccountStatTile } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { browserTimezone, formatAmount, formatCount, formatDateParam, formatDuration, formatTime } from "@/pages/account/format";
import { fetchAPIKeys, fetchDashboardModels, fetchUsage, fetchUsageStats, usageLogTotalTokens, type UsageLog } from "@/services/api/user-center";

const PAGE_SIZE = 20;

/** 默认时间范围：最近 24 小时，与 Sub2API 面板一致，也保证 `/usage/stats` 恒有范围。 */
function defaultUsageRange(): [Dayjs, Dayjs] {
    return [dayjs().subtract(24, "hour"), dayjs()];
}

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
    const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultUsageRange);
    const [model, setModel] = useState<string | undefined>();
    const [apiKeyId, setAPIKeyId] = useState<number | undefined>();

    const startDate = formatDateParam(range[0].toDate());
    const endDate = formatDateParam(range[1].toDate());
    const dateRange = { start_date: startDate, end_date: endDate, timezone: browserTimezone() };

    // 统计卡与 Sub2API 面板同源：`/usage/stats` 随日期范围与筛选变化。
    // 此前用 `/usage/dashboard/stats`（无参、全生命周期），导致改筛选时卡片纹丝不动。
    const stats = useAccountResource((signal) => fetchUsageStats(dateRange, signal), [startDate, endDate, model, apiKeyId]);
    // 模型统计表同样要跟随筛选，否则改了模型/Key 它不联动。
    const models = useAccountResource((signal) => fetchDashboardModels({ ...dateRange, model, api_key_id: apiKeyId }, signal), [startDate, endDate, model, apiKeyId]);
    const keys = useAccountResource((signal) => fetchAPIKeys(1, 100, signal));
    const usage = useAccountResource((signal) => fetchUsage({ page, page_size: PAGE_SIZE, ...dateRange, model, api_key_id: apiKeyId }, signal), [page, startDate, endDate, model, apiKeyId]);

    const resetFilters = () => {
        setRange(defaultUsageRange());
        setModel(undefined);
        setAPIKeyId(undefined);
        setPage(1);
    };

    const columns: ColumnsType<UsageLog> = [
        { title: t("account.usageTime"), dataIndex: "created_at", width: 170, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
        { title: t("account.usageAPIKey"), dataIndex: "api_key", width: 150, render: (_, log) => <span className="text-stone-500 dark:text-stone-400">{log.api_key?.name || "-"}</span> },
        { title: t("account.usageModel"), dataIndex: "model", render: (value: string) => <span className="font-medium text-stone-950 dark:text-stone-100">{value || "-"}</span> },
        { title: t("account.usageReasoningEffort"), dataIndex: "reasoning_effort", width: 120, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value || "-"}</span> },
        { title: t("account.usageEndpoint"), dataIndex: "inbound_endpoint", width: 200, render: (value: string | null) => <code className="break-all text-xs text-stone-500 dark:text-stone-400">{value || "-"}</code> },
        { title: t("account.usageIP"), dataIndex: "ip_address", width: 140, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value || "-"}</span> },
        { title: t("account.usageGroup"), dataIndex: "group", width: 130, render: (_, log) => <span className="text-stone-500 dark:text-stone-400">{log.group?.name || "-"}</span> },
        { title: t("account.usageRequestType"), dataIndex: "request_type", width: 110, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value || "-"}</span> },
        { title: t("account.usageBillingMode"), dataIndex: "billing_mode", width: 120, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value || "-"}</span> },
        {
            title: t("account.usageAmount"),
            key: "amount",
            width: 130,
            // Token 口径与 Sub2API 一致（含缓存）：用户端 DTO 无 total_tokens 字段，故在此求和，
            // 否则此列与同页 Token 统计卡会互相矛盾。
            render: (_, log) => <span className="tabular-nums">{(log.image_count ?? 0) > 0 ? `${formatCount(log.image_count)} 张` : formatCount(usageLogTotalTokens(log))}</span>,
        },
        { title: t("account.usageStandardCost"), dataIndex: "total_cost", width: 120, render: (value: number) => <span className="tabular-nums text-stone-500 dark:text-stone-400">{formatAmount(value)}</span> },
        { title: t("account.usageCost"), dataIndex: "actual_cost", width: 120, render: (value: number) => <span className="font-medium tabular-nums text-stone-950 dark:text-stone-100">{formatAmount(value)}</span> },
        {
            title: t("account.usageLatency"),
            key: "latency",
            width: 150,
            render: (_, log) => (
                <span className="tabular-nums text-stone-500 dark:text-stone-400">
                    {formatDuration(log.first_token_ms)}
                    {" / "}
                    {formatDuration(log.duration_ms)}
                </span>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <AccountStatTile label={t("account.overviewTotalRequests")} value={formatCount(stats.data?.total_requests)} />
                <AccountStatTile label={t("account.usageTokens")} value={formatCount(stats.data?.total_tokens)} />
                <AccountStatTile label={t("account.overviewTotalCost")} value={formatAmount(stats.data?.total_actual_cost)} />
                <AccountStatTile label={t("account.usageAverageDuration")} value={formatDuration(stats.data?.average_duration_ms)} />
            </div>

            <AccountPanel title={t("account.usageTitle")} description={t("account.usageHint")}>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <DatePicker.RangePicker
                        value={range}
                        onChange={(value) => {
                            // 允许用户清空，但 `/usage/stats` 要求时间范围，故回落到默认最近 24 小时。
                            setRange(value && value[0] && value[1] ? [value[0], value[1]] : defaultUsageRange());
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
                        scroll={{ x: 1800 }}
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
