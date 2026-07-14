import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mediaModelLabel, ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/select", () => ({
    Select: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    SelectContent: ({ children }: { children: ReactNode }) => createElement("div", { "data-testid": "select-content" }, children),
    SelectItem: ({ children, textValue, value }: { children: ReactNode; textValue?: string; value: string }) => createElement("div", { "data-text-value": textValue, "data-value": value }, children),
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => createElement("button", props, children),
}));

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
    useConfigStore.setState({ mediaModels: { image: [], video: [] } });
});

function renderPicker(props: ComponentProps<typeof ModelPicker>) {
    act(() => root.render(createElement(ModelPicker, props)));
}

describe("ModelPicker", () => {
    it("keeps responsive visibility separate from the selected video layout", () => {
        const model = { id: 1, mediaType: "video" as const, model: "video-1", displayName: "A very long video model name", providerName: "OpenAI", apiMode: "videos", priceQuota: 12 };
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [model.model] }],
            models: [`default::${model.model}`],
            videoModels: [`default::${model.model}`],
        };
        useConfigStore.setState({ mediaModels: { image: [], video: [model] } });

        renderPicker({ config, value: `default::${model.model}`, capability: "video", onChange: vi.fn() });

        const trigger = container.querySelector("button");
        const responsiveWrapper = trigger?.querySelector(".canvas-model-picker-text");
        const layout = responsiveWrapper?.firstElementChild;
        const identity = layout?.children[0];
        const price = layout?.children[1];
        const option = container.querySelector(`[data-value="default::${model.model}"]`);

        expect(responsiveWrapper?.classList.contains("flex")).toBe(false);
        expect(layout?.classList.contains("flex")).toBe(true);
        expect(layout?.classList.contains("min-w-0")).toBe(true);
        expect(layout?.classList.contains("w-full")).toBe(true);
        expect(identity?.classList.contains("truncate")).toBe(true);
        expect(price?.classList.contains("shrink-0")).toBe(true);
        expect(trigger?.title).toContain("12 / 次");
        expect(option?.getAttribute("data-text-value")).toContain("12 / 次");
    });

    it("keeps the placeholder in the responsive wrapper", () => {
        renderPicker({ config: defaultConfig, capability: "video", onChange: vi.fn(), placeholder: "选择视频模型" });

        const placeholder = container.querySelector(".canvas-model-picker-text");
        expect(placeholder?.textContent).toBe("选择视频模型");
        expect(placeholder?.classList.contains("truncate")).toBe(true);
    });

    it("uses one bounded price label for extreme finite video prices", () => {
        const model = { id: 2, mediaType: "video" as const, model: "video-extreme", displayName: "Extreme Video", providerName: "OpenAI", apiMode: "videos", priceQuota: Number.MAX_VALUE };
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [model.model] }],
            models: [`default::${model.model}`],
            videoModels: [`default::${model.model}`],
        };
        useConfigStore.setState({ mediaModels: { image: [], video: [model] } });

        renderPicker({ config, value: `default::${model.model}`, capability: "video", onChange: vi.fn() });

        const trigger = container.querySelector("button");
        const visiblePrice = trigger?.querySelector(".canvas-model-picker-text")?.firstElementChild?.children[1]?.textContent || "";
        const optionTextValue = container.querySelector(`[data-value="default::${model.model}"]`)?.getAttribute("data-text-value") || "";

        expect(visiblePrice.length).toBeLessThan(32);
        expect(visiblePrice).toMatch(/E\+?308 \/ 次$/i);
        expect(trigger?.title.endsWith(visiblePrice)).toBe(true);
        expect(optionTextValue.endsWith(visiblePrice)).toBe(true);
    });
});

describe("mediaModelLabel", () => {
    it("shows the per-call price for video models", () => {
        expect(mediaModelLabel([{ mediaType: "video", model: "video-1", displayName: "Video", providerName: "OpenAI", priceQuota: 12 }], "video-1")).toBe("Video · OpenAI · 12 / 次");
    });

    it("keeps image model labels unchanged", () => {
        expect(mediaModelLabel([{ mediaType: "image", model: "image-1", displayName: "Image", providerName: "OpenAI", priceQuota: 12 }], "image-1")).toBe("Image · OpenAI");
    });

    it("never displays negative zero", () => {
        expect(mediaModelLabel([{ mediaType: "video", model: "video-1", displayName: "Video", providerName: "OpenAI", priceQuota: -0 }], "video-1")).not.toContain("-0 / 次");
    });

    it("bounds extreme finite prices while preserving their magnitude", () => {
        const label = mediaModelLabel([{ mediaType: "video", model: "video-1", displayName: "Video", providerName: "OpenAI", priceQuota: Number.MAX_VALUE }], "video-1");
        expect(label.length).toBeLessThan(80);
        expect(label).toMatch(/E\+?308 \/ 次$/i);
    });
});
