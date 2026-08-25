import { Copy, ExternalLink, RotateCcw, Search } from "lucide-react";
import { App, Button, Empty, Input, Modal, Segmented, Select, Spin, Tag } from "antd";
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

export function expandMarketplaceModels(model: MarketplaceModel): MarketplaceModel[] {
    if (model.media_type !== "video" || !model.charge_modes?.length) return [model];
    const modes = [...new Set(model.charge_modes)].filter((mode) => mode === "cnt" || mode === "second");
    return modes.length > 1 ? modes.map((charge_mode) => ({
        ...model,
        charge_mode,
        resolution_prices: model.charge_mode_prices?.[charge_mode] ?? model.resolution_prices,
        face_price: model.charge_mode_face_prices?.[charge_mode] ?? model.face_price,
        calls: model.calls.map((call) => ({ ...call, example: addChargeMode(call.example, charge_mode) })),
    })) : [model];
}

function addChargeMode(example: string, mode: "cnt" | "second") {
    if (/charge_mode\s*[=:]/i.test(example)) return example.replace(/(charge_mode\s*[=:]\s*["']?)(cnt|second)/i, `$1${mode}`);
    if (example.trim().startsWith("{")) {
        try { return JSON.stringify({ ...(JSON.parse(example) as Record<string, unknown>), charge_mode: mode }, null, 2); } catch { /* preserve non-JSON examples */ }
    }
    return `${example.trimEnd()}\n# charge_mode: ${mode}`;
}

export type ModelSortKey = "sort_order" | "model_name" | "price" | "media_type" | "provider" | "group";
export type ModelSortState = { key: ModelSortKey; direction: "asc" | "desc" };

export function modelPrice(model: MarketplaceModel): number | undefined {
    const values = model.media_type === "image"
        ? imagePricingRows(model).map((row) => row.price)
        : [...Object.values(model.resolution_prices ?? {}), model.face_price];
    const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    return valid.length ? Math.min(...valid) : undefined;
}

export function sortMarketplaceModels(rows: Array<{ model: MarketplaceModel; groupName: string }>, state: ModelSortState) {
    const direction = state.direction === "asc" ? 1 : -1;
    const text = (value: unknown) => String(value ?? "").toLocaleLowerCase("zh-CN");
    const compare = (left: typeof rows[number], right: typeof rows[number]) => {
        let result = 0;
        if (state.key === "sort_order") result = (left.model.sort_order ?? 0) - (right.model.sort_order ?? 0);
        if (state.key === "model_name") result = text(modelName(left.model)).localeCompare(text(modelName(right.model)), "zh-CN");
        if (state.key === "price") {
            const lp = modelPrice(left.model), rp = modelPrice(right.model);
            if (lp === undefined && rp !== undefined) result = 1;
            else if (lp !== undefined && rp === undefined) result = -1;
            else result = (lp ?? 0) - (rp ?? 0);
        }
        if (state.key === "media_type") result = text(left.model.media_type).localeCompare(text(right.model.media_type), "zh-CN");
        if (state.key === "provider") result = text(left.model.provider).localeCompare(text(right.model.provider), "zh-CN");
        if (state.key === "group") result = text(left.groupName).localeCompare(text(right.groupName), "zh-CN");
        if (result !== 0) return result * direction;
        const nameResult = text(modelName(left.model)).localeCompare(text(modelName(right.model)), "zh-CN");
        if (nameResult !== 0) return nameResult;
        return text(left.groupName).localeCompare(text(right.groupName), "zh-CN");
    };
    return [...rows].sort(compare);
}

function ModelNames({ model }: { model: MarketplaceModel }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="whitespace-normal break-words font-semibold leading-5">{displayName(model)}</div>
            <code className="mt-1 block whitespace-normal break-all text-xs font-normal text-stone-500 dark:text-stone-400">{modelName(model)}</code>
        </div>
    );
}

function ImageModelDetails({ model, fields }: { model: MarketplaceModel; fields: string[] }) {
    const resolutionPrice = priceText(model, resolutionLabels);
    const qualityPrice = priceText(model, qualityLabels);
    return (
        <div className="mb-3 space-y-1 text-xs text-stone-500">
            {fields.includes("sizes") && model.sizes?.length ? <div>尺寸：{model.sizes.join(" / ")}</div> : null}
            {fields.includes("qualities") && model.qualities?.length ? <div>质量：{model.qualities.join(" / ")}</div> : null}
            {fields.includes("prices") && resolutionPrice ? <div>分辨率价格：{resolutionPrice}</div> : null}
            {fields.includes("prices") && qualityPrice ? <div>质量价格：{qualityPrice}</div> : null}
            {fields.includes("prices") && resolutionPrice && qualityPrice ? <div>分辨率和质量同时传入时，按两者中较高价格计费。</div> : null}
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
    const [sortState, setSortState] = useState<ModelSortState>({ key: "sort_order", direction: "asc" });

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
    const catalogGroups = useMemo(() => data?.groups.map((group) => ({ ...group, models: group.models.flatMap(expandMarketplaceModels) })) ?? [], [data]);
    const totalModels = useMemo(() => catalogGroups.reduce((count, group) => count + group.models.length, 0), [catalogGroups]);
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    const filteredRows = useMemo(() => sortMarketplaceModels(catalogGroups.flatMap((group) => group.models.filter((model) => {
        if (mediaFilter !== "all" && model.media_type !== mediaFilter) return false;
        if (providerFilter && model.provider?.trim() !== providerFilter) return false;
        if (!normalizedKeyword) return true;
        const mediaLabel = model.media_type === "image" ? "图片 image" : "视频 video";
        return [displayName(model), modelName(model), model.name, model.provider, mediaLabel].some((value) => value?.toLocaleLowerCase().includes(normalizedKeyword));
    }).map((model) => ({ model, groupName: group.name }))), sortState), [catalogGroups, mediaFilter, normalizedKeyword, providerFilter, sortState]);
    const filteredGroups = useMemo(() => catalogGroups.map((group) => ({
        ...group,
        models: filteredRows.filter((row) => row.groupName === group.name).map((row) => row.model),
    })).filter((group) => group.models.length > 0), [catalogGroups, filteredRows]);
    const matchedModels = filteredRows.length;
    const hasFilters = Boolean(normalizedKeyword || providerFilter || mediaFilter !== "all");
    const clearFilters = () => {
        setKeyword("");
        setMediaFilter("all");
        setProviderFilter("");
    };
    const toggleSort = (key: ModelSortKey) => setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    const sortLabel = (key: ModelSortKey, label: string) => <button type="button" className="font-semibold" aria-label={`按${label}排序`} aria-sort={sortState.key === key ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort(key)}>{label} {sortState.key === key ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}</button>;

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
                {filteredGroups.map((group) => <section key={group.id} data-testid={`marketplace-group-${group.id}`} className="mb-10"><header className="mb-4 flex items-end justify-between gap-4 border-b border-stone-200 pb-3 dark:border-stone-800"><h2 className="text-xl font-semibold">{group.name}</h2><span className="text-sm text-stone-500">{group.models.length} 个模型</span></header><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{group.models.map((model) => <article key={`${group.id}-${model.media_type}-${modelName(model)}-${model.charge_mode || "default"}`} className="cursor-pointer rounded-md border border-stone-200 bg-white p-4 transition hover:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-600" onClick={() => setSelected(model)}><div className="mb-3 flex items-start justify-between gap-3"><ModelNames model={model} /><Tag color={model.media_type === "image" ? "blue" : "purple"}>{model.media_type === "image" ? "图片" : "视频"}</Tag></div>{model.note?.trim() ? <p className="mb-3 whitespace-pre-wrap break-words text-sm text-stone-600 dark:text-stone-300">{model.note.trim()}</p> : null}{model.media_type === "image" ? <ImageModelDetails model={model} fields={data.fields} /> : <><div className="mb-3 text-xs text-stone-500">参考素材：{model.max_reference_images || 0} 图 / {model.max_reference_videos || 0} 视频 / {model.max_reference_audios || 0} 音频<br />支持秒数：{model.supported_seconds?.join(" / ") || "-"}<br />支持分辨率：{model.supported_resolutions?.join(" / ") || "-"}<br />支持人脸：{model.supports_face === false ? "不支持" : "支持"}<br />计费方式：{model.charge_mode === "second" ? "按秒" : "按条"}</div><div className="text-sm font-medium">{modelPrice(model) === undefined ? "-" : money(modelPrice(model))}{videoResolutionPriceText(model) ? <div className="text-xs font-normal text-stone-500">分辨率预扣额度：{videoResolutionPriceText(model)}</div> : null}{model.supports_face === true ? <div className="text-xs font-normal text-stone-500">卡脸附加预扣额度：{quota(model.face_price)} / {model.charge_mode === "second" ? "秒" : "条"}</div> : null}</div></>}{hasField("provider") ? <div className="mt-3 text-xs text-stone-500">{model.provider || "未注明供应商"}</div> : null}</article>)}</div></section>)}
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
