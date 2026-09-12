import { beforeEach, describe, expect, it, vi } from "vitest";

const runVideoFrameSampling = vi.fn();

vi.mock("@/lib/canvas/video-frame-sampling-runner", () => ({
    runVideoFrameSampling: (...args: unknown[]) => runVideoFrameSampling(...args),
}));

import { computeTargetSize, DEFAULT_VIDEO_FRAME_MAX_EDGE, DEFAULT_VIDEO_REVERSE_FRAME_COUNT, MAX_VIDEO_REVERSE_FRAME_COUNT, planFrameTimestamps, resolveFrameCount, sampleVideoFrames } from "@/lib/canvas/video-frame-sampling";

type RunnerRequest = { source: string; count: number; maxEdge: number; quality: number };

function lastRequest(): RunnerRequest {
    return runVideoFrameSampling.mock.calls.at(-1)?.[0] as RunnerRequest;
}

beforeEach(() => {
    runVideoFrameSampling.mockReset();
    runVideoFrameSampling.mockResolvedValue([{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 0 }]);
});

describe("resolveFrameCount", () => {
    it("缺省用默认帧数", () => {
        expect(resolveFrameCount(undefined)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_COUNT);
        expect(DEFAULT_VIDEO_REVERSE_FRAME_COUNT).toBe(6);
    });

    it("超过上限按上限截断", () => {
        expect(MAX_VIDEO_REVERSE_FRAME_COUNT).toBe(12);
        expect(resolveFrameCount(20)).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
        expect(resolveFrameCount(MAX_VIDEO_REVERSE_FRAME_COUNT + 1)).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("下限为零：非正数与非法数都归零，由调用方决定是否报错", () => {
        expect(resolveFrameCount(0)).toBe(0);
        expect(resolveFrameCount(-3)).toBe(0);
        expect(resolveFrameCount(Number.NaN)).toBe(0);
        expect(resolveFrameCount(Number.POSITIVE_INFINITY)).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("小数向下取整", () => {
        expect(resolveFrameCount(3.9)).toBe(3);
    });
});

describe("planFrameTimestamps", () => {
    it("按时长等间隔规划，取每段中点，避免首尾边界帧", () => {
        expect(planFrameTimestamps(10_000, 2)).toEqual([2_500, 7_500]);
        expect(planFrameTimestamps(10_000, 1)).toEqual([5_000]);
    });

    it("时间戳严格升序且落在 (0, 时长) 开区间内", () => {
        const timestamps = planFrameTimestamps(9_000, 6);
        expect(timestamps).toHaveLength(6);
        for (let index = 1; index < timestamps.length; index += 1) {
            expect(timestamps[index]).toBeGreaterThan(timestamps[index - 1]);
        }
        expect(timestamps[0]).toBeGreaterThan(0);
        expect(timestamps.at(-1)!).toBeLessThan(9_000);
    });

    it("间隔均匀：相邻差值最多相差 1 毫秒（取整误差）", () => {
        const timestamps = planFrameTimestamps(1_000, 6);
        const gaps = timestamps.slice(1).map((value, index) => value - timestamps[index]);
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    });

    it("帧数为零时不规划任何时间戳", () => {
        expect(planFrameTimestamps(10_000, 0)).toEqual([]);
        expect(planFrameTimestamps(10_000, -1)).toEqual([]);
    });

    it("时长不可用（非正或非有限）时抛明确错误", () => {
        expect(() => planFrameTimestamps(0, 3)).toThrow("视频时长无法确定");
        expect(() => planFrameTimestamps(-1, 3)).toThrow("视频时长无法确定");
        expect(() => planFrameTimestamps(Number.NaN, 3)).toThrow("视频时长无法确定");
    });
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
    it("缺省帧数与长边传给抽帧执行器", async () => {
        await sampleVideoFrames({ source: "blob:video-1" });
        expect(lastRequest()).toMatchObject({ source: "blob:video-1", count: DEFAULT_VIDEO_REVERSE_FRAME_COUNT, maxEdge: DEFAULT_VIDEO_FRAME_MAX_EDGE, quality: 0.85 });
    });

    it("帧数超过上限时按上限截断后再执行", async () => {
        await sampleVideoFrames({ source: "blob:video-1", count: 99 });
        expect(lastRequest().count).toBe(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("帧数非正时抛明确错误且不启动抽帧", async () => {
        await expect(sampleVideoFrames({ source: "blob:video-1", count: 0 })).rejects.toThrow("抽帧数量必须大于 0");
        await expect(sampleVideoFrames({ source: "blob:video-1", count: -2 })).rejects.toThrow("抽帧数量必须大于 0");
        expect(runVideoFrameSampling).not.toHaveBeenCalled();
    });

    it("地址为空时抛明确错误", async () => {
        await expect(sampleVideoFrames({ source: "   " })).rejects.toThrow("视频地址为空");
        expect(runVideoFrameSampling).not.toHaveBeenCalled();
    });

    it("输出按时间戳升序，乱序结果也会被排序", async () => {
        runVideoFrameSampling.mockResolvedValue([
            { dataUrl: "data:image/jpeg;base64,C", timestampMs: 900 },
            { dataUrl: "data:image/jpeg;base64,A", timestampMs: 100 },
            { dataUrl: "data:image/jpeg;base64,B", timestampMs: 500 },
        ]);
        const frames = await sampleVideoFrames({ source: "blob:video-1" });
        expect(frames.map((frame) => frame.timestampMs)).toEqual([100, 500, 900]);
    });

    it("不伪造成功：执行器返回空数组时抛错", async () => {
        runVideoFrameSampling.mockResolvedValue([]);
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
            return [{ dataUrl: "data:image/jpeg;base64,AA", timestampMs: 100 }];
        });
        await expect(sampleVideoFrames({ source: "blob:video-1", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
});
