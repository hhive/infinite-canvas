import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanvasTextAttempts, buildPluginBuiltinPrompt, buildVideoReversePromptNodes, canReversePromptFromVideoNode, CanvasTopBar, hasActiveCanvasMediaTask, prepareCanvasTextAttempts, resolveTextModelWriteback } from "@/pages/canvas/project";
import { retryTextModelAttempts, TextModelFallbackError } from "@/lib/canvas/text-model-fallback";
import type { MediaAPIKey } from "@/services/api/media-api-keys";
import { useConfigStore } from "@/stores/use-config-store";
import { resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

const { fetchMediaAPIKeys, switchMediaAPIKey } = vi.hoisted(() => ({ fetchMediaAPIKeys: vi.fn(), switchMediaAPIKey: vi.fn() }));

vi.mock(import("@/services/api/media-api-keys"), async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchMediaAPIKeys, switchMediaAPIKey };
});
import { resolveCanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

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
