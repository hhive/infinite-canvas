import { describe, expect, it } from "vitest";

import { applyImageTaskTerminalStatus, canCancelImageTaskStatus, cancelImageTaskBatch, cancelImageTaskRequest, isRecoverableImageTaskStatus, resetInterruptedImageGeneration, resumeCanvasImageTasks } from "@/lib/canvas/image-task-recovery";
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

    it("cancels one production request without touching its batch sibling", () => {
        const first = new AbortController();
        const second = new AbortController();
        const requests = new Map([
            ["child-1", { controller: first, taskId: "task-1" }],
            ["child-2", { controller: second, taskId: "task-2" }],
        ]);
        expect(cancelImageTaskRequest(requests, "child-1")).toBe("task-1");
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(false);
        expect(requests.has("child-1")).toBe(false);
        expect(requests.has("child-2")).toBe(true);
    });

    it("stops a batch by canceling every child through the production coordinator", async () => {
        const requests = new Map([
            ["child-1", { runningNodeId: "root-1" }],
            ["child-2", { runningNodeId: "root-1" }],
            ["other", { runningNodeId: "root-2" }],
        ]);
        const canceled: string[] = [];
        await expect(cancelImageTaskBatch(requests, "root-1", async (id) => { canceled.push(id); })).resolves.toEqual(["child-1", "child-2"]);
        expect(canceled).toEqual(["child-1", "child-2"]);
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
});
