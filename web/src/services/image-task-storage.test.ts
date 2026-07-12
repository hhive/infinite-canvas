import { describe, expect, it } from "vitest";

import { canResumeImageTask, imageTaskAuthIdentity, imageTaskLandingAction, matchesImageTaskAuthIdentity, resolveImageTaskCancel, resumeImageWorkbenchRecord, type ImageWorkbenchTaskRecord } from "@/services/image-task-storage";
import { vi } from "vitest";

const record: ImageWorkbenchTaskRecord = {
    slotId: "slot-1",
    taskId: "task-1",
    status: "running",
    authIdentity: "cookie-session",
    modelConfigId: 1,
    request: { prompt: "test", model: "gpt-image-2", size: "1:1", quality: "high", hasReferences: false },
    resultSlot: 0,
    createdAt: 1,
    landingStage: "result_pending",
    logId: "image-task-task-1",
};

describe("image task auth identity", () => {
    it("uses a stable cookie identity without credentials", async () => {
        await expect(imageTaskAuthIdentity("  ")).resolves.toBe("cookie-session");
    });

    it("stores a stable irreversible bearer fingerprint", async () => {
        const first = await imageTaskAuthIdentity("  sk-secret-value ");
        const second = await imageTaskAuthIdentity("sk-secret-value");
        expect(first).toBe(second);
        expect(first).toMatch(/^bearer-[0-9a-f]{24}$/);
        expect(first).not.toContain("sk-secret-value");
    });

    it("rejects recovery with a different identity", () => {
        expect(canResumeImageTask(record, "cookie-session")).toBe(true);
        expect(canResumeImageTask(record, "bearer-other")).toBe(false);
        expect(matchesImageTaskAuthIdentity("bearer-original", "bearer-other")).toBe(false);
        expect(matchesImageTaskAuthIdentity(undefined, "cookie-session")).toBe(false);
    });
});

describe("image task landing stages", () => {
    it("resumes only the unfinished local landing step", () => {
        expect(imageTaskLandingAction(record)).toBe("save_assets");
        expect(imageTaskLandingAction({ ...record, landingStage: "assets_saved" })).toBe("save_log");
        expect(imageTaskLandingAction({ ...record, landingStage: "log_saved" })).toBe("cleanup");
    });
});

describe("image task cancel decisions", () => {
    it("stops local polling only after authoritative cancellation", () => {
        expect(resolveImageTaskCancel({ status: "canceled" })).toEqual({ action: "stop", status: "canceled", message: "图片任务已取消" });
    });

    it("continues recovery when cancellation loses to completion", () => {
        expect(resolveImageTaskCancel({ status: "completed" })).toEqual({ action: "recover", status: "completed" });
    });

    it("preserves failed and expired terminal messages", () => {
        expect(resolveImageTaskCancel({ status: "failed", error_message: "模型不可用" })).toEqual({ action: "terminal", status: "failed", message: "模型不可用" });
        expect(resolveImageTaskCancel({ status: "expired" })).toEqual({ action: "terminal", status: "expired", message: "图片任务已过期" });
    });
});

describe("production workbench recovery", () => {
    const savedImage = { id: "image-1", url: "/image-1.png", storageKey: "image-1", width: 10, height: 10, bytes: 100, mimeType: "image/png" };

    function dependencies() {
        return {
            resumeTask: vi.fn(async (taskId: string, onTask: (task: { task_id: string; status: "completed"; model_config_id: number }) => void | Promise<void>) => {
                await onTask({ task_id: taskId, status: "completed", model_config_id: 1 });
                return [{ id: "raw-image" }];
            }),
            saveAsset: vi.fn(async () => savedImage),
            saveRecord: vi.fn(async () => undefined),
            saveLog: vi.fn(async () => undefined),
            removeRecord: vi.fn(async () => undefined),
        };
    }

    it("resumes the original task and completes every landing stage once", async () => {
        const deps = dependencies();
        await expect(resumeImageWorkbenchRecord(record, deps)).resolves.toEqual(savedImage);
        expect(deps.resumeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
        expect(deps.resumeTask).toHaveBeenCalledOnce();
        expect(deps.saveAsset).toHaveBeenCalledOnce();
        expect(deps.saveLog).toHaveBeenCalledOnce();
        expect(deps.removeRecord).toHaveBeenCalledWith("slot-1");
    });

    it("does not re-poll or re-upload after assets were saved", async () => {
        const deps = dependencies();
        await resumeImageWorkbenchRecord({ ...record, status: "completed", landingStage: "assets_saved", savedImage }, deps);
        expect(deps.resumeTask).not.toHaveBeenCalled();
        expect(deps.saveAsset).not.toHaveBeenCalled();
        expect(deps.saveLog).toHaveBeenCalledOnce();
    });

    it("only cleans up after the log was saved", async () => {
        const deps = dependencies();
        await resumeImageWorkbenchRecord({ ...record, status: "completed", landingStage: "log_saved", savedImage }, deps);
        expect(deps.resumeTask).not.toHaveBeenCalled();
        expect(deps.saveAsset).not.toHaveBeenCalled();
        expect(deps.saveLog).not.toHaveBeenCalled();
        expect(deps.removeRecord).toHaveBeenCalledOnce();
    });
});
