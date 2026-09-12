import { beforeEach, describe, expect, it, vi } from "vitest";

const runVideoFrameSampling = vi.fn();

vi.mock("@/lib/canvas/video-frame-sampling-runner", () => ({
    runVideoFrameSampling: (...args: unknown[]) => runVideoFrameSampling(...args),
}));

import { computeTargetSize, DEFAULT_VIDEO_FRAME_MAX_EDGE, DEFAULT_VIDEO_REVERSE_FRAME_RATE, MAX_VIDEO_REVERSE_FRAME_COUNT, sampleVideoFrames } from "@/lib/canvas/video-frame-sampling";

type RunnerRequest = { source: string; frameRate: number; maxFrames: number; maxEdge: number; quality: number };

/** 执行器返回的抽帧结果，测试里按需覆盖字段。 */
function runnerResult(overrides: Partial<{ frames: { dataUrl: string; timestampMs: number }[]; frameRate: number; durationMs: number; requestedCount: number; truncated: boolean }> = {}) {
    return {
        frames: [{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 0 }],
        frameRate: DEFAULT_VIDEO_REVERSE_FRAME_RATE,
        durationMs: 10_000,
        requestedCount: 20,
        truncated: false,
        ...overrides,
    };
}

function lastRequest(): RunnerRequest {
    return runVideoFrameSampling.mock.calls.at(-1)?.[0] as RunnerRequest;
}

beforeEach(() => {
    runVideoFrameSampling.mockReset();
    runVideoFrameSampling.mockResolvedValue(runnerResult());
});

describe("computeTargetSize", () => {
    it("横屏按长边等比缩放", () => {
        expect(computeTargetSize(1920, 1080)).toEqual({ width: 768, height: 432 });
    });

    it("竖屏按长边等比缩放", () => {
        expect(computeTargetSize(1080, 1920)).toEqual({ width: 432, height: 768 });
    });

    it("正方形缩放到长边", () => {
        expect(computeTargetSize(1000, 1000)).toEqual({ width: 768, height: 768 });
    });

    it("本来就不超过长边时保持原始尺寸，不放大", () => {
        expect(computeTargetSize(640, 360)).toEqual({ width: 640, height: 360 });
        expect(computeTargetSize(768, 432)).toEqual({ width: 768, height: 432 });
    });

    it("长边可配置", () => {
        expect(computeTargetSize(1920, 1080, 384)).toEqual({ width: 384, height: 216 });
    });

    it("极端细长按短边取最小值 1，不产生零尺寸", () => {
        expect(computeTargetSize(4000, 10)).toEqual({ width: 768, height: 2 });
        expect(computeTargetSize(4000, 1)).toEqual({ width: 768, height: 1 });
    });

    it("长边非正时不做缩放", () => {
        expect(computeTargetSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
        expect(computeTargetSize(1920, 1080, -1)).toEqual({ width: 1920, height: 1080 });
    });

    it("缺省长边为 768", () => {
        expect(DEFAULT_VIDEO_FRAME_MAX_EDGE).toBe(768);
        expect(computeTargetSize(1920, 1080)).toEqual(computeTargetSize(1920, 1080, DEFAULT_VIDEO_FRAME_MAX_EDGE));
    });

    it("尺寸非法时抛明确错误", () => {
        expect(() => computeTargetSize(0, 1080)).toThrow("视频尺寸无法确定");
        expect(() => computeTargetSize(1920, Number.NaN)).toThrow("视频尺寸无法确定");
    });
});

describe("sampleVideoFrames", () => {
    it("缺省速率、上限与长边传给抽帧执行器", async () => {
        await sampleVideoFrames({ source: "blob:video-1" });
        expect(lastRequest()).toMatchObject({ source: "blob:video-1", frameRate: DEFAULT_VIDEO_REVERSE_FRAME_RATE, maxFrames: MAX_VIDEO_REVERSE_FRAME_COUNT, maxEdge: DEFAULT_VIDEO_FRAME_MAX_EDGE, quality: 0.85 });
    });

    it("速率越界（含非法值）收敛后再执行", async () => {
        await sampleVideoFrames({ source: "blob:video-1", frameRate: 9 });
        expect(lastRequest().frameRate).toBe(5);
        await sampleVideoFrames({ source: "blob:video-1", frameRate: 0 });
        expect(lastRequest().frameRate).toBe(1);
        await sampleVideoFrames({ source: "blob:video-1", frameRate: Number.NaN });
        expect(lastRequest().frameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });

    it("总帧数上限可调，但不会超过硬上限", async () => {
        await sampleVideoFrames({ source: "blob:video-1", maxFrames: 5 });
        expect(lastRequest().maxFrames).toBe(5);
        await sampleVideoFrames({ source: "blob:video-1", maxFrames: 999 });
        expect(lastRequest().maxFrames).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
        // 上限非法时不放大也不缩小，回落到硬上限。
        await sampleVideoFrames({ source: "blob:video-1", maxFrames: 0 });
        expect(lastRequest().maxFrames).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("地址为空时抛明确错误", async () => {
        await expect(sampleVideoFrames({ source: "   " })).rejects.toThrow("视频地址为空");
        expect(runVideoFrameSampling).not.toHaveBeenCalled();
    });

    it("把截断信息透传给调用方，便于在消息里说明采样是稀疏的", async () => {
        runVideoFrameSampling.mockResolvedValue(runnerResult({ frameRate: 5, durationMs: 120_000, requestedCount: 600, truncated: true, frames: [{ dataUrl: "data:image/jpeg;base64,A", timestampMs: 2_000 }] }));

        const result = await sampleVideoFrames({ source: "blob:video-1", frameRate: 5 });

        expect(result.truncated).toBe(true);
        expect(result.frameRate).toBe(5);
        expect(result.durationMs).toBe(120_000);
        expect(result.requestedCount).toBe(600);
        expect(result.frames).toHaveLength(1);
    });

    it("输出按时间戳升序，乱序结果也会被排序", async () => {
        runVideoFrameSampling.mockResolvedValue(
            runnerResult({
                frames: [
                    { dataUrl: "data:image/jpeg;base64,C", timestampMs: 900 },
                    { dataUrl: "data:image/jpeg;base64,A", timestampMs: 100 },
                    { dataUrl: "data:image/jpeg;base64,B", timestampMs: 500 },
                ],
            }),
        );
        const result = await sampleVideoFrames({ source: "blob:video-1" });
        expect(result.frames.map((frame) => frame.timestampMs)).toEqual([100, 500, 900]);
    });

    it("不伪造成功：执行器返回空数组时抛错", async () => {
        runVideoFrameSampling.mockResolvedValue(runnerResult({ frames: [] }));
        await expect(sampleVideoFrames({ source: "blob:video-1" })).rejects.toThrow("未能从视频中解出任何帧");
    });

    it("执行器失败时原样抛出错误", async () => {
        runVideoFrameSampling.mockRejectedValue(new Error("该视频编码无法在浏览器中解码"));
        await expect(sampleVideoFrames({ source: "blob:video-1" })).rejects.toThrow("该视频编码无法在浏览器中解码");
    });

    it("已中止的 signal 直接抛 AbortError 且不启动抽帧", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(sampleVideoFrames({ source: "blob:video-1", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(runVideoFrameSampling).not.toHaveBeenCalled();
    });

    it("抽帧过程中中止会抛 AbortError，结果不会当成功返回", async () => {
        const controller = new AbortController();
        runVideoFrameSampling.mockImplementation(async (_request: RunnerRequest, signal?: AbortSignal) => {
            controller.abort();
            expect(signal).toBe(controller.signal);
            return runnerResult({ frames: [{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 100 }] });
        });
        await expect(sampleVideoFrames({ source: "blob:video-1", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
});
