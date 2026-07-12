import localforage from "localforage";

import type { ImageTaskStatus } from "@/services/api/image";

export type ImageTaskCancelResolution =
    | { action: "stop"; status: "canceled"; message: string }
    | { action: "recover"; status: "completed" }
    | { action: "terminal"; status: "failed" | "expired"; message: string };

export function resolveImageTaskCancel(task: { status: ImageTaskStatus; error_message?: string }): ImageTaskCancelResolution {
    if (task.status === "canceled") return { action: "stop", status: "canceled", message: "图片任务已取消" };
    if (task.status === "completed") return { action: "recover", status: "completed" };
    if (task.status === "failed") return { action: "terminal", status: "failed", message: task.error_message || "图片任务失败" };
    if (task.status === "expired") return { action: "terminal", status: "expired", message: "图片任务已过期" };
    throw new Error(`取消返回了非终态：${task.status}`);
}

export type ImageWorkbenchTaskRecord = {
    slotId: string;
    taskId: string;
    status: ImageTaskStatus;
    authIdentity: string;
    modelConfigId: number;
    request: {
        prompt: string;
        model: string;
        size: string;
        quality: string;
        hasReferences: boolean;
    };
    resultSlot: number;
    createdAt: number;
    landingStage: "result_pending" | "assets_saved" | "log_saved";
    logId: string;
    savedImage?: { id: string; url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string };
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_running_tasks" });

export async function saveImageWorkbenchTask(record: ImageWorkbenchTaskRecord) {
    await store.setItem(record.slotId, record);
}

export async function removeImageWorkbenchTask(slotId: string) {
    await store.removeItem(slotId);
}

export async function readImageWorkbenchTasks() {
    const records: ImageWorkbenchTaskRecord[] = [];
    await store.iterate<ImageWorkbenchTaskRecord, void>((record) => records.push(record));
    return records.sort((a, b) => a.resultSlot - b.resultSlot);
}

export async function imageTaskAuthIdentity(apiKey: string) {
    const normalized = apiKey.trim();
    if (!normalized) return "cookie-session";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    return `bearer-${Array.from(new Uint8Array(digest).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function canResumeImageTask(record: ImageWorkbenchTaskRecord, authIdentity: string) {
    return matchesImageTaskAuthIdentity(record.authIdentity, authIdentity);
}

export function matchesImageTaskAuthIdentity(savedIdentity: string | undefined, currentIdentity: string) {
    return Boolean(savedIdentity) && savedIdentity === currentIdentity;
}

export function imageTaskLandingAction(record: ImageWorkbenchTaskRecord) {
    if (record.landingStage === "result_pending") return "save_assets" as const;
    if (record.landingStage === "assets_saved") return "save_log" as const;
    return "cleanup" as const;
}

export async function resumeImageWorkbenchRecord<TImage>(record: ImageWorkbenchTaskRecord, dependencies: {
    resumeTask: (taskId: string, onTask: (task: { task_id: string; status: ImageTaskStatus; model_config_id: number }) => void | Promise<void>) => Promise<TImage[]>;
    saveAsset: (image: TImage) => Promise<NonNullable<ImageWorkbenchTaskRecord["savedImage"]>>;
    saveRecord: (record: ImageWorkbenchTaskRecord) => Promise<unknown>;
    saveLog: (record: ImageWorkbenchTaskRecord, image: NonNullable<ImageWorkbenchTaskRecord["savedImage"]>) => Promise<unknown>;
    removeRecord: (slotId: string) => Promise<unknown>;
}) {
    let current = record;
    if (imageTaskLandingAction(current) === "save_assets") {
        const items = await dependencies.resumeTask(record.taskId, async (task) => {
            current = { ...current, taskId: task.task_id, status: task.status, modelConfigId: task.model_config_id };
            await dependencies.saveRecord(current);
        });
        if (!items[0]) throw new Error("接口没有返回图片");
        const savedImage = await dependencies.saveAsset(items[0]);
        current = { ...current, status: "completed", landingStage: "assets_saved", savedImage };
        await dependencies.saveRecord(current);
    }
    if (!current.savedImage) throw new Error("任务缺少已保存图片信息");
    if (imageTaskLandingAction(current) === "save_log") {
        await dependencies.saveLog(current, current.savedImage);
        current = { ...current, status: "completed", landingStage: "log_saved" };
        await dependencies.saveRecord(current);
    }
    await dependencies.removeRecord(record.slotId);
    if (!current.savedImage) throw new Error("任务缺少已保存图片信息");
    return current.savedImage;
}
