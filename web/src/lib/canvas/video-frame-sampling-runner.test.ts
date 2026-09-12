import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runVideoFrameSampling } from "@/lib/canvas/video-frame-sampling-runner";

// jsdom 没有 Worker，用一个可观测的替身验证「消息回传、错误还原、中止即终止」这三条协议行为。
class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    posted: unknown[] = [];
    terminated = false;

    postMessage(data: unknown) {
        this.posted.push(data);
    }

    terminate() {
        this.terminated = true;
    }
}

const workers: FakeWorker[] = [];

beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal(
        "Worker",
        class extends FakeWorker {
            constructor() {
                super();
                workers.push(this);
            }
        },
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const request = { source: "https://media.test/v1.mp4", count: 6, maxEdge: 768, quality: 0.85 };

describe("runVideoFrameSampling 的 Worker 协议", () => {
    it("把请求转发给 Worker，并把 Worker 回传的帧解析出来", async () => {
        const pending = runVideoFrameSampling(request);
        expect(workers[0].posted).toEqual([request]);

        workers[0].onmessage!({ data: { ok: true, frames: [{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 200 }] } } as MessageEvent);

        await expect(pending).resolves.toEqual([{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 200 }]);
        expect(workers[0].terminated).toBe(true);
    });

    it("还原 Worker 侧的错误名称与消息，不让错误细节丢失", async () => {
        const pending = runVideoFrameSampling(request);
        workers[0].onmessage!({ data: { ok: false, error: { name: "UnsupportedVideoError", message: "该视频编码无法在当前浏览器中解码" } } } as MessageEvent);

        const error = await pending.catch((reason: unknown) => reason);
        expect((error as Error).message).toBe("该视频编码无法在当前浏览器中解码");
        expect((error as Error).name).toBe("UnsupportedVideoError");
        expect(workers[0].terminated).toBe(true);
    });

    it("中止时抛 AbortError 并终止 Worker，不再等解码结果", async () => {
        const controller = new AbortController();
        const pending = runVideoFrameSampling(request, controller.signal);

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(workers[0].terminated).toBe(true);

        // 中止后即使 Worker 再回传结果也不能当成功。
        workers[0].onmessage?.({ data: { ok: true, frames: [{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 200 }] } } as MessageEvent);
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it("已中止的 signal 不把请求发给 Worker，并立即终止它", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(runVideoFrameSampling(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(workers).toHaveLength(1);
        expect(workers[0].posted).toEqual([]);
        expect(workers[0].terminated).toBe(true);
    });

    it("Worker 自身报错时抛明确错误", async () => {
        const pending = runVideoFrameSampling(request);
        workers[0].onerror!({ message: "Script error." } as ErrorEvent);
        await expect(pending).rejects.toThrow("Script error.");
    });
});
