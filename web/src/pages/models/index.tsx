import { Copy, ExternalLink, RotateCcw, Search } from "lucide-react";
import { App, Button, Card, Empty, Input, Modal, Segmented, Select, Spin, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchModelCatalog, imagePricingRows, type MarketplaceModel, type MarketplaceResponse } from "@/services/api/model-catalog";

function money(value?: number) {
    return typeof value === "number" && value > 0 ? value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "-";
}

const resolutionLabels = new Set(["1K", "2K", "4K"]);
const qualityLabels = new Set(["低", "中", "高"]);

function priceText(model: MarketplaceModel, labels: Set<string>) {
    return imagePricingRows(model)
        .filter((row) => labels.has(row.label))
        .map((row) => `${row.label} ${money(row.price)}`)
        .join(" · ");
}

function quota(value?: number) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "-";
}

function videoResolutionPriceText(model: MarketplaceModel) {
    const unit = model.charge_mode === "second" ? "秒" : "条";
    return (model.supported_resolutions ?? [])
        .map((resolution) => `${resolution} ${quota(model.resolution_prices?.[resolution])} / ${unit}`)
        .join(" · ");
}

function displayName(model: MarketplaceModel) {
    return model.display_name?.trim() || model.model_name?.trim() || model.name;
}

function modelName(model: MarketplaceModel) {
    return model.model_name?.trim() || model.name;
}

function ModelNames({ model }: { model: MarketplaceModel }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="whitespace-normal break-words font-semibold leading-5">{displayName(model)}</div>
            <code className="mt-1 block whitespace-normal break-all text-xs font-normal text-stone-500 dark:text-stone-400">{modelName(model)}</code>
        </div>
    );
}

type MediaFilter = "all" | MarketplaceModel["media_type"];

const mediaOptions = [
    { label: "全部", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

export default function ModelsPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<MarketplaceResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [selected, setSelected] = useState<MarketplaceModel | null>(null);
    const [keyword, setKeyword] = useState("");
    const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
    const [providerFilter, setProviderFilter] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setLoadError(null);
        void fetchModelCatalog(controller.signal)
            .then((response) => {
                setData(response);
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    setData(null);
                    setLoadError(error instanceof Error ? error.message : "请稍后重试");
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [retryKey]);

    const copy = async (example: string) => {
        await navigator.clipboard.writeText(example);
        message.success("调用示例已复制");
    };
    const hasField = (field: string) => data?.fields.includes(field) ?? true;
    const providers = useMemo(() => Array.from(new Set(data?.groups.flatMap((group) => group.models.map((model) => model.provider?.trim()).filter((provider): provider is string => Boolean(provider))) ?? [])).sort((left, right) => left.localeCompare(right, "zh-CN")), [data]);
    const totalModels = useMemo(() => data?.groups.reduce((count, group) => count + group.models.length, 0) ?? 0, [data]);
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    const filteredGroups = useMemo(() => data?.groups.map((group) => ({
        ...group,
        models: group.models.filter((model) => {
            if (mediaFilter !== "all" && model.media_type !== mediaFilter) return false;
            if (providerFilter && model.provider?.trim() !== providerFilter) return false;
            if (!normalizedKeyword) return true;
            const mediaLabel = model.media_type === "image" ? "图片 image" : "视频 video";
            return [displayName(model), modelName(model), model.name, model.provider, mediaLabel]
                .some((value) => value?.toLocaleLowerCase().includes(normalizedKeyword));
        }),
    })).filter((group) => group.models.length > 0) ?? [], [data, mediaFilter, normalizedKeyword, providerFilter]);
    const matchedModels = filteredGroups.reduce((count, group) => count + group.models.length, 0);
    const hasFilters = Boolean(normalizedKeyword || providerFilter || mediaFilter !== "all");
    const clearFilters = () => {
        setKeyword("");
        setMediaFilter("all");
        setProviderFilter("");
    };

    if (loading) return <div className="flex h-full items-center justify-center"><Spin /></div>;
    if (loadError) return <div className="flex h-full items-center justify-center px-4"><div className="text-center"><Empty description="模型广场加载失败" /><p className="mb-4 break-words text-sm text-stone-500 dark:text-stone-400">{loadError}</p><Button icon={<RotateCcw className="size-4" />} onClick={() => setRetryKey((value) => value + 1)}>重试</Button></div></div>;
    if (data?.enabled === false) return <div className="flex h-full items-center justify-center"><Empty description="模型广场暂未开放" /></div>;
    if (!data) return null;

    return (
        <div className="h-full overflow-y-auto bg-background px-4 py-8 text-stone-800 dark:text-stone-100">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6"><h1 className="text-3xl font-semibold tracking-tight">模型广场</h1><p className="mt-2 text-sm text-stone-500 dark:text-stone-400">按 Sub2API 分组查看可用能力与实际售价。</p></div>
                <div className="mb-8 flex flex-col gap-3 border-y border-stone-200 py-4 dark:border-stone-800">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <Input aria-label="搜索模型" className="min-w-0 flex-1" type="search" allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索名称、模型标识或供应商" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => {
                            if (event.key === "Escape") setKeyword("");
                        }} />
                        <Segmented aria-label="媒体类型筛选" className="w-full shrink-0 lg:w-auto" options={mediaOptions} value={mediaFilter} onChange={(value) => setMediaFilter(value as MediaFilter)} />
                        <Select aria-label="供应商筛选" className="w-full lg:w-56" value={providerFilter} options={[{ label: "全部供应商", value: "" }, ...providers.map((provider) => ({ label: provider, value: provider }))]} onChange={setProviderFilter} />
                        <Button className="shrink-0" icon={<RotateCcw className="size-4" />} disabled={!hasFilters} onClick={clearFilters}>清空筛选</Button>
                    </div>
                    <div className="text-sm text-stone-500 dark:text-stone-400">当前命中 {matchedModels} / 共 {totalModels} 个模型</div>
                </div>
                {filteredGroups.map((group) => (
                    <section key={group.id} className="mb-10">
                        <div className="mb-4 flex items-center gap-3"><h2 className="text-xl font-semibold">{group.name}</h2><Tag>{group.models.length} 个模型</Tag></div>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {group.models.map((model) => (
                                <Card key={`${group.id}-${model.media_type}-${modelName(model)}`} hoverable onClick={() => setSelected(model)} title={<div className="flex items-start justify-between gap-2"><ModelNames model={model} /><Tag className="shrink-0" color={model.media_type === "image" ? "blue" : "purple"}>{model.media_type === "image" ? "图片" : "视频"}</Tag></div>}>
                                    <div className="space-y-2 text-sm">
                                        {hasField("provider") ? <div className="break-words text-stone-500">{model.provider || "未注明供应商"}</div> : null}
                                        {model.note?.trim() ? <p className="whitespace-pre-wrap break-words text-stone-600 dark:text-stone-300">{model.note.trim()}</p> : null}
                                        {model.media_type === "image" ? <>{hasField("sizes") && model.sizes?.length ? <div>尺寸：{model.sizes.join(" / ")}</div> : null}{hasField("qualities") && model.qualities?.length ? <div>质量：{model.qualities.join(" / ")}</div> : null}{hasField("prices") ? <>{priceText(model, resolutionLabels) ? <div>分辨率价格：{priceText(model, resolutionLabels)}</div> : null}{priceText(model, qualityLabels) ? <div>质量价格：{priceText(model, qualityLabels)}</div> : null}{priceText(model, resolutionLabels) && priceText(model, qualityLabels) ? <div className="text-xs text-stone-500">分辨率和质量同时传入时，按两者中较高价格计费。</div> : null}</> : null}</> : <>{hasField("video_capabilities") ? <><div>参考素材：{model.max_reference_images || 0} 图 / {model.max_reference_videos || 0} 视频 / {model.max_reference_audios || 0} 音频</div><div>支持秒数：{model.supported_seconds?.join(" / ") || "-"}</div><div>支持分辨率：{model.supported_resolutions?.join(" / ") || "-"}</div><div>支持人脸：{model.supports_face === false ? "不支持" : "支持"}</div><div>计费方式：{model.charge_mode === "second" ? "按秒" : "按条"}</div></> : null}{hasField("prices") ? <>{videoResolutionPriceText(model) ? <div>分辨率预扣额度：{videoResolutionPriceText(model)}</div> : null}{model.supports_face === true ? <div>卡脸附加预扣额度：{quota(model.face_price)} / {model.charge_mode === "second" ? "秒" : "条"}</div> : null}</> : null}</>}
                                        <div className="flex items-center gap-1 pt-2 text-xs text-stone-500"><ExternalLink className="size-3.5" />点击查看 API 调用说明</div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </section>
                ))}
                {totalModels === 0 ? <Empty description="暂无可展示模型" /> : null}
                {totalModels > 0 && matchedModels === 0 ? <div className="py-12 text-center"><Empty description="没有符合当前筛选条件的模型" />{hasFilters ? <Button className="mt-4" icon={<RotateCcw className="size-4" />} onClick={clearFilters}>清空筛选</Button> : null}</div> : null}
            </div>
            <Modal open={Boolean(selected)} title={selected ? <ModelNames model={selected} /> : "API 调用说明"} onCancel={() => setSelected(null)} footer={null}>
                <div className="space-y-5">
                    {selected?.media_type === "image" && selected.qualities?.length ? <p className="text-xs text-stone-500">支持质量参数；分辨率和质量同时传入时按两者中较高价格计费。</p> : null}
                    {selected?.calls.map((call) => <section key={`${call.method}-${call.path}`} className="space-y-2"><div className="flex items-center justify-between gap-2"><div><strong>{call.label}</strong><div><code>{call.method} {call.path}</code></div></div><Button type="text" icon={<Copy className="size-4" />} aria-label={`复制${call.label}`} onClick={() => void copy(call.example)} /></div><div className="text-xs text-stone-500">{call.auth}</div><pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md bg-stone-950 p-4 text-xs text-stone-100">{call.example}</pre></section>)}
                </div>
            </Modal>
        </div>
    );
}
