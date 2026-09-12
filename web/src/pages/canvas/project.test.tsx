import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanvasTextAttempts, buildPluginBuiltinPrompt, buildProductionBoardImageNodes, buildProductionBoardNodes, buildRetriedProductionBoardNode, buildVideoReversePromptNodes, canReversePromptFromVideoNode, CanvasTopBar, findProductionBoardSourceNodes, hasActiveCanvasMediaTask, prepareCanvasTextAttempts, renderProductionBoardFromText, resolveTextModelWriteback, shouldRenderProductionBoardOnRetry, type ProductionBoardDeps } from "@/pages/canvas/project";
import { retryTextModelAttempts, TextModelFallbackError } from "@/lib/canvas/text-model-fallback";
import type { ProductionBoardAnalysis } from "@/lib/canvas/production-board-schema";
import { resolveFrameRate, type SampledVideoFrame, type VideoFrameSamplingResult } from "@/lib/canvas/video-frame-sampling";
import type { UploadedImage } from "@/services/image-storage";
import type { MediaAPIKey } from "@/services/api/media-api-keys";
import { useConfigStore } from "@/stores/use-config-store";
import { resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

const { fetchMediaAPIKeys, switchMediaAPIKey } = vi.hoisted(() => ({ fetchMediaAPIKeys: vi.fn(), switchMediaAPIKey: vi.fn() }));

// 分析层与渲染层由另外的 Agent 实现，这里只按公开契约打桩：本文件关心的是入口编排，
// 不能把上游模块的真实解析/绘制行为搅进来。
const { buildProductionBoardPrompt, parseProductionBoardAnalysis } = vi.hoisted(() => ({ buildProductionBoardPrompt: vi.fn(() => "PRODUCTION_BOARD_PROMPT"), parseProductionBoardAnalysis: vi.fn() }));
const { pickStoryboardFrames, pickCharacterAngles, extractFrameFeatures } = vi.hoisted(() => ({
    pickStoryboardFrames: vi.fn(),
    pickCharacterAngles: vi.fn<() => SampledVideoFrame[]>(),
    extractFrameFeatures: vi.fn<() => Promise<(number[] | null)[]>>(),
}));
const { renderProductionBoard } = vi.hoisted(() => ({ renderProductionBoard: vi.fn() }));

// 只替换提示词与解析两个函数，错误类保留真实实现：入口层要用它承载模型原文。
vi.mock(import("@/lib/canvas/production-board-analysis"), async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, buildProductionBoardPrompt, parseProductionBoardAnalysis };
});
vi.mock("@/lib/canvas/production-board-frames", () => ({ pickStoryboardFrames, pickCharacterAngles, extractFrameFeatures }));
vi.mock("@/lib/canvas/production-board-render", () => ({ renderProductionBoard }));

vi.mock(import("@/services/api/media-api-keys"), async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchMediaAPIKeys, switchMediaAPIKey };
});
import { resolveCanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/constant/env", () => ({ DOCS_URL: "https://docs.example.test" }));

vi.mock("antd", () => ({
    App: { useApp: () => ({ message: {} }) },
    Button: ({ children, icon, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", props, icon, children),
    Dropdown: ({ children }: { children: ReactElement }) => children,
    Modal: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? createElement("div", null, children) : null),
    Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/layout/user-status-actions", () => ({
    UserStatusActions: ({ onOpenPlugins }: { onOpenPlugins?: () => void }) =>
        createElement("div", { className: "user-status-actions" },
            createElement("button", { type: "button", "aria-label": "配置" }, "配置"),
            createElement("button", { type: "button", "aria-label": "账户操作" }, "账户"),
            createElement("button", { type: "button", "aria-label": "节点插件", onClick: onOpenPlugins }, "节点插件"),
        ),
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

function renderTopBar(overrides: Partial<ComponentProps<typeof CanvasTopBar>> = {}) {
    const props: ComponentProps<typeof CanvasTopBar> = {
        title: "一个需要在窄屏省略显示的无限画布项目标题",
        titleDraft: "一个需要在窄屏省略显示的无限画布项目标题",
        isTitleEditing: false,
        onTitleDraftChange: vi.fn(),
        onStartTitleEditing: vi.fn(),
        onFinishTitleEditing: vi.fn(),
        onCancelTitleEditing: vi.fn(),
        canUndo: true,
        canRedo: true,
        onHome: vi.fn(),
        onProjects: vi.fn(),
        onCreateProject: vi.fn(),
        onDeleteProject: vi.fn(),
        onExportProject: vi.fn(),
        onImportImage: vi.fn(),
        onOpenPlugins: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        agentOpen: false,
        compactAgentStatus: { connected: false, enabled: false, activity: "" },
        onToggleAgent: vi.fn(),
        ...overrides,
    };
    act(() => root.render(createElement(CanvasTopBar, props)));
    return props;
}

function button(name: string) {
    const matched = Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name);
    expect(matched, `button ${name}`).toBeTruthy();
    return matched as HTMLButtonElement;
}

function expectClasses(element: Element | null, classes: string[]) {
    expect(element).toBeTruthy();
    for (const className of classes) expect(element?.classList.contains(className), `${element?.className} contains ${className}`).toBe(true);
}

describe("CanvasTopBar", () => {
    it("keeps mobile controls visible with a shrinking ellipsized title", () => {
        const props = renderTopBar();

        const topBar = container.querySelector(".canvas-top-bar");
        const primary = container.querySelector(".canvas-top-bar-primary");
        const title = container.querySelector(".canvas-top-bar-title");
        const titleButton = button(props.title);
        const actions = container.querySelector(".canvas-top-bar-actions");

        expectClasses(topBar, ["flex-wrap", "md:flex-nowrap"]);
        expectClasses(primary, ["w-full", "min-w-0", "md:w-auto"]);
        expectClasses(title, ["min-w-0", "flex-1", "overflow-hidden"]);
        expectClasses(titleButton, ["block", "w-full", "min-w-0", "truncate"]);
        expectClasses(actions, ["ml-auto", "shrink-0"]);

        button("打开画布菜单");
        button("配置");
        button("账户操作");
        act(() => button("节点插件").click());

        act(() => button("Codex 未连接").click());
        act(() => button("Agent").click());
        act(() => titleButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        expect(props.onToggleAgent).toHaveBeenCalledTimes(2);
        expect(props.onStartTitleEditing).toHaveBeenCalledOnce();
        expect(props.onOpenPlugins).toHaveBeenCalledOnce();
    });

    it("preserves the desktop control order", () => {
        renderTopBar();
        const controls = [
            button("打开画布菜单"),
            button("Codex 未连接"),
            button("配置"),
            button("账户操作"),
            button("节点插件"),
            button("Agent"),
        ];

        for (let index = 0; index < controls.length - 1; index += 1) {
            expect(controls[index].compareDocumentPosition(controls[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });
});

describe("hasActiveCanvasMediaTask", () => {
    it("keeps a completed task locked until its media content is stored", () => {
        const recovering = [{ id: "image-1", type: CanvasNodeType.Image, metadata: { imageTaskStatus: "completed" } }] as CanvasNodeData[];
        const stored = [{ id: "image-1", type: CanvasNodeType.Image, metadata: { imageTaskStatus: "completed", content: "https://example.test/image.png" } }] as CanvasNodeData[];

        expect(hasActiveCanvasMediaTask(recovering, null)).toBe(true);
        expect(hasActiveCanvasMediaTask(stored, null)).toBe(false);
    });
});

describe("plugin built-in generation panel", () => {
    it("uses the plugin-declared mode for a custom node type", () => {
        expect(resolveCanvasNodeGenerationMode("plugin.custom-video", "video")).toBe("video");
        expect(resolveCanvasNodeGenerationMode("plugin.custom-text", "text")).toBe("text");
    });

    it("prepends the plugin prompt contract before generation", () => {
        expect(buildPluginBuiltinPrompt("PANORAMA:", "night harbor")).toBe("PANORAMA:night harbor");
    });
});

describe("canvas text fallback across request-scoped api keys", () => {
    const originalTextModels = useConfigStore.getState().mediaModels.text;
    const originalConfig = useConfigStore.getState().config;
    const originalKeyState = useMediaAPIKeyStore.getState();

    function mediaKey(id: number, textModelCount: number, current = false): MediaAPIKey {
        return { id, name: `Key ${id}`, maskedKey: `sk-****${id}`, groupName: `group-${id}`, imageModelCount: 3, videoModelCount: 2, textModelCount, current };
    }

    function setTextModels(models: string[]) {
        useConfigStore.setState((state) => ({
            mediaModels: { ...state.mediaModels, text: models.map((model) => ({ id: model, mediaType: "text" as const, model, displayName: model, providerName: "", apiMode: "", priceQuota: 0 })) },
        }));
    }

    function prepareTextGeneration(models: string[], keys: MediaAPIKey[], currentKeyId: number | null) {
        setTextModels(models);
        useMediaAPIKeyStore.setState({ keys, currentKeyId, status: "ready", error: "" });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        useConfigStore.setState({ config: originalConfig });
        resetMediaAPIKeyStore();
    });

    afterEach(() => {
        useConfigStore.setState((state) => ({ config: originalConfig, mediaModels: { ...state.mediaModels, text: originalTextModels } }));
        useMediaAPIKeyStore.setState({ keys: originalKeyState.keys, currentKeyId: originalKeyState.currentKeyId, status: originalKeyState.status, error: originalKeyState.error });
    });

    it("当前会话 Key 先试全部模型候选，再按文本模型数降序换其他 Key 并只用首项模型", () => {
        prepareTextGeneration(["catalog-a", "gpt-6-astra"], [mediaKey(9, 2), mediaKey(3, 12), mediaKey(4, 0)], 7);

        expect(buildCanvasTextAttempts("node-model")).toEqual([
            { model: "node-model" },
            { model: "gpt-6-astra" },
            { model: "catalog-a" },
            { apiKeyId: 3, model: "node-model" },
            { apiKeyId: 9, model: "node-model" },
        ]);
    });

    it("没有其他可用 Key 时只返回当前会话 Key 的候选", () => {
        prepareTextGeneration(["catalog-a"], [mediaKey(7, 5)], 7);

        expect(buildCanvasTextAttempts("node-model")).toEqual([{ model: "node-model" }, { model: "catalog-a" }]);
    });

    it("store 未加载时先拉取 Key 列表再构造序列，且只加载不切换", async () => {
        setTextModels(["catalog-a", "gpt-6-astra"]);
        fetchMediaAPIKeys.mockResolvedValue([mediaKey(7, 2, true), mediaKey(9, 9)]);
        switchMediaAPIKey.mockResolvedValue(undefined);

        const attempts = await prepareCanvasTextAttempts("node-model");

        expect(fetchMediaAPIKeys).toHaveBeenCalledTimes(1);
        expect(switchMediaAPIKey).not.toHaveBeenCalled();
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ status: "ready", currentKeyId: 7 });
        expect(attempts).toEqual([
            { model: "node-model" },
            { model: "gpt-6-astra" },
            { model: "catalog-a" },
            { apiKeyId: 9, model: "node-model" },
        ]);
    });

    it("Key 列表加载失败时静默回退到当前会话 Key，不影响生成", async () => {
        setTextModels(["catalog-a", "gpt-6-astra"]);
        fetchMediaAPIKeys.mockRejectedValue(new Error("Key 列表不可用"));

        await expect(prepareCanvasTextAttempts("node-model")).resolves.toEqual([
            { model: "node-model" },
            { model: "gpt-6-astra" },
            { model: "catalog-a" },
        ]);
        expect(switchMediaAPIKey).not.toHaveBeenCalled();
    });

    it("手填 API Key 时不换 Key，也不拉取 Key 列表，避免请求头覆盖用户自己的 Bearer", async () => {
        prepareTextGeneration(["catalog-a"], [mediaKey(9, 2), mediaKey(3, 12)], 7);
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, apiKey: "sk-manual" } });

        expect(buildCanvasTextAttempts("node-model")).toEqual([{ model: "node-model" }, { model: "catalog-a" }]);
        await expect(prepareCanvasTextAttempts("node-model")).resolves.toEqual([{ model: "node-model" }, { model: "catalog-a" }]);
        expect(fetchMediaAPIKeys).not.toHaveBeenCalled();
    });

    it("重试过程中不改动全局会话 Key：不调用 select/activate，currentKeyId 保持原值", async () => {
        prepareTextGeneration(["catalog-a", "gpt-6-astra"], [mediaKey(9, 2), mediaKey(3, 12)], 7);
        const keyStore = useMediaAPIKeyStore.getState();
        const selectSpy = vi.spyOn(keyStore, "select");
        const activateSpy = vi.spyOn(keyStore, "activate");
        const seen: Array<number | undefined> = [];

        const error = await retryTextModelAttempts(buildCanvasTextAttempts("node-model"), async (target) => {
            seen.push(target.apiKeyId);
            throw new Error("当前分组下对于模型无可用渠道：请求失败：404");
        }).catch((reason: unknown) => reason);

        expect(seen).toEqual([undefined, undefined, undefined, 3, 9]);
        expect(error).toBeInstanceOf(TextModelFallbackError);
        expect(selectSpy).not.toHaveBeenCalled();
        expect(activateSpy).not.toHaveBeenCalled();
        expect(useMediaAPIKeyStore.getState().currentKeyId).toBe(7);
    });
});

describe("resolveTextModelWriteback", () => {
    it("实际使用的模型与配置节点记录不同时回写该节点", () => {
        expect(resolveTextModelWriteback("config-1", "node-model", "gpt-6-astra")).toEqual({ nodeId: "config-1", model: "gpt-6-astra" });
    });

    it("实际使用的模型与记录一致时不回写", () => {
        expect(resolveTextModelWriteback("config-1", "gpt-6-astra", "gpt-6-astra")).toBeNull();
        expect(resolveTextModelWriteback("config-1", " gpt-6-astra ", "gpt-6-astra")).toBeNull();
    });

    it("失败（没有实际使用的模型）时不回写", () => {
        expect(resolveTextModelWriteback("config-1", "node-model", undefined)).toBeNull();
        expect(resolveTextModelWriteback("config-1", "node-model", "")).toBeNull();
        expect(resolveTextModelWriteback("", "node-model", "gpt-6-astra")).toBeNull();
    });
});

describe("视频反推提示词入口", () => {
    function videoNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
        return {
            id: "video-1",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 100, y: 200 },
            width: 320,
            height: 180,
            metadata: { content: "https://example.test/clip.mp4" },
            ...overrides,
        };
    }

    it("空视频节点与图片节点都不参与视频反推，也不创建任何节点", () => {
        const emptyVideo = videoNode({ metadata: {} });
        const missingContent = videoNode({ metadata: { content: "" } });
        const image = videoNode({ id: "image-1", type: CanvasNodeType.Image });

        expect(canReversePromptFromVideoNode(emptyVideo)).toBe(false);
        expect(canReversePromptFromVideoNode(missingContent)).toBe(false);
        expect(canReversePromptFromVideoNode(image)).toBe(false);
        expect(canReversePromptFromVideoNode(videoNode())).toBe(true);

        expect(buildVideoReversePromptNodes(emptyVideo, ["catalog-a"])).toBeNull();
        expect(buildVideoReversePromptNodes(missingContent, ["catalog-a"])).toBeNull();
        expect(buildVideoReversePromptNodes(image, ["catalog-a"])).toBeNull();
    });

    it("创建文本节点与配置节点，并连出视频→配置、文本→配置两条连线", () => {
        const node = videoNode();
        const plan = buildVideoReversePromptNodes(node, ["catalog-a"]);
        expect(plan).not.toBeNull();
        const { textNode, configNode, connections } = plan!;

        expect(textNode.type).toBe(CanvasNodeType.Text);
        expect(configNode.type).toBe(CanvasNodeType.Config);
        // 与图片反推同向排列：文本节点在视频节点右侧，配置节点再往右，三者垂直居中对齐
        expect(textNode.position.x).toBeGreaterThan(node.position.x + node.width);
        expect(configNode.position.x).toBeGreaterThan(textNode.position.x + textNode.width);
        expect(textNode.position.y + textNode.height / 2).toBeCloseTo(node.position.y + node.height / 2);
        expect(configNode.position.y + configNode.height / 2).toBeCloseTo(node.position.y + node.height / 2);

        expect(connections.map((connection) => [connection.fromNodeId, connection.toNodeId])).toEqual([
            [node.id, configNode.id],
            [textNode.id, configNode.id],
        ]);
        expect(new Set(connections.map((connection) => connection.id)).size).toBe(2);
    });

    it("配置节点是文本模式，并把视频节点与文本节点写进组装提示词", () => {
        const node = videoNode();
        const { textNode, configNode } = buildVideoReversePromptNodes(node, ["catalog-a"])!;

        expect(configNode.metadata?.generationMode).toBe("text");
        expect(configNode.metadata?.count).toBe(1);
        expect(configNode.metadata?.composerContent).toContain(`@[node:${node.id}]`);
        expect(configNode.metadata?.composerContent).toContain(`@[node:${textNode.id}]`);
    });

    it("文本节点预置视频反推提示词，覆盖动作与运动、镜头运动与时间标注", () => {
        const { textNode } = buildVideoReversePromptNodes(videoNode(), ["catalog-a"])!;
        const preset = textNode.metadata?.content || "";

        expect(preset).toBe(textNode.metadata?.prompt);
        expect(preset).toContain("视频");
        expect(preset).toContain("动作与运动");
        expect(preset).toContain("镜头运动");
        // 抽帧是逐帧静态图，时间关系只能靠帧标注传达，提示词必须点出来
        expect(preset).toContain("时间标注");
        // 视频版不得复用图片版预设
        expect(preset).not.toContain("AI 生图");
    });

    it("模型三级解析：目录候选优先，再回退配置文本模型、通用模型与默认文本模型", () => {
        const fallbacks = ["config-text", "config-general", "default-text"];

        // 第一级：目录候选（gpt-6-astra 在目录中时按既有候选顺序排在首位）
        expect(buildVideoReversePromptNodes(videoNode(), ["catalog-a", "gpt-6-astra"], fallbacks)!.configNode.metadata?.model).toBe("gpt-6-astra");
        expect(buildVideoReversePromptNodes(videoNode(), ["catalog-a"], fallbacks)!.configNode.metadata?.model).toBe("catalog-a");
        // 目录为空（Key 未加载或该 Key 无文本模型）时逐级回退
        expect(buildVideoReversePromptNodes(videoNode(), [], fallbacks)!.configNode.metadata?.model).toBe("config-text");
        expect(buildVideoReversePromptNodes(videoNode(), [], ["", "config-general", "default-text"])!.configNode.metadata?.model).toBe("config-general");
        expect(buildVideoReversePromptNodes(videoNode(), [], ["", undefined, "default-text"])!.configNode.metadata?.model).toBe("default-text");
        // 全部缺失时留空，由请求阶段按候选序列继续处理
        expect(buildVideoReversePromptNodes(videoNode(), [], [])!.configNode.metadata?.model).toBe("");
    });

    it("工具栏提供反推视频提示词的入口并接线到画布", () => {
        const toolbar = readFileSync(resolve(process.cwd(), "src/components/canvas/canvas-node-hover-toolbar.tsx"), "utf8");
        expect(toolbar).toContain("onReverseVideoPrompt");
        const project = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        expect(project).toContain("onReverseVideoPrompt={createVideoReversePromptNodes}");
    });
});

describe("制作规划表入口", () => {
    function videoNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
        return {
            id: "video-1",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 100, y: 200 },
            width: 320,
            height: 180,
            metadata: { content: "https://example.test/clip.mp4" },
            ...overrides,
        };
    }

    function textNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
        return {
            id: "text-1",
            type: CanvasNodeType.Text,
            title: "分析",
            position: { x: 900, y: 220 },
            width: 340,
            height: 240,
            metadata: { content: "{}", productionBoardRole: "analysis" },
            ...overrides,
        };
    }

    function frame(timestampMs: number): SampledVideoFrame {
        return { dataUrl: `data:image/jpeg;base64,frame-${timestampMs}`, timestampMs };
    }

    function sampling(frames: SampledVideoFrame[]): VideoFrameSamplingResult {
        return { frames, frameRate: 2, durationMs: 12_000, requestedCount: 24, frameCount: frames.length, truncated: false };
    }

    function uploadedImage(): UploadedImage {
        return { url: "https://example.test/board.png", storageKey: "board.png", width: 1080, height: 1920, bytes: 4096, mimeType: "image/png" };
    }

    function analysis(): ProductionBoardAnalysis {
        return {
            title: "夜航",
            logline: "一条夜航货轮上的工人。",
            shared: { shotCount: 8, palette: [{ name: "钴蓝", hex: "#1B2A4A" }], environment: "港口", notes: "写实" },
            characters: [{ name: "老周", appearance: "瘦高", costume: "橙色工装", consistency: "全程同一件工装" }],
            environment: { location: "货轮甲板", description: "湿滑钢板", cameraMoves: [{ order: 1, position: "左舷", shotType: "中景", movement: "静态" }] },
            storyboard: [{ index: 1, timeSec: 0.5, cameraType: "写实", shotSize: "中景", movement: "静态", action: "工人抬头" }],
            lighting: [{ name: "钠灯", timeOfDay: "夜晚", quality: "硬光", note: "暖橙" }],
            moodKeywords: ["潮湿", "孤寂"],
            audio: { ambient: "引擎低鸣", music: "无", tone: "低落" },
            cinematography: "手持长镜头",
        };
    }

    /** 渲染路径的桩：解析成功、抽帧成功、渲染返回一个稳定的 Blob。 */
    function renderDeps() {
        const sampleFrames = vi.fn(async () => sampling([frame(0), frame(3000), frame(6000)]));
        const renderBoard = vi.fn<ProductionBoardDeps["renderBoard"]>(async () => new Blob(["board"], { type: "image/png" }));
        return { sampleFrames, renderBoard, deps: { sampleFrames, renderBoard } };
    }

    beforeEach(() => {
        buildProductionBoardPrompt.mockReturnValue("PRODUCTION_BOARD_PROMPT");
        parseProductionBoardAnalysis.mockReset();
        parseProductionBoardAnalysis.mockReturnValue(analysis());
        pickStoryboardFrames.mockReset();
        pickStoryboardFrames.mockImplementation((shots: unknown[], frames: SampledVideoFrame[]) => shots.map((_, index) => frames[index] ?? null));
        pickCharacterAngles.mockReset();
        pickCharacterAngles.mockReturnValue([frame(1000)]);
        extractFrameFeatures.mockReset();
        extractFrameFeatures.mockResolvedValue([null]);
        renderProductionBoard.mockReset();
        renderProductionBoard.mockResolvedValue(new Blob(["board"], { type: "image/png" }));
    });

    it("点击入口只创建节点、不调用模型：不解析、不渲染、不抽帧", () => {
        const plan = buildProductionBoardNodes(videoNode(), ["catalog-a"]);
        expect(plan).not.toBeNull();

        // 入口是纯构造函数：模型与 Key 交给用户在配置节点上选，这里一次模型请求都不该发起。
        expect(plan!.promptNode.metadata?.content).toBe("PRODUCTION_BOARD_PROMPT");
        expect(parseProductionBoardAnalysis).not.toHaveBeenCalled();
        expect(renderProductionBoard).not.toHaveBeenCalled();
        expect(pickStoryboardFrames).not.toHaveBeenCalled();
    });

    it("创建提示词节点与配置节点，并连出视频→配置、文本→配置两条连线", () => {
        const node = videoNode();
        const plan = buildProductionBoardNodes(node, ["catalog-a"]);
        expect(plan).not.toBeNull();
        const { promptNode, configNode, connections } = plan!;

        expect(promptNode.type).toBe(CanvasNodeType.Text);
        expect(configNode.type).toBe(CanvasNodeType.Config);
        // 与视频反推同向排列：提示词节点在视频节点右侧，配置节点再往右，三者垂直居中对齐
        expect(promptNode.position.x).toBeGreaterThan(node.position.x + node.width);
        expect(configNode.position.x).toBeGreaterThan(promptNode.position.x + promptNode.width);
        expect(promptNode.position.y + promptNode.height / 2).toBeCloseTo(node.position.y + node.height / 2);
        expect(configNode.position.y + configNode.height / 2).toBeCloseTo(node.position.y + node.height / 2);

        expect(connections.map((connection) => [connection.fromNodeId, connection.toNodeId])).toEqual([
            [node.id, configNode.id],
            [promptNode.id, configNode.id],
        ]);
        expect(new Set(connections.map((connection) => connection.id)).size).toBe(2);
    });

    it("配置节点是文本模式，模型按三级解析，composerContent 引用了视频与提示词", () => {
        const node = videoNode();
        const fallbacks = ["config-text", "config-general", "default-text"];
        const { promptNode, configNode } = buildProductionBoardNodes(node, ["catalog-a"], fallbacks)!;

        expect(configNode.metadata?.generationMode).toBe("text");
        expect(configNode.metadata?.count).toBe(1);
        expect(configNode.metadata?.composerContent).toContain(`@[node:${node.id}]`);
        expect(configNode.metadata?.composerContent).toContain(`@[node:${promptNode.id}]`);

        // 与视频反推同一套三级顺序：目录候选 → 配置文本模型 → 通用模型 → 默认文本模型
        expect(buildProductionBoardNodes(node, ["catalog-a", "gpt-6-astra"], fallbacks)!.configNode.metadata?.model).toBe("gpt-6-astra");
        expect(buildProductionBoardNodes(node, [], fallbacks)!.configNode.metadata?.model).toBe("config-text");
        expect(buildProductionBoardNodes(node, [], ["", "config-general", "default-text"])!.configNode.metadata?.model).toBe("config-general");
        expect(buildProductionBoardNodes(node, [], ["", undefined, "default-text"])!.configNode.metadata?.model).toBe("default-text");
        expect(buildProductionBoardNodes(node, [], [])!.configNode.metadata?.model).toBe("");
    });

    it("制作规划表的角色写在节点 metadata 上，而不是靠标题或提示词猜", () => {
        const { promptNode, configNode } = buildProductionBoardNodes(videoNode(), ["catalog-a"])!;

        expect(promptNode.metadata?.productionBoardRole).toBe("prompt");
        expect(configNode.metadata?.productionBoardRole).toBe("config");
    });

    it("空视频节点不创建任何节点", () => {
        expect(buildProductionBoardNodes(videoNode({ metadata: {} }), ["catalog-a"])).toBeNull();
        expect(buildProductionBoardNodes(videoNode({ metadata: { content: "" } }), ["catalog-a"])).toBeNull();
        expect(buildProductionBoardNodes(videoNode({ id: "image-1", type: CanvasNodeType.Image }), ["catalog-a"])).toBeNull();
    });

    it("能从节点图里找到视频节点与配置节点，供后置钩子与重渲染使用", () => {
        const video = videoNode();
        const config = textNode({ id: "config-1", type: CanvasNodeType.Config, metadata: { productionBoardRole: "config" } });
        const analysisNode = textNode();
        const connections: CanvasConnection[] = [
            { id: "c1", fromNodeId: video.id, toNodeId: config.id },
            { id: "c2", fromNodeId: config.id, toNodeId: analysisNode.id },
        ];
        const nodes = [video, config, analysisNode];

        // 重渲染入口与后置钩子都从分析文本节点出发：一跳找到配置节点，再一跳找到视频节点
        expect(findProductionBoardSourceNodes(analysisNode.id, nodes, connections)).toEqual({ videoNode: video, configNode: config });
        // 从配置节点进入时，它自己就是那个配置节点：抽帧速率不能因此静默回落到默认值
        expect(findProductionBoardSourceNodes(config.id, nodes, connections)).toEqual({ videoNode: video, configNode: config });
        // 反过来不成立：从视频节点往上没有源节点
        expect(findProductionBoardSourceNodes(video.id, nodes, connections)).toEqual({ videoNode: null, configNode: null });
        // 找不到时返回 null 而不是抛错，由调用方提示
        expect(findProductionBoardSourceNodes("missing", nodes, connections)).toEqual({ videoNode: null, configNode: null });
    });

    it("起点是配置节点时抽帧速率仍取自它本身，不从默认值静默回落", () => {
        const video = videoNode();
        const config = textNode({ id: "config-1", type: CanvasNodeType.Config, metadata: { productionBoardRole: "config", videoFrameRate: 5 } });
        const connections: CanvasConnection[] = [{ id: "c1", fromNodeId: video.id, toNodeId: config.id }];

        const { configNode } = findProductionBoardSourceNodes(config.id, [video, config], connections);

        expect(configNode?.id).toBe(config.id);
        expect(resolveFrameRate(configNode?.metadata?.videoFrameRate)).toBe(5);
    });

    it("解析成功时抽一次帧并渲染出板面", async () => {
        const { deps, sampleFrames } = renderDeps();

        const outcome = await renderProductionBoardFromText({ analysisText: "{}", videoUrl: "https://example.test/clip.mp4", frameRate: 3, deps });

        expect(outcome.status).toBe("success");
        expect(outcome.status === "success" && outcome.analysis.title).toBe("夜航");
        expect(outcome.status === "success" && outcome.board).toBeInstanceOf(Blob);
        // 只抽一次帧：板面上最大的帧框也只有约 169×180，没有必要为故事板再抽一遍高清帧
        expect(sampleFrames).toHaveBeenCalledTimes(1);
        expect(sampleFrames).toHaveBeenCalledWith(expect.objectContaining({ source: "https://example.test/clip.mp4", frameRate: 3 }));
    });

    it("挑不到帧的镜头把 null 原样交给渲染层降级，由渲染层决定画什么", async () => {
        const { deps, renderBoard } = renderDeps();
        pickStoryboardFrames.mockReturnValue([null, frame(0)]);

        await renderProductionBoardFromText({ analysisText: "{}", videoUrl: "https://example.test/clip.mp4", deps });

        expect(renderBoard.mock.calls[0][0].storyboardFrames).toEqual([null, frame(0)]);
        // 角色视角差异要靠帧特征，特征取自同一批抽帧
        expect(extractFrameFeatures).toHaveBeenCalledWith([frame(0), frame(3000), frame(6000)]);
    });

    it("解析失败不抛错、不抽帧、不渲染：原文留在文本节点里等用户修正", async () => {
        const { deps, sampleFrames, renderBoard } = renderDeps();
        parseProductionBoardAnalysis.mockImplementation(() => {
            throw new Error("缺少 storyboard 字段");
        });

        const outcome = await renderProductionBoardFromText({ analysisText: "模型原文不是 JSON", videoUrl: "https://example.test/clip.mp4", deps });

        expect(outcome).toEqual({ status: "failed", kind: "parse", reason: "缺少 storyboard 字段" });
        // 先解析后抽帧：解析失败不该白跑一次抽帧，更不能拿默认值硬凑一张板
        expect(sampleFrames).not.toHaveBeenCalled();
        expect(renderBoard).not.toHaveBeenCalled();
    });

    it("抽帧失败返回失败而不是渲染出一张空板", async () => {
        const sampleFrames = vi.fn(async () => {
            throw new Error("未能从视频中解出任何帧，视频可能为空或不可解码");
        });
        const renderBoard = vi.fn<ProductionBoardDeps["renderBoard"]>(async () => new Blob(["board"], { type: "image/png" }));

        const outcome = await renderProductionBoardFromText({ analysisText: "{}", videoUrl: "https://example.test/clip.mp4", deps: { sampleFrames, renderBoard } });

        expect(outcome).toEqual({ status: "failed", kind: "other", reason: "未能从视频中解出任何帧，视频可能为空或不可解码" });
        expect(renderBoard).not.toHaveBeenCalled();
    });

    it("渲染成功后图片节点按 9:16 接在分析文本节点右侧", () => {
        const analysisNode = textNode();
        const { imageNode, connection } = buildProductionBoardImageNodes(analysisNode, uploadedImage());

        expect(imageNode.type).toBe(CanvasNodeType.Image);
        expect(imageNode.metadata?.content).toBe("https://example.test/board.png");
        expect(imageNode.width).toBe(340);
        expect(imageNode.height).toBe(Math.round((340 * 1920) / 1080));
        expect(imageNode.position.x).toBeGreaterThan(analysisNode.position.x + analysisNode.width);
        expect(imageNode.position.y + imageNode.height / 2).toBeCloseTo(analysisNode.position.y + analysisNode.height / 2);
        expect([connection.fromNodeId, connection.toNodeId]).toEqual([analysisNode.id, imageNode.id]);
    });

    it("渲染规划板入口只解析与渲染，失败在前、建图片节点在后", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        const matched = /const renderProductionBoardBoard = useCallback\(\s*async \(analysisNode: CanvasNodeData\) => \{([\s\S]*?)\n        \},\n        \[/.exec(source);
        expect(matched, "未能定位 renderProductionBoardBoard 函数体").not.toBeNull();
        const body = matched![1];

        expect(body).toContain("renderProductionBoardFromText(");
        // 这条路径不调用模型：改了 JSON 重渲染不该再产生一次文本请求
        expect(body).not.toContain("requestImageQuestion");
        expect(body).not.toContain("retryTextModelAttempts");
        // 失败分支必须排在图片节点构造之前，解析失败才不会产出板面
        const failure = body.indexOf('if (outcome.status === "failed")');
        expect(failure).toBeGreaterThanOrEqual(0);
        expect(failure).toBeLessThan(body.indexOf("buildProductionBoardImageNodes"));
    });

    it("生成完成的钩子挂在标记为 config 的节点上，且不靠标题或提示词文本匹配", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");

        expect(source).toContain('sourceNode?.metadata?.productionBoardRole === "config"');
        expect(source).toContain("renderProductionBoardBoard({ ...rootNode");
        // 分析文本节点也要带上标记，工具栏的重渲染入口才找得到它
        expect(source).toContain('productionBoardRole: "analysis" as const');
    });

    it("切换 API Key 刷新模型目录不会让整块画布重载：取消回调只依赖 Key 字符串", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        const matched = /const cancelGenerationTarget = useCallback\(\s*async \(targetNodeId: string\) => \{([\s\S]*?)\n    \}, \[([^\]]*)\]\);/.exec(source);
        expect(matched, "未能定位 cancelGenerationTarget 的依赖数组").not.toBeNull();
        const deps = matched![2];

        // 依赖整个 effectiveConfig 会让 applyMediaModels 每次刷新目录都换掉它的引用：
        // cancelGenerationTarget -> trackCanvasImageTask -> 项目加载 effect 连锁重跑，
        // effect 首行 setProjectLoaded(false) 会把整块画布换成 CanvasRefreshShell 占位壳。
        // 闭包里只用到 effectiveConfig.apiKey，依赖必须收敛到该字符串。
        expect(deps).toContain("effectiveConfig.apiKey");
        expect(deps).not.toMatch(/\beffectiveConfig\b(?!\.apiKey)/);
    });

    it("工具栏提供生成制作规划表与渲染规划板两个入口并接线到画布", () => {
        const toolbar = readFileSync(resolve(process.cwd(), "src/components/canvas/canvas-node-hover-toolbar.tsx"), "utf8");
        expect(toolbar).toContain("onProductionBoard");
        expect(toolbar).toContain("onRenderProductionBoard");
        const project = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        expect(project).toContain("onProductionBoard={createProductionBoardNodes}");
        expect(project).toContain("onRenderProductionBoard={(node) => void renderProductionBoardBoard(node)}");
    });

    it("重试只有分析文本节点会重出板，重试提示词节点不会", () => {
        // 提示词节点同样挂在配置节点上游，按「上游是配置节点」判断会让重试提示词也画出一张板
        expect(shouldRenderProductionBoardOnRetry(textNode())).toBe(true);
        expect(shouldRenderProductionBoardOnRetry(textNode({ metadata: { productionBoardRole: "prompt" } }))).toBe(false);
        expect(shouldRenderProductionBoardOnRetry(textNode({ type: CanvasNodeType.Config, metadata: { productionBoardRole: "config" } }))).toBe(false);
        expect(shouldRenderProductionBoardOnRetry(videoNode())).toBe(false);
    });

    it("重试成功后拿新内容走同一条渲染路径，解析成功就建图片节点", async () => {
        const { deps } = renderDeps();
        const retried = buildRetriedProductionBoardNode(textNode({ metadata: { content: "旧内容", prompt: "旧提示词", productionBoardRole: "analysis", status: "success" } }), "新内容", "新提示词");

        expect(retried.metadata?.content).toBe("新内容");
        expect(retried.metadata?.prompt).toBe("新提示词");
        // 标记必须原样保留，否则重出板之后就没法继续重试重渲染了
        expect(shouldRenderProductionBoardOnRetry(retried)).toBe(true);

        const outcome = await renderProductionBoardFromText({ analysisText: retried.metadata?.content || "", videoUrl: "https://example.test/clip.mp4", deps });
        expect(outcome.status).toBe("success");
        expect(buildProductionBoardImageNodes(retried, uploadedImage()).imageNode.type).toBe(CanvasNodeType.Image);
    });

    it("重试后解析失败同样不抛错、不建图片节点，原文留在文本节点里", async () => {
        const { deps, sampleFrames, renderBoard } = renderDeps();
        parseProductionBoardAnalysis.mockImplementation(() => {
            throw new Error("模型输出里找不到 JSON 对象");
        });
        const retried = buildRetriedProductionBoardNode(textNode(), "模型原文不是 JSON", "提示词");

        const outcome = await renderProductionBoardFromText({ analysisText: retried.metadata?.content || "", videoUrl: "https://example.test/clip.mp4", deps });

        expect(outcome).toEqual({ status: "failed", kind: "parse", reason: "模型输出里找不到 JSON 对象" });
        expect(sampleFrames).not.toHaveBeenCalled();
        expect(renderBoard).not.toHaveBeenCalled();
        // 原文仍在文本节点里，用户可手工修正后再点「渲染规划板」
        expect(retried.metadata?.content).toBe("模型原文不是 JSON");
    });

    it("重试路径只渲染一次，且不转交生成路径，同一次生成不会渲染两次", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        const matched = /const handleRetryNode = useCallback\(\s*async \(node: CanvasNodeData, imageId\?: string\) => \{([\s\S]*?)\n        \},\n        \[/.exec(source);
        expect(matched, "未能定位 handleRetryNode 函数体").not.toBeNull();
        const body = matched![1];

        expect(body).toContain("if (shouldRenderProductionBoardOnRetry(node))");
        expect(body).toContain("buildRetriedProductionBoardNode(node, content, prompt)");
        // 重试路径自己只调用一次渲染；转交生成路径会让同一次生成渲染两次
        expect(body.match(/renderProductionBoardBoard\(/g) ?? []).toHaveLength(1);
        expect(body).not.toContain("handleGenerateNode(");
    });
});
describe("项目加载 effect 的依赖契约", () => {
    it("加载项目与恢复任务的 effect 不得依赖 effectiveConfig", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        const matched = /void restore\(\);\s*\},\s*\[([^\]]*)\]/.exec(source);
        expect(matched, "未能定位项目加载 effect 的依赖数组").not.toBeNull();
        // effectiveConfig 由 config 派生、每次模型目录刷新都会换新身份（applyMediaModels），
        // 一旦成为该 effect 的依赖，就会形成「切 Key → 目录刷新 → 重载项目并恢复任务 →
        // 恢复任务触发生成 → 生成翻转 taskActive → picker 自动切 Key」的自持闭环。
        expect(matched![1]).not.toContain("effectiveConfig");
    });

    it("恢复流程按调用时刻读取配置，而不是捕获响应式的 effectiveConfig", () => {
        const source = readFileSync(resolve(process.cwd(), "src/pages/canvas/project.tsx"), "utf8");
        const restoreBody = /const restore = async \(\) => \{([\s\S]*?)\n        \};/.exec(source);
        expect(restoreBody, "未能定位 restore 函数体").not.toBeNull();
        expect(restoreBody![1]).toContain("readEffectiveConfig()");
        expect(restoreBody![1]).not.toContain("effectiveConfig.");
    });
});
