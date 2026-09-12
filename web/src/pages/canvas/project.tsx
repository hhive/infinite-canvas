import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, Bot, Home, ImageIcon, Images, List, Menu, Music2, Plus, Redo2, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { cancelImageTask, requestEdit, requestGeneration, requestImageQuestion, resumeImageTask, type ImageTask } from "@/services/api/image";
import { imageTaskAuthIdentity, matchesImageTaskAuthIdentity } from "@/services/image-task-storage";
import { applyImageTaskTerminalStatus, canCancelImageTaskStatus, cancelImageTaskBatch, cancelImageTaskRequest, resetInterruptedImageGeneration, resumeCanvasImageTasks } from "@/lib/canvas/image-task-recovery";
import { normalizeInterruptedVideoGeneration, resumeCanvasVideoTasks } from "@/lib/canvas/video-task-recovery";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { isVideoTaskFailed, previewGeneratedVideo, requestVideoGeneration, resumeVideoGenerationTask, storeGeneratedVideo, type VideoGenerationResult, type VideoGenerationTask } from "@/services/api/video";
import { DOCS_URL } from "@/constant/env";
import { defaultConfig, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { resolveImageUrl, uploadGeneratedImage, uploadImage, type UploadedImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { App, Button, Dropdown, Modal } from "antd";
import { captureVideoFrame, type VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { buildCanvasResourceReferences, buildNodeMentionReferences, getGroupResourceNodes, isCanvasReferenceNode, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { applyGroupSelection, applyUngroupSelection, canGroupSelectedNodes, canUngroupSelectedNodes, collectGroupMemberNodes, getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";
import { getNodeDefinition, isBuiltinNodeType, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { buildTextModelAttempts, resolveTextModelCandidates, retryTextModelAttempts, type TextModelAttempt } from "@/lib/canvas/text-model-fallback";
import { ensureMediaAPIKeysLoaded, ensureMediaModelsLoaded, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeText,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

registerBuiltinNodes();

export { CanvasTopBar } from "@/components/canvas/canvas-top-bar";

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
    taskId?: string;
    cancelRequested?: boolean;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

function applyGeneratedVideo(item: CanvasNodeData, video: UploadedFile, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const videoSize = fitNodeSize(video.width || item.width, video.height || item.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    return {
        ...item,
        width: videoSize.width,
        height: videoSize.height,
        position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
        metadata: { ...item.metadata, ...videoMetadata(video), ...extra },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("pan");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [expandedBatchNodeIds, setExpandedBatchNodeIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [referencePickerNodeId, setReferencePickerNodeId] = useState<string | null>(null);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const cancelGenerationTarget = useCallback(async (targetNodeId: string) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (!request) return;
        const node = nodesRef.current.find((item) => item.id === targetNodeId);
        if (node?.metadata?.videoTaskId && ["queued", "running"].includes(node.metadata.videoTaskStatus || "")) {
            // Video cancellation is intentionally disabled. The former server-side
            // implementation is retained but no longer exposed by the public API.
            return;
        }
        if (node?.metadata?.imageTaskStatus && !canCancelImageTaskStatus(node.metadata.imageTaskStatus)) return;
        if (!request.taskId) {
            request.cancelRequested = true;
            setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, errorDetails: "正在等待任务创建后取消..." } } : node));
            return;
        }
        try {
            const task = await cancelImageTask(request.taskId, effectiveConfig.apiKey);
            setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: applyImageTaskTerminalStatus(node.metadata || {}, task.status, task.error_message) } : node));
            if (task.status === "canceled") cancelImageTaskRequest(generationRequestsRef.current, targetNodeId);
        } catch (error) {
            setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, errorDetails: error instanceof Error ? `取消失败：${error.message}` : "取消失败，请稍后重试" } } : node));
        }
    }, [effectiveConfig]);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        void cancelImageTaskBatch(generationRequestsRef.current, runningId, cancelGenerationTarget);
        setRunningNodeId((current) => (current === runningId ? null : current));
    }, [cancelGenerationTarget]);

    const stopGenerationByTargetId = useCallback((targetNodeId: string) => {
        void cancelGenerationTarget(targetNodeId);
    }, [cancelGenerationTarget]);

    const trackCanvasImageTask = useCallback(async (targetNodeId: string, task: ImageTask) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request) request.taskId = task.task_id;
        const authIdentity = await imageTaskAuthIdentity(effectiveConfig.apiKey);
        setNodes((prev) =>
            prev.map((node) =>
                node.id === targetNodeId
                    ? { ...node, metadata: { ...node.metadata, imageTaskId: task.task_id, imageTaskStatus: task.status, imageTaskModelConfigId: task.model_config_id, imageTaskAuthIdentity: authIdentity } }
                    : node,
            ),
        );
        if (request?.cancelRequested) await cancelGenerationTarget(targetNodeId);
    }, [cancelGenerationTarget, effectiveConfig.apiKey]);

    const trackCanvasVideoTask = useCallback(async (targetNodeId: string, task: VideoGenerationTask) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request) request.taskId = task.id;
        const authIdentity = await imageTaskAuthIdentity(effectiveConfig.apiKey);
        setNodes((prev) => prev.map((node) => node.id === targetNodeId ? {
            ...node,
            metadata: {
                ...node.metadata,
                videoTaskId: task.id,
                videoTaskStatus: task.status,
                videoTaskModelConfigId: task.modelConfigId,
                videoTaskAuthIdentity: authIdentity,
            },
        } : node));
    }, [effectiveConfig.apiKey]);

    useEffect(() => () => {
        generationRequestsRef.current.forEach((request) => request.controller.abort());
        generationRequestsRef.current.clear();
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            const isSingleTarget = generationRequestsRef.current.has(nodeId) && generationRequestsRef.current.get(nodeId)?.runningNodeId !== nodeId;
            modal.confirm({
                title: isSingleTarget ? "停止此图片生成？" : "停止生成？",
                content: isSingleTarget ? "只会取消当前图片任务，批次中的其他图片继续生成。" : "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => isSingleTarget ? stopGenerationByTargetId(nodeId) : stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, stopGenerationByTargetId],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(normalizeInterruptedVideoGeneration(resetInterruptedImageGeneration(project.nodes)));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            void resumeCanvasImageTasks<ImageTask, { id: string; dataUrl: string }>(restoredNodes, {
                getAuthIdentity: () => imageTaskAuthIdentity(effectiveConfig.apiKey),
                start: (node) => startGenerationRequest(node.id, node.id, node.id),
                finish: (node, controller) => finishGenerationRequest(node.id, controller),
                resume: (taskId, signal, onTask) => resumeImageTask(taskId, effectiveConfig.apiKey, { signal, onTask }),
                onTask: (node, task) => trackCanvasImageTask(node.id, task),
                onCompleted: async (node, image) => {
                    const uploaded = await uploadGeneratedImage(image.dataUrl);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...imageMetadata(uploaded), imageTaskStatus: "completed", errorDetails: undefined } } : item)));
                },
                onIdentityMismatch: (node) => setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "任务使用其他 API Key 创建，请切换回原 Key 后恢复" } } : item)),
                onError: (node, error) => setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "恢复任务失败" } } : item))),
            });
            void resumeCanvasVideoTasks<VideoGenerationTask, VideoGenerationResult, UploadedFile>(restoredNodes, {
                getAuthIdentity: () => imageTaskAuthIdentity(effectiveConfig.apiKey),
                start: (node) => startGenerationRequest(node.id, node.id, node.id),
                finish: (node, controller) => finishGenerationRequest(node.id, controller),
                resume: (node, signal, onTask) => resumeVideoGenerationTask(buildGenerationConfig(effectiveConfig, node, "video"), {
                    id: node.metadata!.videoTaskId!,
                    modelConfigId: node.metadata!.videoTaskModelConfigId || 0,
                    model: node.metadata!.model || effectiveConfig.videoModel,
                    status: node.metadata!.videoTaskStatus as VideoGenerationTask["status"],
                }, { signal, onTask }),
                onTask: (node, task) => trackCanvasVideoTask(node.id, task),
                store: storeGeneratedVideo,
                onCompleted: (node, video) => setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, ...videoMetadata(video), videoTaskStatus: "completed", errorDetails: undefined } } : item)),
                onIdentityMismatch: (node) => setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "视频任务使用其他 API Key 创建，请切换回原 Key 后恢复" } } : item)),
                onError: (node, error) => setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "视频任务恢复失败" } } : item)),
            });
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [effectiveConfig, finishGenerationRequest, hydrated, navigate, openProject, projectId, startGenerationRequest, trackCanvasImageTask, trackCanvasVideoTask]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl") && !localAgentEnabled && !fragmentBootstrap) openAgentPanel();
    }, [fragmentBootstrap, localAgentEnabled, openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous?.nodes === next.nodes && previous.connections === next.connections && previous.chatSessions === next.chatSessions && previous.activeChatId === next.activeChatId && previous.backgroundMode === next.backgroundMode && previous.showImageInfo === next.showImageInfo) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
        setToolbarNodeId(nodeId);
    }, [nodeImageSettingsOpen]);

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewContent = previewImageId ? previewNode?.metadata?.images?.find((image) => image.id === previewImageId)?.content : previewNode?.metadata?.content;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id)), [nodes, selectedNodeIds]);
    const canGroupSelection = canGroupSelectedNodes(selectedNodeIds, nodes);
    const canUngroupSelection = canUngroupSelectedNodes(selectedNodeIds, nodes);
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const canvasTaskActive = hasActiveCanvasMediaTask(nodes, runningNodeId);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        const addNode = (nodeId: string) => {
            nodeIds.add(nodeId);
            if (nodeById.get(nodeId)?.type === CanvasNodeType.Group) nodes.forEach((node) => node.metadata?.groupId === nodeId && nodeIds.add(node.id));
        };
        addNode(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            addNode(connection.fromNodeId);
            addNode(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections, nodeById, nodes]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const connectedNodesByNodeId = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        connections.forEach((connection) => {
            const source = nodeById.get(connection.fromNodeId);
            if (!source) return;
            const connected = map.get(connection.toNodeId);
            if (connected) connected.push(source);
            else map.set(connection.toNodeId, [source]);
        });
        return map;
    }, [connections, nodeById]);
    const referenceConnectedNodeIds = useMemo(() => new Set([referencePickerNodeId, ...(referencePickerNodeId ? connectedNodesByNodeId.get(referencePickerNodeId)?.flatMap((node) => node.type === CanvasNodeType.Group ? [node.id, ...getGroupResourceNodes(node.id, nodes).map((child) => child.id)] : [node.id]) || [] : [])].filter((id): id is string => Boolean(id))), [connectedNodesByNodeId, nodes, referencePickerNodeId]);
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProject?.title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });
    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinNodeType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setReferencePickerNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedBatchNodeIds((current) => new Set([...current].filter((nodeId) => !allIds.has(nodeId))));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const groupSelection = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
        if (members.length < 2) return;
        const rect = getGroupWrapRect(members);
        const created = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const result = applyGroupSelection(selectedIds, nodesRef.current, connectionsRef.current, { ...created, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds[0] || null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const ungroupSelection = useCallback((ids?: Set<string>) => {
        const result = applyUngroupSelection(ids || selectedNodeIdsRef.current, nodesRef.current, connectionsRef.current);
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds.length === 1 ? result.selectedIds[0] : null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {
        setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== fromNodeId || connection.toNodeId !== toNodeId));
    }, []);

    const startNodeReferenceSelection = useCallback((nodeId: string) => {
        setReferencePickerNodeId(nodeId);
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, []);

    const exitNodeReferenceSelection = useCallback(() => {
        if (!referencePickerNodeId) return;
        setSelectedNodeIds(new Set([referencePickerNodeId]));
        setDialogNodeId(referencePickerNodeId);
        setReferencePickerNodeId(null);
    }, [referencePickerNodeId]);

    const selectNodeReference = useCallback((fromNodeId: string) => {
        if (!referencePickerNodeId || referenceConnectedNodeIds.has(fromNodeId)) return;
        const source = nodesRef.current.find((node) => node.id === fromNodeId);
        if (!source || !isCanvasReferenceNode(source, nodesRef.current)) return;
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId, toNodeId: referencePickerNodeId }]);
    }, [referenceConnectedNodeIds, referencePickerNodeId]);

    useEffect(() => {
        if (!referencePickerNodeId) return;
        const exit = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            exitNodeReferenceSelection();
        };
        window.addEventListener("keydown", exit, true);
        return () => window.removeEventListener("keydown", exit, true);
    }, [exitNodeReferenceSelection, referencePickerNodeId]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`无限画布 ${useCanvasStore.getState().projects.length + 1}`);
        navigate(`/canvas/${id}`);
    }, [createProject, navigate]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error("画布不存在");
        const hide = message.loading("正在导出画布", 0);
        try {
            await exportCanvasProjects([project], project.title || "未命名画布");
            message.success("画布已导出");
        } catch (error) {
            console.error(error);
            message.error("导出画布失败");
        } finally {
            hide();
        }
    }, [message, projectId]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        setToolbarNodeId(nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedIds = new Set(initialPositions.map((item) => item.id));
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                const movedIds = new Set(initialPositions.map((item) => item.id));
                const previewNodes = nodesRef.current.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.find((item) => item.id === node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "g") {
                if (event.shiftKey) {
                    if (canUngroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                        event.preventDefault();
                        ungroupSelection();
                    }
                    return;
                }
                if (canGroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                    event.preventDefault();
                    groupSelection();
                }
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, groupSelection, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas, ungroupSelection]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? { ...node, metadata: { ...node.metadata, content, texts: node.metadata?.texts?.map((text) => (text.id === node.metadata?.primaryTextId ? { ...text, content } : text)) } }
                    : node,
            ),
        );
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedBatchNodeIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, itemId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                if (node.type === CanvasNodeType.Text) {
                    const text = node.metadata?.texts?.find((item) => item.id === itemId);
                    return text?.content ? { ...node, metadata: { ...node.metadata, content: text.content, primaryTextId: text.id } } : node;
                }
                const image = node.metadata?.images?.find((item) => item.id === itemId);
                if (!image?.content) return node;
                const edge = Math.max(node.width, node.height);
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const edge = Math.max(node.width, node.height);
        const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const downloadBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
    }, []);

    const captureVideoNodeFrame = useCallback(
        async (nodeId: string, position: VideoFramePosition) => {
            setContextMenu(null);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const video = Array.from(containerRef.current!.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]")).find((item) => item.dataset.canvasVideo === nodeId);
            if (node?.type !== CanvasNodeType.Video || !node.metadata?.content || !video) return message.error(t("canvas.videoFrames.failed"));
            try {
                const image = await uploadImage(await captureVideoFrame(node.metadata.content, position, video.currentTime));
                const size = fitNodeSize(image.width, image.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const id = nanoid();
                const x = node.position.x + node.width + 96;
                let y = node.position.y + node.height / 2 - size.height / 2;
                while (nodesRef.current.some((item) => item.id !== node.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
                const child: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: t(`canvas.videoFrames.${position}Title`, { name: node.title || t("assets.kinds.video") }),
                    position: { x, y },
                    ...size,
                    metadata: imageMetadata(image),
                };
                setNodes((prev) => [...prev, child]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: id }]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
                message.success(t("canvas.videoFrames.captured"));
            } catch {
                message.error(t("canvas.videoFrames.failed"));
            }
        },
        [message, t],
    );
    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({ kind: "video", title: node.metadata?.prompt?.slice(0, 24) || "画布视频", coverUrl: "", tags: [], source: "Canvas", data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" }, metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt } });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success("已加入我的素材");
        },
        [addAsset, message],
    );

    const createImageReversePromptNodes = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            // 文本模型目录属于当前 Key（同源）；目录还没加载时先补一次，失败会静默回退到节点已选模型。
            const textModels = await ensureMediaModelsLoaded("text");
            // 三级顺序：新建的反推节点还没有用户选择 → gpt-6-astra（仅当在当前 Key 目录中）→ 目录首项。
            const reverseModel = resolveTextModelCandidates("", textModels.map((item) => item.model))[0] || effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel;

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(
                    CanvasNodeType.Text,
                    { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY },
                    { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 },
                ),
                title: "反推提示词",
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: reverseModel,
                        count: 1,
                        composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]`,
                    },
                ),
                title: "反推提示词配置",
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [
                ...prev,
                { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id },
                { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id },
            ]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (payload.generate && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: userPrompt });
            setMaskEditNodeId(null);
            const maskImage = await uploadImage(payload.maskDataUrl);
            const maskNodeId = nanoid();
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const maskSource = { id: maskNodeId, name: "mask.png", type: maskImage.mimeType || "image/png", dataUrl: maskImage.url, storageKey: maskImage.storageKey };
            const references = [source, maskSource];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, references);
            const childMetadata = payload.generate ? { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } : { prompt };
            setNodes((prev) => [
                ...prev,
                {
                    id: maskNodeId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.maskNodeTitle"),
                    position: { x: node.position.x, y: node.position.y + node.height + 96 },
                    width: node.width,
                    height: node.height,
                    metadata: imageMetadata(maskImage),
                },
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: childMetadata,
                },
            ]);
            setConnections((prev) => [
                ...prev,
                { id: nanoid(), fromNodeId: node.id, toNodeId: childId },
                { id: nanoid(), fromNodeId: maskNodeId, toNodeId: childId },
            ]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            if (!payload.generate) return;
            setRunningNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, references, undefined, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(childId, task) }).then((items) => items[0]);
                const uploaded = await uploadGeneratedImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, trackCanvasImageTask],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }], undefined, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(childId, task) }).then(
                    (items) => items[0],
                );
                const uploaded = await uploadGeneratedImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;

            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Audio, title: file.name, position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 }, width: spec.width, height: spec.height, metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = buildPluginBuiltinPrompt(builtinPanel.promptPrefix, scene);
                    const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, fullPrompt));
                    const references = context.referenceImages;
                    const options = { signal: controller.signal, onTask: (task: ImageTask) => trackCanvasImageTask(nodeId, task) };
                    const image = references.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, context.prompt, references, undefined, options).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, context.prompt, options).then((items) => items[0]);
                    const uploaded = await uploadGeneratedImage(image.dataUrl);
                    setNodes((prev) => prev.map((node) => (node.id === nodeId
                        ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, imageTaskId: undefined, imageTaskStatus: undefined, errorDetails: undefined } }
                        : node)));
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : "生成失败";
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                    setRunningNodeId(null);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = [...new Map([...sourceReference, ...generationContext.referenceImages].map((image) => [image.id, image])).values()];
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    let hasSuccess = false;
                    let hasFailure = false;
                    let wasCanceled = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            const controller = startGenerationRequest(targetId, nodeId, nodeId, new AbortController());
                            try {
                                const image = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(targetId, task) }).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(targetId, task) }).then((items) => items[0]);
                                const uploaded = await uploadGeneratedImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded) },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) {
                                    wasCanceled = true;
                                    return false;
                                }
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (wasCanceled && !hasSuccess && !hasFailure) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) => (isEmptyVideoNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode]));
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const result = await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal, onTask: (task) => trackCanvasVideoTask(videoId, task) });
                        const video = previewGeneratedVideo(result);
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 }, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, videoMode: generationConfig.videoMode, references: generationReferenceUrls(generationContext) } } : node)));
                        void storeGeneratedVideo(result).then((persisted) => setNodes((prev) => prev.map((node) => node.id === videoId ? { ...node, metadata: { ...node.metadata, ...videoMetadata(persisted) } } : node))).catch((error) => console.warn("[canvas:video] local persistence failed", { nodeId: videoId, error: error instanceof Error ? error.message : String(error) }));
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) => (isEmptyAudioNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode]));
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = getGenerationCount(String(sourceNode?.metadata?.textCount || 1));
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const isEmptyTextNode = sourceNode?.type === CanvasNodeType.Text && !sourceTextContent;
                const rootId = isEmptyTextNode ? nodeId : nanoid();
                const textIds = Array.from({ length: textCount }, () => nanoid());
                const rootNode: CanvasNodeData = {
                    id: rootId,
                    type: CanvasNodeType.Text,
                    title: effectivePrompt.slice(0, 32) || "Generated Text",
                    position: isEmptyTextNode ? sourceNode.position : { x: parentPosition.x + parentConfig.width + 96, y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 },
                    width: isEmptyTextNode ? sourceNode.width : textConfig.width,
                    height: isEmptyTextNode ? sourceNode.height : textConfig.height,
                    metadata: {
                        prompt: effectivePrompt,
                        status: NODE_STATUS_LOADING,
                        fontSize: 14,
                        model: generationConfig.model,
                        reasoningEffort: generationConfig.reasoningEffort,
                        textCount,
                        texts: textIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "" })),
                        primaryTextId: textIds[0],
                    },
                };
                pendingChildIds = [rootId];
                setNodes((prev) =>
                    isEmptyTextNode
                        ? prev.map((node) => (node.id === nodeId ? { ...node, ...rootNode } : node))
                        : [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), rootNode],
                );
                if (!isEmptyTextNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                setSelectedNodeIds(new Set([nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(nodeId);

                const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                // 文本模式：节点已选模型失败时先按候选顺序静默换模型；当前会话 Key 的候选全部因可切换错误
                // 失败后，再按请求维度（X-Media-Api-Key-Id 请求头）换其他 Key，不弹提示、不改全局会话 Key。
                // 先 await 加载 Key 列表，否则未加载的 store 会让 Key 维度整条失效。
                const textAttempts = await prepareCanvasTextAttempts(generationConfig.model);
                const textMessages = buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt });
                const results = await Promise.all(
                    textIds.map(async (textId): Promise<CanvasNodeText | null> => {
                        let streamed = "";
                        let usedModel = "";
                        try {
                            const answer = await retryTextModelAttempts(textAttempts, async (target) => {
                                const value = await requestImageQuestion(
                                    { ...generationConfig, model: target.model },
                                    textMessages,
                                    (text) => {
                                        streamed = text;
                                        setNodes((prev) =>
                                            prev.map((node) =>
                                                node.id === rootId
                                                    ? {
                                                          ...node,
                                                          metadata: {
                                                              ...node.metadata,
                                                              ...(node.metadata?.primaryTextId === textId ? { content: text } : {}),
                                                              texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content: text } : item)),
                                                          },
                                                      }
                                                    : node,
                                            ),
                                        );
                                    },
                                    { signal: controller.signal, apiKeyId: target.apiKeyId },
                                );
                                usedModel = target.model;
                                return value;
                            });
                            const content = answer || streamed;
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === rootId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  ...(node.metadata?.primaryTextId === textId ? { content } : {}),
                                                  texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content, status: NODE_STATUS_SUCCESS } : item)),
                                              },
                                          }
                                        : node,
                                ),
                            );
                            // 静默回写实际使用的模型，让配置节点状态与实际一致；失败时不回写。
                            const writeback = resolveTextModelWriteback(nodeId, generationConfig.model, usedModel);
                            if (writeback) setNodes((prev) => prev.map((node) => (node.id === writeback.nodeId ? { ...node, metadata: { ...node.metadata, model: writeback.model } } : node)));
                            return { id: textId, status: NODE_STATUS_SUCCESS, content } satisfies CanvasNodeText;
                        } catch (error) {
                            if (isGenerationCanceled(error)) return null;
                            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                            setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, status: NODE_STATUS_ERROR, errorDetails } : item)) } } : node)));
                            return { id: textId, status: NODE_STATUS_ERROR, content: "", errorDetails } satisfies CanvasNodeText;
                        }
                    }),
                );
                if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                if (controller.signal.aborted) return;
                const completedTexts = results.flatMap((item) => (item?.status === NODE_STATUS_SUCCESS ? [item] : []));
                const failedTexts = results.filter((item) => item?.status === NODE_STATUS_ERROR);
                const firstText = completedTexts[0];
                if (completedTexts.length <= 1) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== rootId)));
                if (failedTexts.length) message.error(firstText ? t("canvas.projectPage.partialTextFailed") : failedTexts[0]?.errorDetails || t("canvas.projectPage.generationFailed"));
                setNodes((prev) =>
                    prev.map((node) => {
                        if (node.id === rootId) {
                            const primaryText = completedTexts.find((text) => text.id === node.metadata?.primaryTextId) || firstText;
                            return {
                                ...node,
                                metadata: {
                                    ...node.metadata,
                                    content: primaryText?.content || "",
                                    texts: completedTexts,
                                    primaryTextId: primaryText?.id,
                                    status: primaryText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                    errorDetails: primaryText ? undefined : t("canvas.projectPage.generationFailed"),
                                },
                            };
                        }
                        return node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: firstText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: firstText ? undefined : t("canvas.projectPage.generationFailed") } } : node;
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : {
                                      ...node,
                                      metadata: {
                                          ...node.metadata,
                                          status: NODE_STATUS_ERROR,
                                          errorDetails,
                                          ...(isVideoTaskFailed(error) && node.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                      },
                                  }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t, trackCanvasImageTask, trackCanvasVideoTask],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    let usedModel = "";
                    const messages = buildNodeResponseMessages({ ...context, prompt });
                    // 与文本生成一致：先换模型，再按请求维度换 Key，始终不动全局会话 Key。
                    const textAttempts = await prepareCanvasTextAttempts(generationConfig.model);
                    const answer = await retryTextModelAttempts(textAttempts, async (target) => {
                        const value = await requestImageQuestion({ ...generationConfig, model: target.model }, messages, (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        }, { signal: controller.signal, apiKeyId: target.apiKeyId });
                        usedModel = target.model;
                        return value;
                    });
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    // 静默回写实际使用的模型到驱动本次生成的节点（配置节点），失败时不回写。
                    const writeback = resolveTextModelWriteback(sourceNode.id, generationConfig.model, usedModel);
                    if (writeback) setNodes((prev) => prev.map((item) => (item.id === writeback.nodeId ? { ...item, metadata: { ...item.metadata, model: writeback.model } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const result = await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal, onTask: (task) => trackCanvasVideoTask(node.id, task) });
                    const video = previewGeneratedVideo(result);
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, videoMode: generationConfig.videoMode } } : item)));
                    void storeGeneratedVideo(result).then((persisted) => setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, ...videoMetadata(persisted) } } : item))).catch((error) => console.warn("[canvas:video] local persistence failed", { nodeId: node.id, error: error instanceof Error ? error.message : String(error) }));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(node.id, task) }).then((items) => items[0]) : await requestGeneration(generationConfig, prompt, { signal: controller.signal, onTask: (task) => trackCanvasImageTask(node.id, task) }).then((items) => items[0]);
                const uploadedImage = await uploadGeneratedImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),
                                      ...(isVideoTaskFailed(error) && item.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t, trackCanvasImageTask, trackCanvasVideoTask],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== nodeId)));
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                return { ...item, metadata: { ...item.metadata, images, count: images.length, primaryImageId: item.metadata?.primaryImageId === imageId ? images[0]?.id : item.metadata?.primaryImageId } };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);
    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [...prev, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const focusNode = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node) return;
        const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1);
        setViewport({ x: size.width / 2 - (node.position.x + node.width / 2) * k, y: size.height / 2 - (node.position.y + node.height / 2) * k, k });
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setContextMenu(null);
    }, [size.height, size.width]);

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, imageId?: string) => {
        setPreviewNodeId(node.id);
        setPreviewImageId(imageId || null);
    }, []);
    const handleNodeRetry = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text && (node.metadata?.textCount || 1) > 1) {
                void generateNodeRef.current?.(node.id, "text", node.metadata?.prompt || "");
                return;
            }
            void handleRetryNode(node);
        },
        [handleRetryNode],
    );
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNodeIds((current) => (current.has(nodeId) ? current : new Set([nodeId])));
        setSelectedConnectionId(null);
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    nodeId={panelNode.id}
                    nodes={nodes}
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                    onDisconnectReference={disconnectNodeReference}
                    onStartReferenceSelection={startNodeReferenceSelection}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    nodes={nodes}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    onDisconnectReference={disconnectNodeReference}
                    onStartReferenceSelection={startNodeReferenceSelection}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [configInputsById, confirmStopGeneration, connectedNodesByNodeId, disconnectNodeReference, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, nodes, renderPluginPanel, runningNodeId, startNodeReferenceSelection],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
            />
        ),
        [configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, runningNodeId],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onInsertAsset={handleAssetInsert} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={() => void exportCurrentProject()}
                    onImportImage={() => handleUploadRequest()}
                    onOpenPlugins={() => setPluginManagerOpen(true)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={(event) => {
                        if (!referencePickerNodeId) handleCanvasMouseDown(event);
                    }}
                    onCanvasDeselect={referencePickerNodeId ? undefined : deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        if (referencePickerNodeId) return;
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            referenceSelectionState={!referencePickerNodeId ? undefined : node.id === referencePickerNodeId ? "target" : referenceConnectedNodeIds.has(node.id) || !isCanvasReferenceNode(node, nodes) ? "disabled" : "available"}
                            showPanel={!isNodeResizing && dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={expandedBatchNodeIds.has(node.id) || Boolean(node.metadata?.imageBatchExpanded)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            renderNodeContent={renderNodeContentPanel}
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                            }}
                            onConnectStart={handleConnectStart}
                            onResizeStart={handleNodeResizeStart}
                            onResize={handleNodeResize}
                            onResizeEnd={handleNodeResizeEnd}
                            onContentChange={handleNodeContentChange}
                            onTitleChange={handleNodeTitleChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onDuplicateBatchImage={duplicateBatchImage}
                            onDownloadBatchImage={downloadBatchImage}
                            onRetryBatchImage={retryBatchImage}
                            onDeleteBatchImage={deleteBatchImage}
                            onRetry={handleNodeRetry}
                            onViewImage={handleNodeViewImage}
                            onSelectReference={selectNodeReference}
                            onContextMenu={handleNodeContextMenu}
                        />
                    ))}

                    {referencePickerNodeId ? <button type="button" className="absolute left-1/2 top-4 z-[90] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} onClick={exitNodeReferenceSelection}>{t("canvas.references.selectingHint")}</button> : null}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? <NodeCreateMenu position={nodeCreatePosition} onCreate={(type) => { createNode(type, nodeCreatePosition); setNodeCreatePosition(null); }} onClose={() => setNodeCreatePosition(null)} /> : null}
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || isNodeResizing || nodeImageSettingsOpen || expandedBatchNodeIds.has(toolbarNode?.id || "") ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={handleNodeViewImage}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                    onUngroup={(node) => ungroupSelection(new Set([node.id]))}
                />

                {hasMultipleSelectedNodes && !selectionBox ? (
                    <CanvasSelectionToolbar
                        nodes={selectedNodes}
                        viewport={viewport}
                        showToolbar={!isNodeDragging && !isNodeResizing}
                        canGroup={canGroupSelection}
                        canUngroup={canUngroupSelection}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                    />
                ) : null}

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canvasTool={canvasTool}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onCanvasToolChange={setCanvasTool}
                    onAddExtensionNode={(type) => createNode(type)}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canCaptureVideoFrame={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content)}
                        canGroup={contextMenu.type === "node" && canGroupSelection}
                        canUngroup={contextMenu.type === "node" && canUngroupSelection}
                        onClose={() => setContextMenu(null)}
                        onCaptureVideoFrame={(position) => {
                            if (contextMenu.type !== "node") return;
                            void captureVideoNodeFrame(contextMenu.nodeId, position);
                        }}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} /> : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} /> : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title={t("canvas.projectPage.imageDetails")}
                    open={Boolean(previewContent)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewContent ? <img src={previewContent} alt={previewNode?.title || t("assets.kinds.image")} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}

export function hasActiveCanvasMediaTask(nodes: CanvasNodeData[], runningNodeId: string | null) {
    if (runningNodeId) return true;
    return nodes.some((node) => {
        const hasStoredContent = Boolean(node.metadata?.content || node.metadata?.storageKey);
        const imageStatus = node.metadata?.imageTaskStatus;
        const videoStatus = node.metadata?.videoTaskStatus;
        return imageStatus === "queued" || imageStatus === "running" || (imageStatus === "completed" && !hasStoredContent)
            || videoStatus === "queued" || videoStatus === "running" || (videoStatus === "completed" && !hasStoredContent);
    });
}

export function buildPluginBuiltinPrompt(prefix: string | undefined, prompt: string) {
    return `${prefix || ""}${prompt}`;
}

function LegacyCanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="canvas-top-bar pointer-events-none absolute left-0 right-0 top-0 z-50 flex min-h-16 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 py-2 md:h-16 md:flex-nowrap md:px-4 md:py-0">
                <div className="canvas-top-bar-primary pointer-events-auto flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-1 md:gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "文档", onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="canvas-top-bar-title flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-full min-w-0 max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="block w-full min-w-0 max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} />
                </div>

                <div className="canvas-top-bar-actions pointer-events-auto ml-auto flex shrink-0 items-center gap-1.5">
                    <UserStatusActions
                        variant="canvas"
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                    />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "Codex 已连接" : status.enabled ? `Codex ${status.activity || "连接中"}` : "Codex 未连接";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button
            type="button"
            className="flex h-8 shrink-0 items-center gap-1.5 text-xs transition hover:opacity-75"
            style={{ color: status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.muted }}
            onClick={onClick}
            title="打开本地 Codex 面板"
        >
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    return (
        [...nodes]
            .reverse()
            .find((group) => {
                if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
                return movingNodes.some((node) => {
                    const centerX = node.position.x + node.width / 2;
                    const centerY = node.position.y + node.height / 2;
                    return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
                });
            }) || null
    );
}

function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return (
        [...nodes]
            .reverse()
            .find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id || undefined
    );
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    return {
        ...config,
        model: node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

/**
 * 文本模式的尝试序列：先集中试当前会话 Key 配模型候选，再按请求维度换其他 Key。
 *
 * 模型候选：节点已选模型 → gpt-6-astra（仅当在当前 Key 的文本目录中）→ 目录首项 → 其余项。
 * Key 维度：只读 store 快照构造请求头，绝不调用 select/activate 切换全局会话 Key——
 * 会话 Key 是全局的，用户在图片节点选过的 Key 会被文本请求继承，切换会把图片/视频一起切走。
 * 文本目录里的 `textModelCount` 计数不可得时为 0，因此只按计数排序、不做计数前置过滤
 * （见 mediaAPIKeyCapabilityCount 的哨兵说明）。
 */
export function buildCanvasTextAttempts(selectedModel: string): TextModelAttempt[] {
    const textModels = useConfigStore.getState().mediaModels?.text ?? [];
    const candidates = resolveTextModelCandidates(selectedModel, textModels.map((item) => item.model));
    // 手填 API Key 时不换 Key：此时请求带的是用户自己的 Bearer，再附上 X-Media-Api-Key-Id
    // 会被后端按该 Key 转发，等于覆盖用户的选择。
    if (hasManualMediaAPIKey()) return buildTextModelAttempts(candidates);
    const keyState = useMediaAPIKeyStore.getState();
    return buildTextModelAttempts(candidates, keyState.keys, keyState.currentKeyId);
}

/**
 * 文本重试前的准备：先确保 Key 列表已加载（只加载、不切换会话），再构造尝试序列。
 * 必须在构造序列前 await，否则 store 未加载时 `keys` 为空、Key 维度整条静默失效——
 * 一个只有文本节点、没碰过图片/视频的画布正是这种状态。
 */
export async function prepareCanvasTextAttempts(selectedModel: string): Promise<TextModelAttempt[]> {
    // 手填 API Key 时不需要 Key 列表（buildCanvasTextAttempts 会早返回），跳过这次加载。
    if (!hasManualMediaAPIKey()) await ensureMediaAPIKeysLoaded();
    return buildCanvasTextAttempts(selectedModel);
}

/** 是否手填了 API Key：判断口径与 MediaAPIKeyPicker、ensureMediaModelsLoaded 一致。 */
function hasManualMediaAPIKey() {
    const config = useConfigStore.getState().config;
    return Boolean(config.apiKey.trim() || config.channels.some((channel) => channel.apiKey.trim()));
}

/**
 * 文本生成成功后要静默回写的模型：失败（usedModel 为空）或与节点记录一致时返回 null。
 * 只用于让节点状态与实际一致，不产生任何提示。
 */
export function resolveTextModelWriteback(nodeId: string, recordedModel: string | undefined, usedModel: string | undefined): { nodeId: string; model: string } | null {
    const model = (usedModel || "").trim();
    if (!nodeId || !model || model === (recordedModel || "").trim()) return null;
    return { nodeId, model };
}

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
