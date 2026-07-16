import { describe, expect, it } from "vitest";

import { canRetryImageResult, markImageResultLocallyDetached } from "@/pages/image/image-result-state";

describe("image result state", () => {
    it.each(["queued", "running"] as const)("keeps a locally detached %s task visible without offering retry", (taskStatus) => {
        const result = markImageResultLocallyDetached({
            id: "slot-1",
            status: "pending" as const,
            taskId: "task-1",
            taskStatus,
        });

        expect(result).toMatchObject({
            id: "slot-1",
            status: "failed",
            taskId: "task-1",
            taskStatus,
            locallyDetached: true,
            error: expect.stringContaining("任务仍在后台运行"),
        });
        expect(canRetryImageResult(result)).toBe(false);
    });

    it("still allows retry for an ordinary failed image request", () => {
        expect(canRetryImageResult({ status: "failed", taskStatus: "failed", error: "生成失败" })).toBe(true);
    });
});
