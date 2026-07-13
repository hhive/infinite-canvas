import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type VideoTaskStatus = NonNullable<CanvasNodeData["metadata"]>["videoTaskStatus"];

export function hasStoredVideoContent(node: CanvasNodeData) {
    return Boolean(node.metadata?.content || node.metadata?.storageKey);
}

export function isRecoverableVideoTaskStatus(status: VideoTaskStatus, taskId?: string, hasContent = false) {
    if (!taskId || hasContent) return false;
    return status === "queued" || status === "running" || status === "completed";
}

export function normalizeInterruptedVideoGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.Video || node.metadata?.status !== "loading") return node;
        if (hasStoredVideoContent(node)) return { ...node, metadata: { ...node.metadata, status: "success" as const, errorDetails: undefined } };
        if (isRecoverableVideoTaskStatus(node.metadata.videoTaskStatus, node.metadata.videoTaskId)) return node;
        const errorDetails = node.metadata.videoTaskStatus === "failed" || node.metadata.videoTaskStatus === "canceled" || node.metadata.videoTaskStatus === "cancelled" || node.metadata.videoTaskStatus === "expired"
            ? "视频任务已结束但成片未保存，请重新生成。"
            : "页面刷新后视频生成已中断，请重新生成。";
        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails } };
    });
}

export async function resumeCanvasVideoTasks<TTask, TResult, TStored>(nodes: CanvasNodeData[], dependencies: {
    getAuthIdentity: () => Promise<string>;
    start: (node: CanvasNodeData) => AbortController;
    finish: (node: CanvasNodeData, controller: AbortController) => void;
    resume: (node: CanvasNodeData, signal: AbortSignal, onTask: (task: TTask) => void | Promise<void>) => Promise<TResult>;
    onTask: (node: CanvasNodeData, task: TTask) => void | Promise<void>;
    store: (result: TResult) => Promise<TStored>;
    onCompleted: (node: CanvasNodeData, stored: TStored) => void | Promise<void>;
    onIdentityMismatch: (node: CanvasNodeData) => void;
    onError: (node: CanvasNodeData, error: unknown) => void;
}) {
    const recoverable = nodes.filter((node) => node.type === CanvasNodeType.Video && isRecoverableVideoTaskStatus(node.metadata?.videoTaskStatus, node.metadata?.videoTaskId, hasStoredVideoContent(node)));
    const authIdentity = await dependencies.getAuthIdentity();
    await Promise.all(recoverable.map(async (node) => {
        if (node.metadata?.videoTaskAuthIdentity && node.metadata.videoTaskAuthIdentity !== authIdentity) {
            dependencies.onIdentityMismatch(node);
            return;
        }
        const controller = dependencies.start(node);
        try {
            const result = await dependencies.resume(node, controller.signal, (task) => dependencies.onTask(node, task));
            const stored = await dependencies.store(result);
            await dependencies.onCompleted(node, stored);
        } catch (error) {
            if (!controller.signal.aborted) dependencies.onError(node, error);
        } finally {
            dependencies.finish(node, controller);
        }
    }));
}
