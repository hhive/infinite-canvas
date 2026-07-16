import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { LOCAL_TASK_DETACH_MESSAGE } from "@/lib/task-detach";

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

export function applyLocalTaskDetach(metadata: CanvasNodeMetadata): CanvasNodeMetadata {
    return { ...metadata, status: "error", errorDetails: LOCAL_TASK_DETACH_MESSAGE };
}

export function resetInterruptedImageGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading" && !isRecoverableImageTaskStatus(node.metadata.imageTaskStatus, node.metadata.imageTaskId)
            ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } }
            : node,
    );
}

export async function resumeCanvasImageTasks<TTask, TResult>(nodes: CanvasNodeData[], dependencies: {
    getAuthIdentity: () => Promise<string>;
    start: (node: CanvasNodeData) => AbortController;
    finish: (node: CanvasNodeData, controller: AbortController) => void;
    resume: (taskId: string, signal: AbortSignal, onTask: (task: TTask) => void | Promise<void>) => Promise<TResult[]>;
    onTask: (node: CanvasNodeData, task: TTask, controller: AbortController) => void | Promise<void>;
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
            const items = await dependencies.resume(taskId, controller.signal, (task) => dependencies.onTask(node, task, controller));
            if (!items[0]) throw new Error("接口没有返回图片");
            await dependencies.onCompleted(node, items[0]);
        } catch (error) {
            if (!controller.signal.aborted) dependencies.onError(node, error);
        } finally {
            dependencies.finish(node, controller);
        }
    }));
}
