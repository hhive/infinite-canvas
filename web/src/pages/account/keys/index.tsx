import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AccountErrorState, AccountPanel } from "@/pages/account/components/panel";
import { AccountSessionGate } from "@/pages/account/components/session-gate";
import { useAccountResource } from "@/pages/account/components/use-account-resource";
import { formatAmount, formatTime } from "@/pages/account/format";
import { apiErrorMessage } from "@/services/api/request";
import { switchMediaAPIKey } from "@/services/api/media-api-keys";
import { createAPIKey, deleteAPIKey, fetchAPIKeys, fetchAvailableGroups, updateAPIKey, type APIKey } from "@/services/api/user-center";
import { ensureMediaAPIKeysLoaded, resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

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
            await switchMediaAPIKey(key.id);
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
            // 删除最后一页最后一条时回退一页，避免停在空页
            if (list.data && list.data.items.length === 1 && page > 1) setPage((value) => value - 1);
            else list.reload();
        } catch (error) {
            message.error(apiErrorMessage(error, t("account.keysDeleteFailed"), t("common.networkError")));
        }
    };

    const statusText = (status: APIKey["status"]) =>
        ({ active: t("account.keysStatusActive"), inactive: t("account.keysStatusInactive"), quota_exhausted: t("account.keysStatusQuotaExhausted"), expired: t("account.keysStatusExpired") })[status] ?? status;

    const statusColor = (status: APIKey["status"]) => ({ active: "green", inactive: "default", quota_exhausted: "orange", expired: "red" })[status] ?? "default";

    const columns: ColumnsType<APIKey> = [
        {
            title: t("account.keysName"),
            dataIndex: "name",
            render: (_, key) => (
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-stone-950 dark:text-stone-100">{key.name}</span>
                        {key.id === currentKeyId ? <Tag color="blue">{t("account.keysCurrent")}</Tag> : null}
                    </div>
                    <code className="mt-0.5 block break-all text-xs text-stone-500 dark:text-stone-400">{key.key}</code>
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
        { title: t("account.keysCreatedAt"), dataIndex: "created_at", width: 160, render: (value: string) => <span className="text-stone-500 dark:text-stone-400">{formatTime(value)}</span> },
        { title: t("account.keysLastUsedAt"), dataIndex: "last_used_at", width: 160, render: (value: string | null) => <span className="text-stone-500 dark:text-stone-400">{value ? formatTime(value) : t("account.keysNever")}</span> },
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
