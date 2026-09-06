import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("antd", () => ({
    Slider: () => null,
    Switch: () => null,
}));

vi.mock("@/components/image-settings-panel", () => ({
    ImageSettingsTheme: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

vi.mock("@/stores/use-config-store", () => ({
    modelOptionName: (model: string) => model.includes("::") ? model.split("::")[1] : model,
    resolveModelRequestConfig: (config: AiConfig) => config,
    useConfigStore: (selector: (state: { mediaModels: { video: unknown[] } }) => unknown) => selector({ mediaModels: { video: [] } }),
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
});

describe("VideoSettingsPanel", () => {
    it("offers count and per-second billing, with count selected by default", () => {
        const onConfigChange = vi.fn();
        const config = {
            baseUrl: "https://api.example.com",
            apiKey: "",
            apiFormat: "openai",
            channels: [],
            model: "default::video-model",
            videoModel: "default::video-model",
            videoSeconds: "6",
            vquality: "720",
            size: "auto",
            videoMode: "frames",
            videoChargeMode: "cnt",
        } as unknown as AiConfig;

        act(() => root.render(createElement(VideoSettingsPanel, { config, onConfigChange, theme: canvasThemes.light })));

        const count = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "按条");
        const second = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "按秒");
        expect(count).toBeTruthy();
        expect(second).toBeTruthy();
        expect(count?.getAttribute("aria-pressed")).toBe("true");

        act(() => second?.click());
        expect(onConfigChange).toHaveBeenLastCalledWith("videoChargeMode", "second");
    });
});
