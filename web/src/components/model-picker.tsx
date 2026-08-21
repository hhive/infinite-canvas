import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input, Popover } from "antd";
import { Cpu, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    suppressMissingConfigPrompt?: boolean;
};

const EMPTY_MEDIA_MODELS: ReadonlyArray<MediaModelLabelData> = Object.freeze([]);

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, suppressMissingConfigPrompt = false }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const searchInputRef = useRef<HTMLElement | null>(null);
    const keyboardNavigationRef = useRef(false);
    const listboxId = `${pickerId}-listbox`;
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const mediaModels = useConfigStore((state) => (capability === "image" || capability === "video" ? state.mediaModels[capability] : EMPTY_MEDIA_MODELS));
    const filteredOptions = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        return keyword ? options.filter((model) => modelSearchText(config, mediaModels, model).includes(keyword)) : options;
    }, [config, mediaModels, options, query]);

    const selectModel = (model: string) => {
        onChange(model);
        setQuery("");
        setActiveIndex(0);
        setOpen(false);
    };

    const setPickerOpen = (nextOpen: boolean) => {
        if (nextOpen && !options.length && config.channelMode === "local" && !suppressMissingConfigPrompt) onMissingConfig?.();
        if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        if (!nextOpen) {
            setQuery("");
            setActiveIndex(0);
        }
        setOpen(nextOpen);
    };

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open) return;
        const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        if (!open || !keyboardNavigationRef.current || !filteredOptions[activeIndex]) return;
        document.getElementById(`${pickerId}-option-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
        keyboardNavigationRef.current = false;
    }, [activeIndex, filteredOptions, open, pickerId]);

    const content = (
        <div
            data-canvas-no-zoom
            className="w-[min(22rem,calc(100vw-24px))] p-1"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "ArrowDown" && filteredOptions.length) {
                    event.preventDefault();
                    keyboardNavigationRef.current = true;
                    setActiveIndex((index) => (index + 1) % filteredOptions.length);
                } else if (event.key === "ArrowUp" && filteredOptions.length) {
                    event.preventDefault();
                    keyboardNavigationRef.current = true;
                    setActiveIndex((index) => (index - 1 + filteredOptions.length) % filteredOptions.length);
                } else if (event.key === "Enter" && filteredOptions[activeIndex]) {
                    event.preventDefault();
                    selectModel(filteredOptions[activeIndex]);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    setPickerOpen(false);
                }
            }}
        >
            {options.length ? (
                <div className="mb-1 border-b border-border/70 p-1 pb-2">
                    <Input
                        ref={(node) => { searchInputRef.current = node?.input || null; }}
                        aria-label="搜索模型"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-controls={listboxId}
                        aria-expanded={open}
                        aria-activedescendant={open && filteredOptions[activeIndex] ? `${pickerId}-option-${activeIndex}` : undefined}
                        allowClear
                        autoComplete="off"
                        placeholder="搜索模型名称或供应商"
                        prefix={<Search className="size-3.5 text-muted-foreground" />}
                        size="small"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActiveIndex(0);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                    />
                </div>
            ) : null}
            <div id={listboxId} role="listbox" className="thin-scrollbar max-h-[min(22rem,55vh)] overflow-y-auto">
                {filteredOptions.length ? filteredOptions.map((model, index) => {
                    const label = mediaModelLabel(mediaModels, model) || modelOptionLabel(config, model);
                    return (
                        <button
                            key={model}
                            id={`${pickerId}-option-${index}`}
                            type="button"
                            role="option"
                            aria-selected={model === current}
                            data-value={model}
                            data-text-value={label}
                            className={cn("flex w-full min-w-0 items-center rounded-lg px-2 py-2 text-left transition hover:bg-accent hover:text-accent-foreground", index === activeIndex && "bg-accent text-accent-foreground")}
                            onPointerMove={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectModel(model)}
                        >
                            <ModelLabel config={config} model={model} mediaModels={mediaModels} showModelName />
                        </button>
                    );
                }) : options.length ? (
                    <div role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的模型</div>
                ) : (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyModelLabel(config, capability)}</div>
                )}
            </div>
        </div>
    );

    return (
        <Popover open={open} onOpenChange={setPickerOpen} trigger="click" placement="bottomLeft" arrow={false} content={content} styles={{ container: { padding: 0 } }}>
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="listbox"
                className={cn(
                    "canvas-composer-model-picker inline-flex h-auto min-h-8 w-fit max-w-full items-start gap-2 whitespace-normal rounded-full border border-input bg-transparent px-3 py-1.5 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    open && "border-ring ring-2 ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? mediaModelLabel(mediaModels, current) || modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon model={current} />
                {current ? (
                    <span className="canvas-model-picker-text min-w-0 flex-1">
                        <ModelText config={config} model={current} mediaModels={mediaModels} />
                    </span>
                ) : (
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{placeholder}</span>
                )}
            </button>
        </Popover>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return "请先在上方配置可选模型";
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

type MediaModelLabelData = { mediaType: string; model: string; displayName: string; providerName: string; priceQuota?: number; chargeMode?: "cnt" | "second" };

function ModelLabel({ config, model, mediaModels, showModelName = false }: { config: AiConfig; model: string; mediaModels: ReadonlyArray<MediaModelLabelData>; showModelName?: boolean }) {
    const realModelName = modelOptionName(model);
    return (
        <span className="flex w-full min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="min-w-0 flex-1">
                <ModelText config={config} model={model} mediaModels={mediaModels} />
                {showModelName ? <code className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={realModelName}>{realModelName}</code> : null}
            </span>
        </span>
    );
}

function ModelText({ config, model, mediaModels, className }: { config: AiConfig; model: string; mediaModels: ReadonlyArray<MediaModelLabelData>; className?: string }) {
    const item = findMediaModel(mediaModels, model);
    const identity = item ? mediaModelIdentity(item) : modelOptionLabel(config, model);
    return (
        <span className={cn("flex w-full min-w-0 items-center gap-1.5 text-left", className)}>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={identity}>{identity}</span>
        </span>
    );
}

export function mediaModelLabel(models: ReadonlyArray<MediaModelLabelData>, option: string) {
    const item = findMediaModel(models, option);
    if (!item) return "";
    return mediaModelIdentity(item);
}

function findMediaModel(models: ReadonlyArray<MediaModelLabelData>, option: string) {
    const name = modelOptionName(option);
    return models.find((model) => model.model === name);
}

function modelSearchText(config: AiConfig, mediaModels: ReadonlyArray<MediaModelLabelData>, option: string) {
    const item = findMediaModel(mediaModels, option);
    return [modelOptionName(option), modelOptionLabel(config, option), item?.displayName, item?.providerName].filter(Boolean).join(" ").toLocaleLowerCase();
}

function mediaModelIdentity(item: MediaModelLabelData) {
    return item.providerName ? `${item.displayName} · ${item.providerName}` : item.displayName;
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
