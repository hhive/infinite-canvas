import { ArrowLeft, Copy, ExternalLink, RotateCcw, Search } from "lucide-react";
import { App, Button, Empty, Input, Modal, Segmented, Select, Spin, Tag } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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

function PricingHeader({ count }: { count: number }) {
    return <header className="relative mx-auto mb-8 max-w-5xl overflow-hidden border border-stone-200 bg-white px-5 pb-8 pt-8 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:rounded-xl sm:px-10 sm:pt-10"><div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-stone-900 dark:bg-stone-100" /><div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Pricing · {count} models</div><h1 className="text-4xl font-bold tracking-tight">模型广场</h1><p className="mt-3 text-sm text-stone-500 dark:text-stone-400">发现可用模型，比较能力与实际售价。</p></header>;
}

function PricingToolbar({ matched, total, sortLabel }: { matched: number; total: number; sortLabel: (key: ModelSortKey, label: string) => ReactNode }) {
    return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm dark:border-stone-800 dark:bg-stone-900"><span className="font-medium">当前命中 {matched} / 共 {total} 个模型</span><div className="flex items-center gap-4 text-xs text-stone-500">排序：{sortLabel("sort_order", "默认")} {sortLabel("price", "价格")} {sortLabel("model_name", "名称")}</div></div>;
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
    const [groupFilter, setGroupFilter] = useState("");
    const [billingFilter, setBillingFilter] = useState("all");
    const [priceMode, setPriceMode] = useState<"standard" | "quota">("standard");
    const [priceUnit, setPriceUnit] = useState<"unit" | "thousand">("unit");
    const [sortState, setSortState] = useState<ModelSortState>({ key: "sort_order", direction: "asc" });
    const [viewMode, setViewMode] = useState<"card" | "table">("card");
    const detailModelId = typeof window !== "undefined" && window.location.pathname.startsWith("/pricing/") ? decodeURIComponent(window.location.pathname.slice(9)) : "";

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
        if (groupFilter && group.name !== groupFilter) return false;
        if (billingFilter !== "all" && (model.charge_mode || "cnt") !== billingFilter) return false;
        if (!normalizedKeyword) return true;
        const mediaLabel = model.media_type === "image" ? "图片 image" : "视频 video";
        return [displayName(model), modelName(model), model.name, model.provider, mediaLabel].some((value) => value?.toLocaleLowerCase().includes(normalizedKeyword));
    }).map((model) => ({ model, groupName: group.name }))), sortState), [catalogGroups, mediaFilter, normalizedKeyword, providerFilter, sortState]);
    const filteredGroups = useMemo(() => catalogGroups.map((group) => ({
        ...group,
        models: filteredRows.filter((row) => row.groupName === group.name).map((row) => row.model),
    })).filter((group) => group.models.length > 0), [catalogGroups, filteredRows]);
    const matchedModels = filteredRows.length;
    const hasFilters = Boolean(normalizedKeyword || providerFilter || groupFilter || billingFilter !== "all" || mediaFilter !== "all");
    const clearFilters = () => {
        setKeyword("");
        setMediaFilter("all");
        setProviderFilter("");
        setGroupFilter("");
        setBillingFilter("all");
    };
    const toggleSort = (key: ModelSortKey) => setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    const sortLabel = (key: ModelSortKey, label: string) => <button type="button" className="font-semibold" aria-label={`按${label}排序`} aria-sort={sortState.key === key ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort(key)}>{label} {sortState.key === key ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}</button>;

    if (loading) return <div className="flex h-full items-center justify-center"><Spin /></div>;
    if (loadError) return <div className="flex h-full items-center justify-center px-4"><div className="text-center"><Empty description="模型广场加载失败" /><p className="mb-4 break-words text-sm text-stone-500 dark:text-stone-400">{loadError}</p><Button icon={<RotateCcw className="size-4" />} onClick={() => setRetryKey((value) => value + 1)}>重试</Button></div></div>;
    if (data?.enabled === false) return <div className="flex h-full items-center justify-center"><Empty description="模型广场暂未开放" /></div>;
    if (!data) return null;
    const detailModel = detailModelId ? catalogGroups.flatMap((group) => group.models).find((model) => modelName(model) === detailModelId) : null;
    if (detailModel) {
        const startPrice = modelPrice(detailModel);
        const billingLabel = detailModel.media_type === "video" ? (detailModel.charge_mode === "second" ? "按秒计费" : "按条计费") : "按生成计费";
        return <div data-testid="pricing-detail" className="h-full overflow-y-auto bg-stone-50 px-4 py-6 text-stone-800 dark:bg-stone-950 dark:text-stone-100 sm:px-6 sm:py-8"><div className="mx-auto max-w-5xl"><a href="/pricing" className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"><ArrowLeft className="size-4" />返回 Pricing</a><header className="relative mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-8"><div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-stone-900 dark:bg-stone-100" /><div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Pricing · Model details</div><div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 data-testid="pricing-detail-title" className="break-words text-3xl font-bold tracking-tight sm:text-4xl">{displayName(detailModel)}</h1><code className="mt-2 block break-all text-sm text-stone-500 dark:text-stone-400">{modelName(detailModel)}</code><div className="mt-4 flex flex-wrap gap-2"><Tag color={detailModel.media_type === "image" ? "blue" : "purple"}>{detailModel.media_type === "image" ? "图片模型" : "视频模型"}</Tag><Tag>{detailModel.provider || "未注明供应商"}</Tag><Tag>{billingLabel}</Tag></div></div><div className="shrink-0 rounded-lg bg-stone-100 px-5 py-4 dark:bg-stone-800"><div className="text-xs uppercase tracking-wide text-stone-500">起始价格</div><div data-testid="pricing-detail-price" className="mt-1 text-3xl font-bold">{quota(startPrice)}<span className="ml-1 text-xs font-normal text-stone-500">额度</span></div></div></div></header><section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]"><div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:p-6"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">能力与价格</h2><span className="text-xs uppercase tracking-wide text-stone-400">Specifications</span></div>{detailModel.media_type === "image" ? <div className="grid gap-3 text-sm sm:grid-cols-2"><div><div className="text-xs text-stone-500">支持尺寸</div><div className="mt-1 font-medium">{detailModel.sizes?.join(" / ") || "-"}</div></div><div><div className="text-xs text-stone-500">支持质量</div><div className="mt-1 font-medium">{detailModel.qualities?.join(" / ") || "-"}</div></div><div className="sm:col-span-2"><div className="text-xs text-stone-500">价格明细</div><div className="mt-1 font-semibold">{priceText(detailModel, new Set(["1K", "2K", "4K", "低", "中", "高"])) || "-"}</div></div></div> : <div className="grid gap-4 text-sm sm:grid-cols-2"><div><div className="text-xs text-stone-500">参考素材</div><div className="mt-1 font-medium">{detailModel.max_reference_images || 0} 图 / {detailModel.max_reference_videos || 0} 视频 / {detailModel.max_reference_audios || 0} 音频</div></div><div><div className="text-xs text-stone-500">支持秒数</div><div className="mt-1 font-medium">{detailModel.supported_seconds?.join(" / ") || "-"}</div></div><div><div className="text-xs text-stone-500">支持分辨率</div><div className="mt-1 font-medium">{detailModel.supported_resolutions?.join(" / ") || "-"}</div></div><div><div className="text-xs text-stone-500">卡脸支持</div><div className="mt-1 font-medium">{detailModel.supports_face ? `${quota(detailModel.face_price)} / ${detailModel.charge_mode === "second" ? "秒" : "条"}` : "不支持"}</div></div><div className="sm:col-span-2"><div className="text-xs text-stone-500">分辨率价格</div><div className="mt-1 font-semibold">{videoResolutionPriceText(detailModel) || "-"}</div></div></div>}</div><div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:p-6"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">模型说明</h2><span className="text-xs uppercase tracking-wide text-stone-400">About</span></div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-600 dark:text-stone-300">{detailModel.note?.trim() || "暂无补充说明"}</p></div></section><section className="mt-5 rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">调用示例</h2><p className="mt-1 text-xs text-stone-500">使用媒体站 API 调用此模型</p></div><Button type="text" icon={<Copy className="size-4" />} aria-label="复制模型名称" onClick={() => void copy(modelName(detailModel))}>复制模型 ID</Button></div>{detailModel.calls.length ? detailModel.calls.map((call) => <div key={`${call.method}-${call.path}`} className="mb-5 last:mb-0"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{call.label}</strong><div className="mt-1 text-xs text-stone-500"><code>{call.method} {call.path}</code></div></div><Button type="text" icon={<Copy className="size-4" />} aria-label={`复制${call.label}`} onClick={() => void copy(call.example)}>复制示例</Button></div><div className="mt-2 text-xs text-stone-500">{call.auth}</div><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-stone-950 p-4 text-xs leading-5 text-stone-100">{call.example}</pre></div>) : <Empty description="暂无调用示例" />}</section></div></div>;
    }

    return (
        <div data-testid="pricing-page" className="h-full overflow-y-auto bg-stone-50 text-stone-800 dark:bg-stone-950 dark:text-stone-100 sm:px-6">
            <div className="mx-auto w-full max-w-[1800px]">
                <PricingHeader count={totalModels} />
                <div className="mb-8 grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
                <aside data-testid="pricing-filters" className="hidden h-fit rounded-lg border border-stone-200 bg-white p-4 xl:block dark:border-stone-800 dark:bg-stone-950"><div className="mb-4 text-sm font-semibold">筛选与排序</div><div className="space-y-4"><div><div className="mb-2 text-xs text-stone-500">媒体类型</div><Segmented block options={mediaOptions} value={mediaFilter} onChange={(value) => setMediaFilter(value as MediaFilter)} /></div><div><div className="mb-2 text-xs text-stone-500">分组</div><Select data-testid="pricing-group-filter" className="w-full" value={groupFilter} options={[{ label: "全部分组", value: "" }, ...catalogGroups.map((group) => ({ label: group.name, value: group.name }))]} onChange={setGroupFilter} /></div><div><div className="mb-2 text-xs text-stone-500">供应商</div><Select className="w-full" value={providerFilter} options={[{ label: "全部供应商", value: "" }, ...providers.map((provider) => ({ label: provider, value: provider }))]} onChange={setProviderFilter} /></div><div><div className="mb-2 text-xs text-stone-500">计费方式</div><Select data-testid="pricing-billing-filter" className="w-full" value={billingFilter} options={[{ label: "全部计费", value: "all" }, { label: "按条", value: "cnt" }, { label: "按秒", value: "second" }]} onChange={setBillingFilter} /></div><Button block icon={<RotateCcw className="size-4" />} disabled={!hasFilters} onClick={clearFilters}>清空筛选</Button></div></aside>
                <main className="min-w-0">
                <div className="mb-6 flex flex-col gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <Input aria-label="搜索模型" className="min-w-0 flex-1" size="large" type="search" allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模型名称、供应商或标签" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => {
                            if (event.key === "Escape") setKeyword("");
                        }} />
                        <Segmented aria-label="视图模式" className="w-full shrink-0 lg:w-auto" options={[{ label: "卡片", value: "card" }, { label: "表格", value: "table" }]} value={viewMode} onChange={(value) => setViewMode(value as "card" | "table")} />
                        <div className="xl:hidden"><Segmented aria-label="媒体类型筛选" className="w-full shrink-0 lg:w-auto" options={mediaOptions} value={mediaFilter} onChange={(value) => setMediaFilter(value as MediaFilter)} /></div>
                        <Select aria-label="供应商筛选" className="w-full lg:w-56" value={providerFilter} options={[{ label: "全部供应商", value: "" }, ...providers.map((provider) => ({ label: provider, value: provider }))]} onChange={setProviderFilter} />
                        <Segmented data-testid="pricing-price-mode" options={[{ label: "标准价", value: "standard" }, { label: "额度价", value: "quota" }]} value={priceMode} onChange={(value) => setPriceMode(value as "standard" | "quota")} />
                        <Segmented aria-label="价格单位" options={[{ label: "/1", value: "unit" }, { label: "/1K", value: "thousand" }]} value={priceUnit} onChange={(value) => setPriceUnit(value as "unit" | "thousand")} />
                        <Button className="shrink-0" icon={<RotateCcw className="size-4" />} disabled={!hasFilters} onClick={clearFilters}>清空筛选</Button>
                    </div>
                    <PricingToolbar matched={matchedModels} total={totalModels} sortLabel={sortLabel} />
                </div>
                {filteredGroups.map((group) => <section key={group.id} data-testid={`marketplace-group-${group.id}`} className="mb-10"><header className="mb-4 flex items-end justify-between gap-4 border-b border-stone-200 pb-3 dark:border-stone-800"><h2 className="text-xl font-semibold">{group.name}</h2><span className="text-sm text-stone-500">{group.models.length} 个模型</span></header>{viewMode === "table" ? <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500 dark:bg-stone-900"><tr><th className="px-4 py-3">模型</th><th className="px-4 py-3">类型</th><th className="px-4 py-3">供应商</th><th className="px-4 py-3">价格</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{group.models.map((model) => <tr key={`${group.id}-${model.media_type}-${modelName(model)}-${model.charge_mode || "default"}`} className="border-t border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"><td className="px-4 py-3"><ModelNames model={model} /></td><td className="px-4 py-3">{model.media_type === "image" ? "图片" : "视频"}</td><td className="px-4 py-3 text-stone-500">{model.provider || "-"}</td><td className="px-4 py-3 font-semibold">{quota(modelPrice(model))}</td><td className="px-4 py-3"><a aria-label="查看模型详情" className="text-sm font-medium text-blue-600" href={`/pricing/${encodeURIComponent(modelName(model))}`}>详情</a></td></tr>)}</tbody></table></div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{group.models.map((model) => <article key={`${group.id}-${model.media_type}-${modelName(model)}-${model.charge_mode || "default"}`} className="rounded-lg border border-stone-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-600"><div className="mb-3 flex items-start justify-between gap-3"><ModelNames model={model} /><Tag color={model.media_type === "image" ? "blue" : "purple"}>{model.media_type === "image" ? "图片" : "视频"}</Tag></div><div className="mb-3 flex items-end justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-stone-400">起始价格</div><div className="text-2xl font-bold">{quota(modelPrice(model))}<span className="ml-1 text-xs font-normal text-stone-400">{priceUnit === "thousand" ? "/ 1K" : priceMode === "quota" ? "额度" : "起"}</span></div></div><div className="flex items-center gap-1"><a aria-label="查看模型详情" className="rounded-md px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50" href={`/pricing/${encodeURIComponent(modelName(model))}`}>详情</a><Button type="text" aria-label="复制模型名称" icon={<Copy className="size-4" />} onClick={(event) => { event.stopPropagation(); void copy(modelName(model)); }} /></div></div>{model.note?.trim() ? <p className="mb-3 whitespace-pre-wrap break-words text-sm text-stone-600 dark:text-stone-300">{model.note.trim()}</p> : null}{model.media_type === "image" ? <ImageModelDetails model={model} fields={data.fields} /> : <><div className="mb-3 text-xs text-stone-500">参考素材：{model.max_reference_images || 0} 图 / {model.max_reference_videos || 0} 视频 / {model.max_reference_audios || 0} 音频<br />支持秒数：{model.supported_seconds?.join(" / ") || "-"}<br />支持分辨率：{model.supported_resolutions?.join(" / ") || "-"}<br />支持人脸：{model.supports_face === false ? "不支持" : "支持"}<br />计费方式：{model.charge_mode === "second" ? "按秒" : "按条"}</div>{videoResolutionPriceText(model) ? <div className="text-sm font-semibold">分辨率预扣额度：{videoResolutionPriceText(model)}</div> : null}{model.supports_face === true ? <div className="text-xs font-normal text-stone-500">卡脸附加预扣额度：{quota(model.face_price)} / {model.charge_mode === "second" ? "秒" : "条"}</div> : null}</>}{hasField("provider") ? <div className="mt-3 text-xs text-stone-500">{model.provider || "未注明供应商"}</div> : null}</article>)}</div>}</section>)}
                {totalModels === 0 ? <Empty description="暂无可展示模型" /> : null}
                {totalModels > 0 && matchedModels === 0 ? <div className="py-12 text-center"><Empty description="没有符合当前筛选条件的模型" />{hasFilters ? <Button className="mt-4" icon={<RotateCcw className="size-4" />} onClick={clearFilters}>清空筛选</Button> : null}</div> : null}
                </main></div>
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
