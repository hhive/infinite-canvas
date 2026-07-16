import { describe, expect, it } from "vitest";

import { applyImageTaskTerminalStatus, applyLocalTaskDetach, canCancelImageTaskStatus, isRecoverableImageTaskStatus, resetInterruptedImageGeneration, resumeCanvasImageTasks } from "@/lib/canvas/image-task-recovery";
import { vi } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(status: "queued" | "running" | "completed" | undefined, taskId = "task-1"): CanvasNodeData {
    return { id: "node-1", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "loading", imageTaskId: taskId, imageTaskStatus: status } };
}

describe("canvas image task recovery", () => {
    it.each(["queued", "running", "completed"] as const)("keeps %s tasks recoverable", (status) => {
        expect(isRecoverableImageTaskStatus(status, "task-1")).toBe(true);
        expect(resetInterruptedImageGeneration([node(status)])[0].metadata?.status).toBe("loading");
    });

    it("marks legacy loading nodes without a task id as interrupted", () => {
        expect(resetInterruptedImageGeneration([node(undefined, "")])[0].metadata).toMatchObject({ status: "error", errorDetails: expect.stringContaining("已中断") });
    });

    it("never offers cancellation for completed or terminal nodes", () => {
        expect(canCancelImageTaskStatus("queued")).toBe(true);
        expect(canCancelImageTaskStatus("running")).toBe(true);
        expect(canCancelImageTaskStatus("completed")).toBe(false);
        expect(canCancelImageTaskStatus("failed")).toBe(false);
        expect(canCancelImageTaskStatus("canceled")).toBe(false);
    });

    it.each([
        ["canceled", "图片任务已取消"],
        ["expired", "图片任务已过期"],
        ["failed", "图片任务失败"],
    ] as const)("keeps the %s terminal state explicit across refresh", (status, message) => {
        const metadata = applyImageTaskTerminalStatus({ status: "loading" }, status);
        expect(metadata).toMatchObject({ status: "error", imageTaskStatus: status, errorDetails: message });
        expect(resetInterruptedImageGeneration([{ ...node(undefined), metadata }])[0].metadata).toEqual(metadata);
    });

    it("preserves the server task identity and running status after local detachment", () => {
        const metadata = applyLocalTaskDetach({
            status: "loading",
            imageTaskId: "task-1",
            imageTaskStatus: "running",
            imageTaskAuthIdentity: "cookie-session",
        });
        expect(metadata).toMatchObject({
            status: "error",
            imageTaskId: "task-1",
            imageTaskStatus: "running",
            imageTaskAuthIdentity: "cookie-session",
            errorDetails: expect.stringContaining("任务仍在后台运行"),
        });
        expect(isRecoverableImageTaskStatus(metadata.imageTaskStatus, metadata.imageTaskId)).toBe(true);
    });

    it("restores generation, reference/mask edit, and batch children with original task IDs", async () => {
        const nodes: CanvasNodeData[] = [
            { ...node("queued", "task-text"), id: "text", metadata: { ...node("queued").metadata, imageTaskId: "task-text", imageTaskAuthIdentity: "cookie-session", generationType: "generation" } },
            { ...node("running", "task-edit"), id: "edit", metadata: { ...node("running").metadata, imageTaskId: "task-edit", imageTaskAuthIdentity: "cookie-session", generationType: "edit", references: ["ref-1"], primaryImageId: "mask-target" } },
            { ...node("running", "task-batch"), id: "batch-child", metadata: { ...node("running").metadata, imageTaskId: "task-batch", imageTaskAuthIdentity: "cookie-session", batchRootId: "batch-root", batchUsesReferenceImages: true } },
        ];
        const resume = vi.fn(async (taskId: string) => [{ taskId }]);
        const completed = vi.fn();
        const finished = vi.fn();

        await resumeCanvasImageTasks(nodes, {
            getAuthIdentity: async () => "cookie-session",
            start: () => new AbortController(),
            finish: finished,
            resume,
            onTask: vi.fn(),
            onCompleted: completed,
            onIdentityMismatch: vi.fn(),
            onError: vi.fn(),
        });

        expect(resume.mock.calls.map(([taskId]) => taskId)).toEqual(["task-text", "task-edit", "task-batch"]);
        expect(completed).toHaveBeenCalledTimes(3);
        expect(finished).toHaveBeenCalledTimes(3);
    });

    it("passes the active controller to task callbacks", async () => {
        const controller = new AbortController();
        const onTask = vi.fn();

        await resumeCanvasImageTasks([{ ...node("running"), metadata: { ...node("running").metadata, imageTaskAuthIdentity: "cookie-session" } }], {
            getAuthIdentity: async () => "cookie-session",
            start: () => controller,
            finish: vi.fn(),
            resume: async (_taskId, _signal, callback) => {
                await callback({ status: "running" });
                return [{ id: "image-1" }];
            },
            onTask,
            onCompleted: vi.fn(),
            onIdentityMismatch: vi.fn(),
            onError: vi.fn(),
        });

        expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ id: "node-1" }), { status: "running" }, controller);
    });
});
