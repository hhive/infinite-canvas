import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { AccountErrorState, AccountPanel } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { formatAmount, formatTime, maskAPIKey } from "@/pages/account/format";
import { apiErrorMessage } from "@/services/api/request";
import { createAPIKey, deleteAPIKey, fetchAPIKeys, fetchAvailableGroups, updateAPIKey, type APIKey } from "@/services/api/user-center";
import { bindSessionAPIKey, ensureMediaAPIKeysLoaded, resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

const PAGE_SIZE = 10;

type KeyFormValues = {
    name: string;
    group_id?: number | null;
    status?: "active" | "inactive";
};

export default function AccountKeysPage() {
    return (
        <AccountSessionGate>
            <AccountKeys />
        </AccountSessionGate>
    );
}

function AccountKeys() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    // 列表只展示打码值（与 Sub2API 面板一致），完整明文仅通过复制交给用户；
    // 用仓库既有的 useCopyText（copy-to-clipboard，带 execCommand 降级），不直接用 navigator.clipboard。
    const copyText = useCopyText();
    const [page, setPage] = useState(1);
    const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; key: APIKey } | null>(null);
    const [saving, setSaving] = useState(false);
    const [switchingId, setSwitchingId] = useState<number | null>(null);
    const [form] = Form.useForm<KeyFormValues>();
    const list = useAccountResource((signal) => fetchAPIKeys(page, PAGE_SIZE, signal), [page]);
    const groups = useAccountResource((signal) => fetchAvailableGroups(signal));
    const currentKeyId = useMediaAPIKeyStore((state) => state.currentKeyId);

    useEffect(() => {
        void ensureMediaAPIKeysLoaded();
    }, []);

    const switchTo = async (key: APIKey) => {
        setSwitchingId(key.id);
        try {
            // 走与生成页选择器共用的绑定入口：它会在绑定后刷新会话状态，
            // 否则 hasApiKey 停在旧值，回工作台时刚启用的 Key 会被就绪判定误拦。
            await bindSessionAPIKey(key.id);
            // 生成页按 Key 缓存模型目录，切换后必须让它们重新加载
            resetMediaAPIKeyStore();
            await ensureMediaAPIKeysLoaded();
            message.success(t("account.keysUseSuccess"));
        } catch (error) {
            message.error(apiErrorMessage(error, t("account.keysUseFailed"), t("common.networkError")));
        } finally {
            setSwitchingId(null);
        }
    };

    const submit = async (values: KeyFormValues) => {
        if (!dialog) return;
        setSaving(true);
        try {
            if (dialog.mode === "create") {
                await createAPIKey({ name: values.name.trim(), group_id: values.group_id ?? null });
                message.success(t("account.keysCreateSuccess"));
            } else {
                await updateAPIKey(dialog.key.id, { name: values.name.trim(), group_id: values.group_id ?? null, status: values.status ?? "active" });
                message.success(t("account.keysUpdateSuccess"));
            }
            // 新建 / 编辑后同步生成页的 Key 列表，否则回到工作台选不到刚建的 Key。
            await refreshMediaKeyStore();
            setDialog(null);
            list.reload();
        } catch (error) {
            message.error(apiErrorMessage(error, dialog.mode === "create" ? t("account.keysCreateFailed") : t("account.keysUpdateFailed"), t("common.networkError")));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (key: APIKey) => {
        try {
            await deleteAPIKey(key.id);
            message.success(t("account.keysDeleteSuccess"));
            // 删除同样要让生成页重新取列表（被删的可能是生成页当前选中的那把）。
            await refreshMediaKeyStore();
            // 删除最后一页最后一条时回退一页，避免停在空页
            if (list.data && list.data.items.length === 1 && page > 1) setPage((value) => value - 1);
            else list.reload();
        } catch (error) {
            message.error(apiErrorMessage(error, t("account.keysDeleteFailed"), t("common.networkError")));
        }
    };

    /**
     * 失效并重载生成页的 Key 列表缓存。
     *
     * `useMediaAPIKeyStore` 的 `ensureLoaded` 在 `status !== "idle"` 时直接返回缓存、永不重取，
     * 因此在这里增删改 Key 之后必须显式失效：否则用户回到工作台仍是旧的「无 Key」状态，
     * 选不到刚建的 Key（刷新页面才恢复，表现为时好时坏）。
     */
    const refreshMediaKeyStore = async () => {
        resetMediaAPIKeyStore();
        await ensureMediaAPIKeysLoaded();
    };

    const statusText = (status: APIKey["status"]) =>
        ({ active: t("account.keysStatusActive"), inactive: t("account.keysStatusInactive"), quota_exhausted: t("account.keysStatusQuotaExhausted"), expired: t("account.keysStatusExpired") })[status] ?? status;

    const statusColor = (status: APIKey["status"]) => ({ active: "green", inactive: "default", quota_exhausted: "orange", expired: "red" })[status] ?? "default";

    const columns: ColumnsType<APIKey> = [
        {
            title: t("account.keysName"),
            dataIndex: "name",
            render: (_, key) => (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-stone-950 dark:text-stone-100">{key.name}</span>
                    {key.id === currentKeyId ? <Tag color="blue">{t("account.keysCurrent")}</Tag> : null}
                </div>
            ),
        },
        {
            title: t("account.keysKey"),
            dataIndex: "key",
            width: 230,
            render: (_, key) => (
                <div className="flex items-center gap-1">
                    <code className="break-all text-xs text-stone-500 dark:text-stone-400">{maskAPIKey(key.key)}</code>
                    <Button type="text" size="small" aria-label={t("account.keysCopy")} title={t("account.keysCopy")} onClick={() => copyText(key.key, t("account.keysCopySuccess"))}>
                        <Copy className="size-3.5" />
                    </Button>
                </div>
            ),
        },
        { title: t("account.keysGroup"), dataIndex: "group_id", width: 140, render: (_, key) => <span className="text-stone-500 dark:text-stone-400">{key.group?.name || t("account.groupUngrouped")}</span> },
        { title: t("account.keysStatus"), dataIndex: "status", width: 110, render: (status: APIKey["status"]) => <Tag color={statusColor(status)}>{statusText(status)}</Tag> },
        {
            title: t("account.keysQuota"),
            dataIndex: "quota",
            width: 140,
            render: (_, key) => (key.quota > 0 ? <span className="tabular-nums">{`${formatAmount(key.quota_used)} / ${formatAmount(key.quota)}`}</span> : <span className="text-stone-500 dark:text-stone-400">{t("account.keysUnlimited")}</span>),
        },
        { title: t("account.keysExpiresAt"), dataIndex: "expires_at", width: 160, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value ? formatTime(value) : t("account.keysNeverExpires")}</span> },
        { title: t("account.keysCreatedAt"), dataIndex: "created_at", width: 160, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
        { title: t("account.keysLastUsedAt"), dataIndex: "last_used_at", width: 160, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value ? formatTime(value) : t("account.keysNever")}</span> },
        { title: t("account.keysLastUsedIp"), dataIndex: "last_used_ip", width: 140, render: (value: string | null | undefined) => <span className="text-stone-500 dark:text-stone-400">{value || "-"}</span> },
        {
            title: "",
            key: "actions",
            width: 200,
            render: (_, key) => (
                <div className="flex flex-wrap items-center gap-1">
                    {key.id === currentKeyId ? null : (
                        <Button type="link" size="small" loading={switchingId === key.id} onClick={() => void switchTo(key)}>
                            {t("account.keysUse")}
                        </Button>
                    )}
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            form.setFieldsValue({ name: key.name, group_id: key.group_id ?? undefined, status: key.status === "inactive" ? "inactive" : "active" });
                            setDialog({ mode: "edit", key });
                        }}
                    >
                        {t("account.edit")}
                    </Button>
                    <Popconfirm title={t("account.keysDelete")} description={t("account.keysDeleteConfirm")} okText={t("account.confirm")} cancelText={t("account.cancel")} onConfirm={() => remove(key)}>
                        <Button type="link" size="small" danger>
                            {t("account.keysDelete")}
                        </Button>
                    </Popconfirm>
                </div>
            ),
        },
    ];

    return (
        <AccountPanel
            title={t("account.keysTitle")}
            description={t("account.keysHint")}
            extra={
                <Button
                    type="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        form.setFieldsValue({ name: "", group_id: undefined, status: "active" });
                        setDialog({ mode: "create" });
                    }}
                >
                    {t("account.keysCreate")}
                </Button>
            }
        >
            {list.error ? (
                <AccountErrorState error={list.error} onRetry={list.reload} />
            ) : (
                <Table<APIKey>
                    rowKey="id"
                    size="small"
                    columns={columns}
                    dataSource={list.data?.items ?? []}
                    loading={list.loading}
                    scroll={{ x: 900 }}
                    pagination={{ current: page, pageSize: PAGE_SIZE, total: list.data?.total ?? 0, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                />
            )}

            <Modal
                open={dialog !== null}
                title={dialog?.mode === "edit" ? t("account.edit") : t("account.keysCreate")}
                okText={t("account.save")}
                cancelText={t("account.cancel")}
                confirmLoading={saving}
                onCancel={() => setDialog(null)}
                onOk={() => form.submit()}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} className="pt-2">
                    <Form.Item name="name" label={t("account.keysName")} rules={[{ required: true, message: t("account.keysNameRequired") }]}>
                        <Input placeholder={t("account.keysNamePlaceholder")} maxLength={60} />
                    </Form.Item>
                    <Form.Item name="group_id" label={t("account.keysGroup")}>
                        <Select allowClear placeholder={t("account.keysGroupPlaceholder")} loading={groups.loading} options={(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))} />
                    </Form.Item>
                    {dialog?.mode === "edit" ? (
                        <Form.Item name="status" label={t("account.keysStatus")}>
                            <Select options={[{ value: "active", label: t("account.keysStatusActive") }, { value: "inactive", label: t("account.keysStatusInactive") }]} />
                        </Form.Item>
                    ) : null}
                </Form>
            </Modal>
        </AccountPanel>
    );
}
