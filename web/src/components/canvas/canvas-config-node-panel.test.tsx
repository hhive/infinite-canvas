import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 只关心配置面板与设置弹层之间的接线，其余面板一律替换掉。
const textSettingsProps: { current?: Record<string, unknown> } = {};

vi.mock("antd", () => ({
    Button: ({ children, ...props }: ComponentProps<"button"> & { children?: ReactNode }) => createElement("button", { type: "button", ...props }, children),
    Segmented: () => null,
}));

vi.mock("@/components/model-picker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/media-api-key-picker", () => ({ MediaAPIKeyPicker: () => null }));
vi.mock("./canvas-image-settings-popover", () => ({ CanvasImageSettingsPopover: () => null }));
vi.mock("./canvas-video-settings-popover", () => ({ CanvasVideoSettingsPopover: () => null }));
vi.mock("./canvas-audio-settings-popover", () => ({ CanvasAudioSettingsPopover: () => null }));
vi.mock("./canvas-text-settings-popover", () => ({
    CanvasTextSettingsPopover: (props: Record<string, unknown>) => {
        textSettingsProps.current = props;
        return null;
    },
}));

vi.mock("@/stores/use-config-store", () => ({
    defaultConfig: { model: "default", textModel: "default-text", reasoningEffort: "auto", quality: "auto", size: "auto", count: "1" },
    resolveModelForCapability: (_config: unknown, model?: string) => model || "resolved",
    useEffectiveConfig: () => ({ model: "config-model", textModel: "config-text-model", reasoningEffort: "auto", quality: "auto", size: "auto", count: "1", canvasImageCount: "1" }),
    useConfigStore: (selector: (state: { openConfigDialog: () => void }) => unknown) => selector({ openConfigDialog: () => undefined }),
}));

vi.mock("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: string }) => unknown) => selector({ theme: "light" }),
}));

import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { DEFAULT_VIDEO_REVERSE_FRAME_RATE } from "@/lib/canvas/video-frame-sampling-plan";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "@/i18n";

function configNode(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: "config-1", type: CanvasNodeType.Config, title: "配置", position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { generationMode: "text", ...metadata } };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    textSettingsProps.current = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
});

function renderPanel(node: CanvasNodeData, onConfigChange = vi.fn()) {
    act(() =>
        root.render(
            createElement(CanvasConfigNodePanel, {
                node,
                isRunning: false,
                inputSummary: { textCount: 1, imageCount: 0, videoCount: 1, audioCount: 0 },
                onConfigChange,
                onGenerate: () => undefined,
                onStop: () => undefined,
                onComposerToggle: () => undefined,
            }),
        ),
    );
    return { onConfigChange };
}

describe("配置节点文本模式下的抽帧速率", () => {
    it("把节点上的速率传给设置弹层；节点没设过时显示缺省速率", () => {
        renderPanel(configNode({ videoFrameRate: 5 }));
        expect(textSettingsProps.current?.frameRate).toBe(5);

        renderPanel(configNode());
        expect(textSettingsProps.current?.frameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });

    it("弹层显示的是收敛后的速率，与生成时实际用的一致", () => {
        renderPanel(configNode({ videoFrameRate: 99 }));
        expect(textSettingsProps.current?.frameRate).toBe(5);

        renderPanel(configNode({ videoFrameRate: Number.NaN }));
        expect(textSettingsProps.current?.frameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });

    it("改速率时写回该节点的 metadata，并与其他节点设置一起持久化", () => {
        const { onConfigChange } = renderPanel(configNode({ videoFrameRate: 2 }));

        act(() => (textSettingsProps.current?.onFrameRateChange as (rate: number) => void)(4));

        expect(onConfigChange).toHaveBeenCalledWith("config-1", { videoFrameRate: 4 });
    });
});
