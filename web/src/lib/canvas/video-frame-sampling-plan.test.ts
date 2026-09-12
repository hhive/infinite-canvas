import { describe, expect, it } from "vitest";

import {
    DEFAULT_VIDEO_REVERSE_FRAME_RATE,
    MAX_VIDEO_REVERSE_FRAME_COUNT,
    MAX_VIDEO_REVERSE_FRAME_RATE,
    MIN_VIDEO_REVERSE_FRAME_RATE,
    planVideoFrameTimestamps,
    resolveFrameRate,
} from "@/lib/canvas/video-frame-sampling-plan";

describe("抽帧速率常量", () => {
    it("速率区间为 1~5 帧/秒，缺省 2", () => {
        expect(MIN_VIDEO_REVERSE_FRAME_RATE).toBe(1);
        expect(MAX_VIDEO_REVERSE_FRAME_RATE).toBe(5);
        expect(DEFAULT_VIDEO_REVERSE_FRAME_RATE).toBe(2);
    });

    it("总帧数硬上限为 30", () => {
        expect(MAX_VIDEO_REVERSE_FRAME_COUNT).toBe(30);
    });
});

describe("resolveFrameRate", () => {
    it("缺省取 2 帧/秒", () => {
        expect(resolveFrameRate(undefined)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });

    it("区间内的值原样保留，小数不取整", () => {
        expect(resolveFrameRate(1)).toBe(1);
        expect(resolveFrameRate(2.5)).toBe(2.5);
        expect(resolveFrameRate(5)).toBe(5);
    });

    it("越界收敛到 [1, 5]：速率下界保证每秒至少一帧", () => {
        expect(resolveFrameRate(0)).toBe(MIN_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(-3)).toBe(MIN_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(0.4)).toBe(MIN_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(7)).toBe(MAX_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(99)).toBe(MAX_VIDEO_REVERSE_FRAME_RATE);
    });

    it("非法值（NaN/Infinity/非数字）一律回落缺省，避免算出 NaN 帧数", () => {
        expect(resolveFrameRate(Number.NaN)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate("3" as unknown as number)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(resolveFrameRate(null as unknown as number)).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });
});

describe("planVideoFrameTimestamps", () => {
    it("帧数 = ceil(时长秒数 × 速率)", () => {
        expect(planVideoFrameTimestamps(3_000, 2).timestamps).toEqual([250, 750, 1_250, 1_750, 2_250, 2_750]);
        expect(planVideoFrameTimestamps(10_000, 1).timestamps).toHaveLength(10);
        expect(planVideoFrameTimestamps(10_000, 2).timestamps).toHaveLength(20);
        expect(planVideoFrameTimestamps(10_000, 4).timestamps).toHaveLength(30);
        expect(planVideoFrameTimestamps(2_500, 2).timestamps).toHaveLength(5);
    });

    it("极短视频至少抽一帧，不足一个采样周期也不会算出零帧", () => {
        expect(planVideoFrameTimestamps(200, 2).timestamps).toEqual([100]);
        expect(planVideoFrameTimestamps(40, 1).timestamps).toEqual([20]);
        expect(planVideoFrameTimestamps(1, 5).timestamps).toHaveLength(1);
    });

    it("缺省速率按缺省值计算", () => {
        expect(planVideoFrameTimestamps(10_000).timestamps).toHaveLength(20);
    });

    it("未超上限时不标记截断", () => {
        const plan = planVideoFrameTimestamps(10_000, 3);
        expect(plan.requestedCount).toBe(30);
        expect(plan.truncated).toBe(false);
        expect(plan.timestamps).toHaveLength(30);
    });

    it("超出总帧数上限时按上限截断并标记，长视频不会被抽成上百帧", () => {
        // 120 秒 × 5 帧/秒 = 600 帧，输入 token 会爆掉，必须封顶到 30 帧。
        const plan = planVideoFrameTimestamps(120_000, 5);
        expect(plan.requestedCount).toBe(600);
        expect(plan.truncated).toBe(true);
        expect(plan.timestamps).toHaveLength(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("截断后仍按上限重新等间隔铺满整段时长", () => {
        const plan = planVideoFrameTimestamps(120_000, 5);
        const gaps = plan.timestamps.slice(1).map((value, index) => value - plan.timestamps[index]);
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
        expect(plan.timestamps[0]).toBeGreaterThan(0);
        expect(plan.timestamps.at(-1)!).toBeLessThan(120_000);
    });

    it("时间戳严格升序，且落在 (0, 时长) 开区间内（避开首帧黑场与末帧越界）", () => {
        const timestamps = planVideoFrameTimestamps(9_000, 5).timestamps;
        for (let index = 1; index < timestamps.length; index += 1) {
            expect(timestamps[index]).toBeGreaterThan(timestamps[index - 1]);
        }
        expect(timestamps[0]).toBeGreaterThan(0);
        expect(timestamps.at(-1)!).toBeLessThan(9_000);
    });

    it("上限可调，但不会超过硬上限", () => {
        expect(planVideoFrameTimestamps(10_000, 5, 4)).toEqual({ timestamps: [1_250, 3_750, 6_250, 8_750], requestedCount: 50, truncated: true });
        expect(planVideoFrameTimestamps(120_000, 5, 999).timestamps).toHaveLength(MAX_VIDEO_REVERSE_FRAME_COUNT);
    });

    it("时长不可用（非正或非有限）时抛明确错误", () => {
        expect(() => planVideoFrameTimestamps(0, 2)).toThrow("视频时长无法确定");
        expect(() => planVideoFrameTimestamps(-1, 2)).toThrow("视频时长无法确定");
        expect(() => planVideoFrameTimestamps(Number.NaN, 2)).toThrow("视频时长无法确定");
    });

    it("帧数上限非法时抛明确错误，不返回空计划伪装成功", () => {
        expect(() => planVideoFrameTimestamps(10_000, 2, 0)).toThrow("抽帧上限必须大于 0");
        expect(() => planVideoFrameTimestamps(10_000, 2, Number.NaN)).toThrow("抽帧上限必须大于 0");
    });
});
