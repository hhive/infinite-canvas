import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mediaModelLabel, ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("antd", async (importOriginal) => {
    const actual = await importOriginal<typeof import("antd")>();
    return {
        ...actual,
        Popover: ({ children, content, onOpenChange }: { children: ReactNode; content: ReactNode; onOpenChange?: (open: boolean) => void }) => createElement("div", null, [
            createElement("span", { key: "open", "data-testid": "open-select", onClick: () => onOpenChange?.(true) }),
            createElement("div", { key: "trigger" }, children),
            createElement("div", { key: "content", "data-testid": "select-content" }, content),
        ]),
    };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useConfigStore.setState({
        isConfigOpen: false,
        shouldPromptContinue: false,
        configTab: "channels",
        mediaModels: { image: [], video: [] },
    });
});

function renderPicker(props: ComponentProps<typeof ModelPicker>) {
    act(() => root.render(createElement(ModelPicker, props)));
}

function searchModels(keyword: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="搜索模型"]');
    expect(input).toBeTruthy();
    act(() => {
        if (!input) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, keyword);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

const configuredTextModel = "default::gpt-5.5";
const configuredAudioModel = "default::gpt-4o-mini-tts";

function configuredTextAndAudioConfig() {
    return {
        ...defaultConfig,
        channels: [
            {
                ...defaultConfig.channels[0],
                models: ["gpt-5.5", "gpt-4o-mini-tts"],
            },
        ],
        models: [configuredTextModel, configuredAudioModel],
        textModel: configuredTextModel,
        audioModel: configuredAudioModel,
        textModels: [configuredTextModel],
        audioModels: [configuredAudioModel],
    };
}

describe("ModelPicker", () => {
    it("keeps the configured text model visible", () => {
        const config = configuredTextAndAudioConfig();

        renderPicker({ config, value: configuredTextModel, capability: "text", onChange: vi.fn() });

        expect(container.querySelector("button")?.title).toContain("gpt-5.5");
        expect(container.querySelector(`[data-value="${configuredTextModel}"]`)?.getAttribute("data-text-value")).toContain("gpt-5.5");
    });

    it("keeps the configured audio model visible", () => {
        const config = configuredTextAndAudioConfig();

        renderPicker({ config, value: configuredAudioModel, capability: "audio", onChange: vi.fn() });

        expect(container.querySelector("button")?.title).toContain("gpt-4o-mini-tts");
        expect(container.querySelector(`[data-value="${configuredAudioModel}"]`)?.getAttribute("data-text-value")).toContain("gpt-4o-mini-tts");
    });

    it("keeps the configured model visible without a capability", () => {
        const config = configuredTextAndAudioConfig();

        renderPicker({ config, value: configuredTextModel, onChange: vi.fn() });

        expect(container.querySelector("button")?.title).toContain("gpt-5.5");
        expect(container.querySelector(`[data-value="${configuredTextModel}"]`)?.getAttribute("data-text-value")).toContain("gpt-5.5");
    });

    it("keeps text and audio pickers stable through unrelated store updates", () => {
        const config = configuredTextAndAudioConfig();
        const onTextChange = vi.fn();
        const onAudioChange = vi.fn();

        act(() => {
            root.render(
                createElement("div", null, [
                    createElement(ModelPicker, { key: "text", config, value: configuredTextModel, capability: "text", onChange: onTextChange }),
                    createElement(ModelPicker, { key: "audio", config, value: configuredAudioModel, capability: "audio", onChange: onAudioChange }),
                ]),
            );
        });
        act(() => {
            useConfigStore.setState({ isConfigOpen: true });
            useConfigStore.setState({ shouldPromptContinue: true });
            useConfigStore.setState({ configTab: "models" });
        });

        const triggers = container.querySelectorAll<HTMLButtonElement>("button[title]");
        expect(triggers).toHaveLength(2);
        expect(triggers[0]?.title).toContain("gpt-5.5");
        expect(triggers[1]?.title).toContain("gpt-4o-mini-tts");
        const textOption = container.querySelector<HTMLElement>(`[data-value="${configuredTextModel}"]`);
        const audioOption = container.querySelector<HTMLElement>(`[data-value="${configuredAudioModel}"]`);
        expect(textOption?.getAttribute("data-text-value")).toContain("gpt-5.5");
        expect(audioOption?.getAttribute("data-text-value")).toContain("gpt-4o-mini-tts");

        act(() => {
            textOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            audioOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(onTextChange).toHaveBeenCalledWith(configuredTextModel);
        expect(onAudioChange).toHaveBeenCalledWith(configuredAudioModel);
    });

    it("refreshes image and video labels when their media models change", () => {
        const imageModel = { id: 10, mediaType: "image" as const, model: "image-model", displayName: "Image Before", providerName: "Provider A", apiMode: "images", priceQuota: 1 };
        const videoModel = { id: 11, mediaType: "video" as const, model: "video-model", displayName: "Video Before", providerName: "Provider B", apiMode: "videos", priceQuota: 2 };
        const imageValue = `default::${imageModel.model}`;
        const videoValue = `default::${videoModel.model}`;
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [imageModel.model, videoModel.model] }],
            models: [imageValue, videoValue],
            imageModels: [imageValue],
            videoModels: [videoValue],
        };
        useConfigStore.setState({ mediaModels: { image: [imageModel], video: [videoModel] } });

        act(() => {
            root.render(
                createElement("div", null, [
                    createElement(ModelPicker, { key: "image", config, value: imageValue, capability: "image", onChange: vi.fn() }),
                    createElement(ModelPicker, { key: "video", config, value: videoValue, capability: "video", onChange: vi.fn() }),
                ]),
            );
        });
        expect(container.querySelectorAll<HTMLButtonElement>("button[title]")[0]?.title).toContain("Image Before");
        expect(container.querySelectorAll<HTMLButtonElement>("button[title]")[1]?.title).toContain("Video Before");

        act(() => {
            useConfigStore.setState({
                mediaModels: {
                    image: [{ ...imageModel, displayName: "Image After" }],
                    video: [{ ...videoModel, displayName: "Video After", priceQuota: 9 }],
                },
            });
        });

        const triggers = container.querySelectorAll<HTMLButtonElement>("button[title]");
        expect(triggers[0]?.title).toContain("Image After");
        expect(triggers[1]?.title).toBe("Video After · Provider B");
        expect(triggers[1]?.title).not.toContain("/ 次");
        expect(container.querySelector(`[data-value="${imageValue}"]`)?.getAttribute("data-text-value")).toContain("Image After");
        expect(container.querySelector(`[data-value="${videoValue}"]`)?.getAttribute("data-text-value")).toContain("Video After");
    });

    it("keeps responsive visibility separate from the selected video layout", () => {
        const model = { id: 1, mediaType: "video" as const, model: "video-1", displayName: "A very long video model name", providerName: "OpenAI", apiMode: "videos", priceQuota: 12, chargeMode: "cnt" as const };
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [model.model] }],
            models: [`default::${model.model}`],
            videoModels: [`default::${model.model}`],
        };
        useConfigStore.setState({ mediaModels: { image: [], video: [model] } });

        renderPicker({ config, value: `default::${model.model}`, capability: "video", onChange: vi.fn() });

        const trigger = container.querySelector<HTMLButtonElement>("button[title]");
        const responsiveWrapper = trigger?.querySelector(".canvas-model-picker-text");
        const layout = responsiveWrapper?.firstElementChild;
        const identity = layout?.children[0];
        const option = container.querySelector(`[data-value="default::${model.model}"]`);

        expect(responsiveWrapper?.classList.contains("flex")).toBe(false);
        expect(layout?.classList.contains("flex")).toBe(true);
        expect(layout?.classList.contains("min-w-0")).toBe(true);
        expect(layout?.classList.contains("w-full")).toBe(true);
        expect(identity?.classList.contains("truncate")).toBe(true);
        expect(identity?.classList.contains("whitespace-nowrap")).toBe(true);
        expect(layout?.children).toHaveLength(1);
        const content = container.querySelector('[data-testid="select-content"]');
        expect(content?.querySelector('[role="listbox"]')).toBeTruthy();
        expect(trigger?.getAttribute("aria-haspopup")).toBe("listbox");
        expect(trigger?.classList.contains("items-start")).toBe(true);
        expect(trigger?.title).toBe("A very long video model name · OpenAI");
        expect(option?.getAttribute("data-text-value")).toBe("A very long video model name · OpenAI");
    });

    it("keeps the placeholder in the responsive wrapper", () => {
        renderPicker({ config: defaultConfig, capability: "video", onChange: vi.fn(), placeholder: "选择视频模型" });

        const placeholder = container.querySelector(".canvas-model-picker-text");
        expect(placeholder?.textContent).toBe("选择视频模型");
        expect(placeholder?.classList.contains("truncate")).toBe(true);
    });

    it("omits video prices regardless of whether the quota is zero or non-zero", () => {
        const model = { id: 2, mediaType: "video" as const, model: "video-extreme", displayName: "Extreme Video", providerName: "OpenAI", apiMode: "videos", priceQuota: Number.MAX_VALUE };
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [model.model] }],
            models: [`default::${model.model}`],
            videoModels: [`default::${model.model}`],
        };
        useConfigStore.setState({ mediaModels: { image: [], video: [model] } });

        renderPicker({ config, value: `default::${model.model}`, capability: "video", onChange: vi.fn() });

        const trigger = container.querySelector<HTMLButtonElement>("button[title]");
        const optionTextValue = container.querySelector(`[data-value="default::${model.model}"]`)?.getAttribute("data-text-value") || "";

        expect(trigger?.textContent).toContain("Extreme Video · OpenAI");
        expect(trigger?.title).toBe("Extreme Video · OpenAI");
        expect(optionTextValue).toBe("Extreme Video · OpenAI");
    });

    it("suppresses generic configuration only when the caller requests it", () => {
        const onMissingConfig = vi.fn();
        const emptyConfig = { ...defaultConfig, channels: [], models: [], videoModels: [] };

        renderPicker({ config: emptyConfig, capability: "video", onChange: vi.fn(), onMissingConfig, suppressMissingConfigPrompt: true });
        act(() => container.querySelector<HTMLElement>('[data-testid="open-select"]')?.click());

        expect(onMissingConfig).not.toHaveBeenCalled();
    });

    it("keeps generic configuration fallback for media pickers by default", () => {
        const onMissingConfig = vi.fn();
        const emptyConfig = { ...defaultConfig, channels: [], models: [], imageModels: [] };

        renderPicker({ config: emptyConfig, capability: "image", onChange: vi.fn(), onMissingConfig });
        act(() => container.querySelector<HTMLElement>('[data-testid="open-select"]')?.click());

        expect(onMissingConfig).toHaveBeenCalledOnce();
    });

    it("filters media models by display name, real model name, and provider", () => {
        const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 1;
        });
        const models = [
            { id: 21, mediaType: "image" as const, model: "gpt-image-2", displayName: "旗舰生图", providerName: "OpenAI", apiMode: "images", priceQuota: 1 },
            { id: 22, mediaType: "image" as const, model: "seedream-4-5", displayName: "即梦 4.5", providerName: "火山方舟", apiMode: "images", priceQuota: 2 },
        ];
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: models.map((model) => ({ name: model.model, capability: "image" as const })) }],
            models: models.map((model) => `default::${model.model}`),
            imageModels: models.map((model) => `default::${model.model}`),
        };
        useConfigStore.setState({ mediaModels: { image: models, video: [] } });

        renderPicker({ config, value: "default::gpt-image-2", capability: "image", onChange: vi.fn() });

        act(() => container.querySelector<HTMLElement>('[data-testid="open-select"]')?.click());
        expect(document.activeElement).toBe(container.querySelector('[aria-label="搜索模型"]'));

        searchModels("旗舰");
        expect(container.querySelector('[data-value="default::gpt-image-2"]')).toBeTruthy();
        expect(container.querySelector('[data-value="default::seedream-4-5"]')).toBeNull();

        searchModels("seedream");
        expect(container.querySelector('[data-value="default::seedream-4-5"]')?.textContent).toContain("seedream-4-5");
        expect(container.querySelector('[data-value="default::gpt-image-2"]')).toBeNull();

        searchModels("OPENAI");
        expect(container.querySelector('[data-value="default::gpt-image-2"]')).toBeTruthy();
        expect(container.querySelector('[data-value="default::seedream-4-5"]')).toBeNull();
        requestFrame.mockRestore();
    });

    it("shows an empty search state and keeps keyboard selection values compatible", () => {
        const onChange = vi.fn();
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
        const secondTextModel = "default::gpt-4.1-mini";
        const config = {
            ...configuredTextAndAudioConfig(),
            channels: [{ ...defaultConfig.channels[0], models: [{ name: "gpt-5.5", capability: "text" as const }, { name: "gpt-4.1-mini", capability: "text" as const }] }],
            models: [configuredTextModel, secondTextModel],
            textModels: [configuredTextModel, secondTextModel],
        };

        renderPicker({ config, value: configuredTextModel, capability: "text", onChange });

        act(() => container.querySelector<HTMLElement>('[data-testid="open-select"]')?.click());
        const input = container.querySelector<HTMLInputElement>('[aria-label="搜索模型"]');
        expect(input?.getAttribute("role")).toBe("combobox");
        expect(input?.getAttribute("aria-controls")).toBe(container.querySelector('[role="listbox"]')?.id);
        expect(input?.getAttribute("aria-activedescendant")).toBe(container.querySelector('[role="option"]')?.id);

        searchModels("missing-model");
        expect(container.querySelector('[role="status"]')?.textContent).toBe("没有匹配的模型");

        searchModels("");
        input?.focus();
        act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
        expect(input?.getAttribute("aria-activedescendant")).toBe(container.querySelectorAll('[role="option"]')[1]?.id);
        act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

        expect(onChange).toHaveBeenCalledWith(secondTextModel);
    });
});

describe("mediaModelLabel", () => {
    it("omits the per-call price for video models", () => {
        expect(mediaModelLabel([{ mediaType: "video", model: "video-1", displayName: "Video", providerName: "OpenAI", priceQuota: 12 }], "video-1")).toBe("Video · OpenAI");
    });

    it("omits the per-second price for video models", () => {
        expect(mediaModelLabel([{ mediaType: "video", model: "seedance-2.5", displayName: "seedance-2.5", providerName: "Seedance", priceQuota: 0.39, chargeMode: "second" }], "seedance-2.5")).toBe("seedance-2.5 · Seedance");
    });

    it("keeps image model labels unchanged", () => {
        expect(mediaModelLabel([{ mediaType: "image", model: "image-1", displayName: "Image", providerName: "OpenAI", priceQuota: 12 }], "image-1")).toBe("Image · OpenAI");
    });

});
