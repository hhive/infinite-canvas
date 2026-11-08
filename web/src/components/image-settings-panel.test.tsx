import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("antd", () => ({
    ConfigProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    Switch: () => null,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useConfigStore.setState({ mediaModels: { image: [], video: [], text: [] } });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function imageConfig(model: string, overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        ...defaultConfig,
        model: `default::${model}`,
        imageModel: `default::${model}`,
        count: "3",
        ...overrides,
    };
}

function render(config: AiConfig, onConfigChange: (key: string, value: string) => void) {
    act(() => {
        root.render(createElement(ImageSettingsPanel, { config, onConfigChange: onConfigChange as never, theme: canvasThemes.light, showTitle: false }));
    });
}

function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
    expect(button, `button ${text}`).toBeTruthy();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("image settings 2.6 controls", () => {
    it("shows complexity without quality for other models", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images", priceQuota: 0 }], video: [], text: [] } });
        render(imageConfig("gpt-image-2.6-flare", { imageFormat: "gif" }), () => undefined);

        expect(container.textContent).toContain("复杂度");
        expect(container.textContent).not.toContain("质量");
        expect(container.textContent).not.toContain("输出格式");
        expect(container.textContent).not.toContain("帧数");
        expect(container.textContent).toContain("生成张数");
    });

    it("hides complexity for responses image models", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "responses-image", mediaType: "image", model: "responses-image", displayName: "responses-image", providerName: "", apiMode: "responses", priceQuota: 0 }], video: [], text: [] } });
        render(imageConfig("responses-image"), () => undefined);

        expect(container.textContent).not.toContain("复杂度");
        expect(container.textContent).not.toContain("质量");
        expect(container.textContent).toContain("生成张数");
    });

    it("shows complexity and output format for 2.6 models", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        render(imageConfig("gpt-image-2.6-flare"), () => undefined);

        expect(container.textContent).toContain("复杂度");
        expect(container.textContent).not.toContain("质量");
        expect(container.textContent).toContain("输出格式");
        expect(container.textContent).toContain("PNG");
        expect(container.textContent).toContain("GIF");
        expect(container.textContent).toContain("SVG");
    });

    it("forces a single image when svg is selected", () => {
        const onConfigChange = vi.fn();
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        render(imageConfig("gpt-image-2.6-flare"), onConfigChange);

        clickButton("SVG");

        expect(onConfigChange).toHaveBeenCalledWith("format", "svg");
        expect(onConfigChange).toHaveBeenCalledWith("count", "1");

        render(imageConfig("gpt-image-2.6-flare", { imageFormat: "svg" }), onConfigChange);
        expect(container.textContent).toContain("SVG 仅生成单张图片");
        expect(container.textContent).not.toContain("生成张数");
    });

    it("uses the explicitly selected model for 2.6 gating", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        const config = { ...imageConfig("gpt-image-2"), imageModel: "default::gpt-image-2" };
        act(() => {
            root.render(createElement(ImageSettingsPanel, { config, model: "default::gpt-image-2.6-flare", onConfigChange: (() => undefined) as never, theme: canvasThemes.light, showTitle: false }));
        });

        expect(container.textContent).toContain("复杂度");
        expect(container.textContent).toContain("输出格式");
    });

    it("lets users change the svg author model", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        const onConfigChange = vi.fn();
        render(imageConfig("gpt-image-2.6-flare", { imageFormat: "svg" }), onConfigChange);

        expect(container.textContent).toContain("SVG 作者模型");
        const input = Array.from(container.querySelectorAll("input[type=text]")).find((item) => (item as HTMLInputElement).value === "gpt-6.1-sol");
        expect(input).toBeTruthy();
        act(() => {
            const field = input as HTMLInputElement;
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            setValue?.call(field, "gpt-6-x");
            field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(onConfigChange).toHaveBeenCalledWith("svgModel", "gpt-6-x");
    });

    it("forces 512x512 and hides size controls for gif", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        const onConfigChange = vi.fn();
        render(imageConfig("gpt-image-2.6-flare"), onConfigChange);

        clickButton("GIF");

        expect(onConfigChange).toHaveBeenCalledWith("format", "gif");
        expect(onConfigChange).toHaveBeenCalledWith("size", "512x512");
        render(imageConfig("gpt-image-2.6-flare", { imageFormat: "gif" }), onConfigChange);
        expect(container.textContent).toContain("GIF 统一使用 512×512");
        expect(container.textContent).not.toContain("分辨率");
        expect(container.textContent).not.toContain("宽高比");
        expect(container.textContent).not.toContain("尺寸");
    });

    it("shows gif frame controls only for gif output", () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: "gpt-image-2.6-flare", mediaType: "image", model: "gpt-image-2.6-flare", displayName: "gpt-image-2.6-flare", providerName: "", apiMode: "images_2_6", priceQuota: 0 }], video: [], text: [] } });
        const onConfigChange = vi.fn();
        render(imageConfig("gpt-image-2.6-flare", { imageFormat: "gif", imageFrameCount: "12", imageFrameDurationMs: "400" }), onConfigChange);
        expect(container.textContent).toContain("帧数");
        expect(container.textContent).toContain("帧时长（毫秒）");
        const frameCountInput = Array.from(container.querySelectorAll("input[type=number]")).find((input) => (input as HTMLInputElement).value === "12");
        expect(frameCountInput).toBeTruthy();
        act(() => {
            const input = frameCountInput as HTMLInputElement;
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            setValue?.call(input, "8");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(onConfigChange).toHaveBeenCalledWith("frameCount", "8");
    });
});
