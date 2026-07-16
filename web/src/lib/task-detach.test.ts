import { describe, expect, it } from "vitest";

import { detachTaskBatch, detachTaskRequest, isCurrentTaskRequest, LOCAL_TASK_DETACH_MESSAGE, recordTaskIdIfCurrent } from "@/lib/task-detach";

describe("local task detachment", () => {
    it("aborts one local request, removes it, and returns its known task id", () => {
        const first = new AbortController();
        const second = new AbortController();
        const requests = new Map<string, { controller: AbortController; runningNodeId: string; taskId?: string }>([
            ["child-1", { controller: first, taskId: "task-1", runningNodeId: "root" }],
            ["child-2", { controller: second, taskId: "task-2", runningNodeId: "root" }],
        ]);

        expect(detachTaskRequest(requests, "child-1")).toBe("task-1");
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(false);
        expect(requests.has("child-1")).toBe(false);
    });

    it("detaches every local child in a batch without a network callback", () => {
        const requests = new Map([
            ["child-1", { controller: new AbortController(), runningNodeId: "root-1" }],
            ["child-2", { controller: new AbortController(), runningNodeId: "root-1" }],
            ["other", { controller: new AbortController(), runningNodeId: "root-2" }],
        ]);

        expect(detachTaskBatch(requests, "root-1")).toEqual(["child-1", "child-2"]);
        expect(requests.has("other")).toBe(true);
    });

    it("states that only local waiting stopped", () => {
        expect(LOCAL_TASK_DETACH_MESSAGE).toContain("任务仍在后台运行");
    });

    it("rejects a late task callback from an old controller after the target restarts", () => {
        const oldController = new AbortController();
        const newController = new AbortController();
        const requests = new Map<string, { controller: AbortController; runningNodeId: string; taskId?: string }>([
            ["node-1", { controller: newController, runningNodeId: "node-1" }],
        ]);

        expect(isCurrentTaskRequest(requests, "node-1", oldController)).toBe(false);
        expect(recordTaskIdIfCurrent(requests, "node-1", oldController, "old-task")).toBe(false);
        expect(requests.get("node-1")?.taskId).toBeUndefined();

        expect(isCurrentTaskRequest(requests, "node-1", newController)).toBe(true);
        expect(recordTaskIdIfCurrent(requests, "node-1", newController, "new-task")).toBe(true);
        expect(requests.get("node-1")?.taskId).toBe("new-task");
    });
});
