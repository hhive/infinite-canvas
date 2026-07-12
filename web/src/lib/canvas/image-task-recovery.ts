import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export function isRecoverableImageTaskStatus(status?: CanvasNodeMetadata["imageTaskStatus"], taskId?: string) {
    return Boolean(taskId) && (status === "queued" || status === "running" || status === "completed");
}

export function canCancelImageTaskStatus(status?: CanvasNodeMetadata["imageTaskStatus"]) {
    return status === "queued" || status === "running";
}

export function applyImageTaskTerminalStatus(metadata: CanvasNodeMetadata, status: NonNullable<CanvasNodeMetadata["imageTaskStatus"]>, errorMessage?: string): CanvasNodeMetadata {
    if (status === "canceled") return { ...metadata, status: "error", imageTaskStatus: status, errorDetails: "图片任务已取消" };
    if (status === "expired") return { ...metadata, status: "error", imageTaskStatus: status, errorDetails: "图片任务已过期" };
    if (status === "failed") return { ...metadata, status: "error", imageTaskStatus: status, errorDetails: errorMessage || "图片任务失败" };
    return { ...metadata, imageTaskStatus: status };
}

export function resetInterruptedImageGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading" && !isRecoverableImageTaskStatus(node.metadata.imageTaskStatus, node.metadata.imageTaskId)
            ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } }
            : node,
    );
}

export function cancelImageTaskRequest<T extends { controller: AbortController; taskId?: string }>(requests: Map<string, T>, targetNodeId: string) {
    const request = requests.get(targetNodeId);
    if (!request) return undefined;
    request.controller.abort();
    requests.delete(targetNodeId);
    return request.taskId;
}

export async function cancelImageTaskBatch<T extends { runningNodeId: string }>(requests: Map<string, T>, runningNodeId: string, cancelTarget: (targetNodeId: string) => Promise<void>) {
    const targetIds = [...requests.entries()].filter(([, request]) => request.runningNodeId === runningNodeId).map(([targetNodeId]) => targetNodeId);
    await Promise.all(targetIds.map(cancelTarget));
    return targetIds;
}

export async function resumeCanvasImageTasks<TTask, TResult>(nodes: CanvasNodeData[], dependencies: {
    getAuthIdentity: () => Promise<string>;
    start: (node: CanvasNodeData) => AbortController;
    finish: (node: CanvasNodeData, controller: AbortController) => void;
    resume: (taskId: string, signal: AbortSignal, onTask: (task: TTask) => void | Promise<void>) => Promise<TResult[]>;
    onTask: (node: CanvasNodeData, task: TTask) => void | Promise<void>;
    onCompleted: (node: CanvasNodeData, item: TResult) => void | Promise<void>;
    onIdentityMismatch: (node: CanvasNodeData) => void;
    onError: (node: CanvasNodeData, error: unknown) => void;
}) {
    const recoverable = nodes.filter((node) => isRecoverableImageTaskStatus(node.metadata?.imageTaskStatus, node.metadata?.imageTaskId));
    await Promise.all(recoverable.map(async (node) => {
        const taskId = node.metadata?.imageTaskId as string;
        const controller = dependencies.start(node);
        try {
            const authIdentity = await dependencies.getAuthIdentity();
            if (!node.metadata?.imageTaskAuthIdentity || node.metadata.imageTaskAuthIdentity !== authIdentity) {
                dependencies.onIdentityMismatch(node);
                return;
            }
            const items = await dependencies.resume(taskId, controller.signal, (task) => dependencies.onTask(node, task));
            if (!items[0]) throw new Error("接口没有返回图片");
            await dependencies.onCompleted(node, items[0]);
        } catch (error) {
            if (!controller.signal.aborted) dependencies.onError(node, error);
        } finally {
            dependencies.finish(node, controller);
        }
    }));
}
