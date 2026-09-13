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
import { NODE_DEFAULT_SIZE, NODE_SPECS } from "@/constant/canvas";
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

describe("配置节点面板布局", () => {
    // 节点内容层带 overflow-hidden 且高度取节点自身像素高度，面板比节点高时只会从底部裁掉最后一个子元素。
    // 生成按钮正是最后一个子元素，历史上因此只露出上半截。
    it("控件区独立滚动，生成按钮在滚动区之外且不被压缩", () => {
        renderPanel(configNode());
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("flex-col");

        const scrollRegion = root.querySelector<HTMLElement>(":scope > .overflow-y-auto");
        expect(scrollRegion, "面板需要一层可滚动的控件区").not.toBeNull();
        expect(scrollRegion!.className).toContain("min-h-0");
        expect(scrollRegion!.className).toContain("flex-1");
        expect(scrollRegion!.textContent).toContain("生成配置");
        expect(scrollRegion!.textContent).toContain("组装提示词");

        const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes("开始生成"));
        expect(button, "未找到开始生成按钮").toBeDefined();
        expect(scrollRegion!.contains(button!)).toBe(false);
        expect(button!.parentElement).toBe(root);
        expect(button!.previousElementSibling).toBe(scrollRegion);
        expect(button!.className).toContain("shrink-0");
    });

    // 默认高度按中文面板估算：顶部内边距 28 + 标题行 24 + 标签两行 62 + API Key 选择 32
    // + 模型行 40 + 按钮 36 + 底部内边距 12 + 上下边框 4 + 四处间距 32，合计约 270。
    it("默认高度能容纳中文面板内容，新建节点无需内部滚动", () => {
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Config].height).toBe(NODE_SPECS[CanvasNodeType.Config].height);
        expect(NODE_SPECS[CanvasNodeType.Config].height).toBeGreaterThanOrEqual(280);
    });
});
