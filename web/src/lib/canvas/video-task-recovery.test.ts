import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { hasStoredVideoContent, isRecoverableVideoTaskStatus, normalizeInterruptedVideoGeneration, resumeCanvasVideoTasks } from "@/lib/canvas/video-task-recovery";

type VideoTaskStatus = NonNullable<CanvasNodeData["metadata"]>["videoTaskStatus"];

function node(status: VideoTaskStatus, taskId?: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: "video-1", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { status: "loading", videoTaskStatus: status, videoTaskId: taskId, ...metadata } };
}

describe("video task recovery", () => {
    it("recovers queued, running, and completed tasks without local content", () => {
        expect(isRecoverableVideoTaskStatus("queued", "task-1")).toBe(true);
        expect(isRecoverableVideoTaskStatus("running", "task-1")).toBe(true);
        expect(isRecoverableVideoTaskStatus("completed", "task-1")).toBe(true);
    });

    it("does not recover completed tasks that already have local content", () => {
        expect(isRecoverableVideoTaskStatus("completed", "task-1", true)).toBe(false);
        expect(hasStoredVideoContent(node("completed", "task-1", { content: "blob:video" }))).toBe(true);
    });

    it("normalizes stored content and interrupted terminal nodes", () => {
        expect(normalizeInterruptedVideoGeneration([node("completed", "task-1", { content: "blob:video" })])[0].metadata?.status).toBe("success");
        expect(normalizeInterruptedVideoGeneration([node("failed", "task-1")])[0].metadata).toMatchObject({ status: "error", errorDetails: expect.stringContaining("已结束") });
        expect(normalizeInterruptedVideoGeneration([node(undefined)])[0].metadata).toMatchObject({ status: "error", errorDetails: expect.stringContaining("已中断") });
    });

    it("resumes completed tasks through local storage", async () => {
        const completed: string[] = [];
        await resumeCanvasVideoTasks([node("completed", "task-1", { videoTaskAuthIdentity: "same" })], {
            getAuthIdentity: async () => "same",
            start: () => new AbortController(),
            finish: () => undefined,
            resume: async (_node, _signal, onTask) => {
                await onTask({ status: "completed" });
                return { url: "/v1/videos/task-1/content" };
            },
            onTask: () => undefined,
            store: async () => ({ storageKey: "video:stored" }),
            onCompleted: (_node, stored) => { completed.push(stored.storageKey); },
            onIdentityMismatch: () => undefined,
            onError: () => undefined,
        });
        expect(completed).toEqual(["video:stored"]);
    });

    it("reports storage failures and skips identity mismatches", async () => {
        const errors: string[] = [];
        let resumed = 0;
        await resumeCanvasVideoTasks([
            node("running", "task-1", { videoTaskAuthIdentity: "same" }),
            { ...node("running", "task-2", { videoTaskAuthIdentity: "other" }), id: "video-2" },
        ], {
            getAuthIdentity: async () => "same",
            start: () => new AbortController(),
            finish: () => undefined,
            resume: async () => {
                resumed += 1;
                return { url: "/content" };
            },
            onTask: () => undefined,
            store: async () => { throw new Error("download failed"); },
            onCompleted: () => undefined,
            onIdentityMismatch: (item) => errors.push(`${item.id}:identity`),
            onError: (item, error) => errors.push(`${item.id}:${error instanceof Error ? error.message : "error"}`),
        });
        expect(resumed).toBe(1);
        expect(errors.sort()).toEqual(["video-1:download failed", "video-2:identity"]);
    });
});
