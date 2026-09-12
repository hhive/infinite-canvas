// 抽帧 Worker 的主线程侧客户端：负责建 Worker、转发请求、把中止信号变成 terminate。
// 单独成文件是为了让抽帧模块可以在测试里替换掉真实 Worker（jsdom 里没有 Worker 实现）。
import type { VideoFrameSamplingRequest, VideoFrameSamplingResult } from "@/lib/canvas/video-frame-sampling-plan";

export type { VideoFrameSamplingRequest } from "@/lib/canvas/video-frame-sampling-plan";

type VideoFrameSamplingResponse = ({ ok: true } & VideoFrameSamplingResult) | { ok: false; error: { name: string; message: string } };

export function runVideoFrameSampling(request: VideoFrameSamplingRequest, signal?: AbortSignal): Promise<VideoFrameSamplingResult> {
    return new Promise<VideoFrameSamplingResult>((resolve, reject) => {
        let worker: Worker;
        try {
            worker = createSamplingWorker();
        } catch (error) {
            reject(new Error(`抽帧 Worker 启动失败：${error instanceof Error ? error.message : String(error)}`));
            return;
        }

        let settled = false;
        const settle = (finish: () => void) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            worker.terminate();
            finish();
        };

        function onAbort() {
            settle(() => reject(abortReason(signal)));
        }

        worker.onmessage = (event: MessageEvent<VideoFrameSamplingResponse>) => {
            const message = event.data;
            if (message.ok) {
                const { ok: _ok, ...result } = message;
                settle(() => resolve(result));
            } else {
                settle(() => reject(restoreError(message.error)));
            }
        };
        worker.onerror = (event: ErrorEvent) => {
            settle(() => reject(new Error(event.message || "抽帧 Worker 执行失败")));
        };

        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage(request);
    });
}

function createSamplingWorker() {
    // Vite 只识别 new Worker(new URL(...), ...) 这种内联写法，拆成变量会让 Worker 无法单独打包。
    return new Worker(new URL("./video-frame-sampling.worker.ts", import.meta.url), { type: "module" });
}

function abortReason(signal?: AbortSignal) {
    return signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function restoreError(error: { name: string; message: string }) {
    const restored = new Error(error.message);
    restored.name = error.name || "Error";
    return restored;
}
