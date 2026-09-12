import { describe, expect, it } from "vitest";

import {
    type FrameFeatureVector,
    pickCharacterAngles,
    pickDiverseFrameIndices,
    pickStoryboardFrames,
} from "@/lib/canvas/production-board-frames";
import type { BoardShot } from "@/lib/canvas/production-board-schema";
import type { SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";

function frame(timestampMs: number): SampledVideoFrame {
    return { dataUrl: `data:image/jpeg;base64,${timestampMs}`, timestampMs };
}

function shotsAt(...timeSecs: number[]): BoardShot[] {
    return timeSecs.map((timeSec, index) => ({
        index: index + 1,
        timeSec,
        cameraType: "低角度手持",
        shotSize: "广角",
        movement: "手持",
        action: `动作 ${index + 1}`,
    }));
}

describe("pickStoryboardFrames：按时间取最近帧", () => {
    it("每个镜头取时间上最接近的抽帧", () => {
        const frames = [frame(0), frame(1_000), frame(2_000), frame(3_000)];
        const picked = pickStoryboardFrames(shotsAt(0.4, 2.6), frames);
        expect(picked.map((item) => item?.timestampMs)).toEqual([0, 3_000]);
    });

    it("距离相同时取时间戳更靠前的那一帧，保证确定性", () => {
        const frames = [frame(1_000), frame(3_000)];
        const picked = pickStoryboardFrames(shotsAt(2), frames);
        expect(picked[0]).toBe(frames[0]);
    });

    it("同一帧不重复使用：被占用后取次近", () => {
        const frames = [frame(0), frame(2_000), frame(4_000)];
        const picked = pickStoryboardFrames(shotsAt(0.1, 0.2, 0.3), frames);
        expect(picked.map((item) => item?.timestampMs)).toEqual([0, 2_000, 4_000]);
        expect(new Set(picked).size).toBe(3);
    });

    it("需求帧数多于可用帧数时，多出来的位置返回 null 而不是顶替", () => {
        const frames = [frame(0), frame(1_000)];
        const picked = pickStoryboardFrames(shotsAt(0, 1, 2), frames);
        expect(picked.map((item) => item?.timestampMs ?? null)).toEqual([0, 1_000, null]);
    });

    it("没有抽帧时全部返回 null，不抛错", () => {
        expect(pickStoryboardFrames(shotsAt(1, 2), [])).toEqual([null, null]);
    });

    it("没有镜头时返回空数组", () => {
        expect(pickStoryboardFrames([], [frame(0)])).toEqual([]);
    });

    it("输出与镜头顺序一一对应，长度等于镜头数", () => {
        const frames = [frame(0), frame(5_000)];
        const picked = pickStoryboardFrames(shotsAt(5, 0, 2.5), frames);
        expect(picked).toHaveLength(3);
        expect(picked[0]).toBe(frames[1]);
        expect(picked[1]).toBe(frames[0]);
    });

    it("timeSec 非法（NaN）时该位置返回 null，不会抛出也不会错配", () => {
        const frames = [frame(0), frame(1_000)];
        const shots = shotsAt(0);
        shots.push({ ...shots[0], index: 2, timeSec: Number.NaN });
        expect(pickStoryboardFrames(shots, frames).map((item) => item?.timestampMs ?? null)).toEqual([0, null]);
    });
});

describe("pickDiverseFrameIndices：特征向量到挑选结果的纯函数", () => {
    /** 三簇特征：簇内几乎相同，簇间差异明显。 */
    const features: FrameFeatureVector[] = [
        [0, 0, 0],
        [0, 0, 0.1],
        [10, 10, 10],
        [10, 10, 9.9],
        [0, 20, 0],
    ];

    it("count 非法或没有特征时返回空数组", () => {
        expect(pickDiverseFrameIndices(features, 0)).toEqual([]);
        expect(pickDiverseFrameIndices(features, -1)).toEqual([]);
        expect(pickDiverseFrameIndices([], 2)).toEqual([]);
    });

    it("特征数量不超过需求数量时全选，且按帧序返回", () => {
        expect(pickDiverseFrameIndices(features.slice(0, 2), 5)).toEqual([0, 1]);
        expect(pickDiverseFrameIndices(features.slice(0, 3), 3)).toEqual([0, 1, 2]);
    });

    it("挑选彼此差异最大的若干帧：三簇里每簇各取一帧", () => {
        const picked = pickDiverseFrameIndices(features, 3);
        expect(picked).toHaveLength(3);
        expect(new Set(picked).size).toBe(3);
        const clusters = picked.map((index) => (index <= 1 ? "a" : index <= 3 ? "b" : "c"));
        expect(new Set(clusters).size).toBe(3);
    });

    it("相同输入重复调用结果完全一致（确定性）", () => {
        expect(pickDiverseFrameIndices(features, 3)).toEqual(pickDiverseFrameIndices(features, 3));
        expect(pickDiverseFrameIndices(features, 2)).toEqual(pickDiverseFrameIndices(features, 2));
    });

    it("起点取全体最接近的代表帧，而不是固定的第 0 帧", () => {
        // 第 0 帧独自远在一边，代表帧是中间那簇，起点不应落在离群帧上。
        const outlier: FrameFeatureVector[] = [[100], [0], [0], [0]];
        expect(pickDiverseFrameIndices(outlier, 2)).toEqual([1, 0]);
    });

    it("差异相同时取更靠前的下标", () => {
        const symmetric: FrameFeatureVector[] = [[5], [0], [10]];
        expect(pickDiverseFrameIndices(symmetric, 2)).toEqual([0, 1]);
    });

    it("特征长度不一致时不抛错，仍返回确定结果", () => {
        const ragged: FrameFeatureVector[] = [[0, 0], [10], [0]];
        expect(() => pickDiverseFrameIndices(ragged, 2)).not.toThrow();
        expect(pickDiverseFrameIndices(ragged, 2)).toEqual(pickDiverseFrameIndices(ragged, 2));
    });
});

describe("pickCharacterAngles：多角度挑选", () => {
    const frames = [frame(0), frame(1_000), frame(2_000), frame(3_000), frame(4_000)];

    it("count 非正或没有抽帧时返回空数组", () => {
        expect(pickCharacterAngles(frames, 0, [])).toEqual([]);
        expect(pickCharacterAngles(frames, -2, [])).toEqual([]);
        expect(pickCharacterAngles([], 3, [])).toEqual([]);
    });

    it("按注入的特征挑选，结果覆盖不同的角度簇", () => {
        const features: (FrameFeatureVector | null)[] = [[0, 0], [0, 0.1], [9, 9], [9, 9.1], [0, 0.2]];
        const picked = pickCharacterAngles(frames, 2, features);
        expect(picked).toHaveLength(2);
        expect(new Set(picked).size).toBe(2);
        const clusters = picked.map((item) => (features[frames.indexOf(item)]![0] > 5 ? "b" : "a"));
        expect(new Set(clusters).size).toBe(2);
    });

    it("返回数量不超过需求数量，也不超过可用帧数", () => {
        const features: (FrameFeatureVector | null)[] = [[0], [1], [2], [3], [4]];
        expect(pickCharacterAngles(frames, 3, features)).toHaveLength(3);
        expect(pickCharacterAngles(frames, 99, features)).toHaveLength(5);
    });

    it("特征缺失的帧被跳过，不会顶替成别的帧", () => {
        const features: (FrameFeatureVector | null)[] = [null, [0, 0], null, [5, 5], null];
        expect(pickCharacterAngles(frames, 2, features)).toEqual([frames[1], frames[3]]);
    });

    it("特征全部不可用时降级为等间隔抽样，仍给出跨时间的多角度候选", () => {
        expect(pickCharacterAngles(frames, 3, [null, null, null, null, null])).toEqual([frames[0], frames[2], frames[4]]);
    });

    it("未提供特征时同样降级为等间隔抽样", () => {
        expect(pickCharacterAngles(frames, 2)).toEqual([frames[0], frames[4]]);
    });

    it("特征可用时优先按特征挑选，不走等间隔降级", () => {
        const features: (FrameFeatureVector | null)[] = [[0], [0], [9], [0], [0]];
        expect(pickCharacterAngles(frames, 2, features)).toEqual([frames[0], frames[2]]);
    });

    it("降级抽样在只有一帧或多帧时都不越界", () => {
        expect(pickCharacterAngles([frames[0]], 3, [null])).toEqual([frames[0]]);
        expect(pickCharacterAngles(frames, 1, [null, null, null, null, null])).toEqual([frames[0]]);
        expect(pickCharacterAngles(frames, 5, [null, null, null, null, null])).toEqual(frames);
    });
});
