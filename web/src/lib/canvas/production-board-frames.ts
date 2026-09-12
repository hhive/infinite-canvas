// 制作规划板的帧挑选：故事板按时间取最近帧，角色参考按视角差异取最大差异帧。
//
// 设计要点是把「画布/图像 API」与「挑选决策」解耦：像素只在 extractFrameFeatures 里读取，
// 挑选本身（特征向量 → 下标）是不依赖任何浏览器 API 的纯函数，可以在 jsdom 里独立测试。
// 抽帧是 data URL（JPEG），浏览器里解码图片必然异步，所以特征提取是 async；
// 挑选保持同步纯函数，由调用方先把特征准备好再传进来。

import type { BoardShot } from "@/lib/canvas/production-board-schema";
import type { SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";

/** 帧特征向量：小尺寸缩略图的灰度序列。 */
export type FrameFeatureVector = number[];

/** 缩图边长：16×16 足够区分机位与角度的大块差异，同时把每帧压成 256 维特征。 */
export const CHARACTER_ANGLE_FEATURE_SIZE = 16;

/** 两个特征向量的距离：逐维绝对差的均值。长度不一致时按较短的长度比较。 */
function featureDistance(left: FrameFeatureVector, right: FrameFeatureVector): number {
    const length = Math.min(left.length, right.length);
    if (length === 0) return 0;
    let total = 0;
    for (let index = 0; index < length; index += 1) total += Math.abs(left[index] - right[index]);
    return total / length;
}

/**
 * 从特征向量里贪心挑出彼此差异最大的若干帧，返回下标。
 *
 * 起点取「最接近全体均值」的代表帧而不是固定的第 0 帧：首帧常常是标题卡或黑场，
 * 用它当起点会白占一个名额。之后每轮选「到已选集合的最小距离」最大的候选，
 * 差异相同时取更靠前的下标，因此结果是确定的。
 */
export function pickDiverseFrameIndices(features: FrameFeatureVector[], count: number): number[] {
    if (count <= 0 || features.length === 0) return [];
    if (features.length <= count) return features.map((_, index) => index);

    const dimension = Math.max(1, Math.min(...features.map((vector) => vector.length)));
    const mean: FrameFeatureVector = [];
    for (let index = 0; index < dimension; index += 1) {
        let total = 0;
        for (const vector of features) total += vector[index] ?? 0;
        mean.push(total / features.length);
    }

    let seed = 0;
    let seedDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < features.length; index += 1) {
        const distance = featureDistance(features[index], mean);
        if (distance < seedDistance) {
            seedDistance = distance;
            seed = index;
        }
    }

    const selected = [seed];
    while (selected.length < count) {
        let bestIndex = -1;
        let bestScore = -1;
        for (let index = 0; index < features.length; index += 1) {
            if (selected.includes(index)) continue;
            let nearest = Number.POSITIVE_INFINITY;
            for (const picked of selected) {
                nearest = Math.min(nearest, featureDistance(features[index], features[picked]));
            }
            if (nearest > bestScore) {
                bestScore = nearest;
                bestIndex = index;
            }
        }
        if (bestIndex < 0) break;
        selected.push(bestIndex);
    }
    return selected;
}

/**
 * 为每个镜头挑一张时间上最接近的抽帧。
 *
 * 同一帧不会被两格复用：被占用后自动退到次近的一张。挑不出可用帧的位置返回 null，
 * 由渲染层如实降级，既不拿别的帧顶替，也不抛错打断整块板。
 */
export function pickStoryboardFrames(shots: BoardShot[], frames: SampledVideoFrame[]): (SampledVideoFrame | null)[] {
    const used = new Set<SampledVideoFrame>();
    return shots.map((shot) => {
        const targetMs = shot.timeSec * 1_000;
        let best: SampledVideoFrame | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const frame of frames) {
            if (used.has(frame)) continue;
            const distance = Math.abs(frame.timestampMs - targetMs);
            // 严格小于：距离相同时保留数组里更靠前的那一帧，结果与输入顺序无关地确定。
            if (distance < bestDistance) {
                bestDistance = distance;
                best = frame;
            }
        }
        if (best !== null) used.add(best);
        return best;
    });
}

/** 等间隔抽样的下标；帧数不足时全选。 */
function spreadIndices(total: number, count: number): number[] {
    if (total <= 0) return [];
    if (total <= count) return Array.from({ length: total }, (_, index) => index);
    if (count <= 1) return [0];
    return Array.from({ length: count }, (_, index) => Math.round((index * (total - 1)) / (count - 1)));
}

/** 从 data URL 解码帧图；解码失败返回 null，交由调用方当作「这帧没有特征」处理。 */
function loadFrameImage(dataUrl: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        if (typeof Image === "undefined" || dataUrl === "") {
            resolve(null);
            return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

/** 把帧图缩到 size×size 并取灰度特征；环境不支持画布或取像素失败时返回 null。 */
function readImageFeatures(image: HTMLImageElement, size: number): FrameFeatureVector | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    const vector: FrameFeatureVector = [];
    for (let index = 0; index < data.length; index += 4) {
        // Rec.601 亮度权重：保留人眼感知的明暗差异，忽略色度带来的噪声。
        vector.push((data[index] * 299 + data[index + 1] * 587 + data[index + 2] * 114) / 1_000);
    }
    return vector;
}

/**
 * 批量提取帧特征，返回与 frames 一一对应的数组（无法提取的位置为 null）。
 *
 * 这是唯一依赖浏览器图像 API 的部分，单独拆出来是为了让挑选逻辑保持可测；
 * 单帧失败不影响其它帧，也不抛错。
 */
export async function extractFrameFeatures(
    frames: SampledVideoFrame[],
    size: number = CHARACTER_ANGLE_FEATURE_SIZE,
): Promise<(FrameFeatureVector | null)[]> {
    const result: (FrameFeatureVector | null)[] = [];
    for (const frame of frames) {
        try {
            const image = await loadFrameImage(frame.dataUrl);
            result.push(image === null ? null : readImageFeatures(image, size));
        } catch {
            result.push(null);
        }
    }
    return result;
}

/**
 * 从抽帧里挑出彼此差异最大的若干张，近似「角色多角度参考」。
 *
 * features 可选：由 extractFrameFeatures 异步预计算后传入（与 frames 一一对应）。
 * 未提供或全部不可用时降级为等间隔抽样——不判断像素差异，但仍给出跨时间的候选，
 * 由渲染层对缺失角度如实标注「素材未覆盖」，而不是在这层编造内容。
 */
export function pickCharacterAngles(
    frames: SampledVideoFrame[],
    count: number,
    features?: (FrameFeatureVector | null)[],
): SampledVideoFrame[] {
    if (count <= 0 || frames.length === 0) return [];

    const available: FrameFeatureVector[] = [];
    const indexMap: number[] = [];
    for (let index = 0; index < frames.length; index += 1) {
        const vector = features?.[index] ?? null;
        if (vector === null || vector.length === 0) continue;
        available.push(vector);
        indexMap.push(index);
    }

    if (available.length === 0) {
        return spreadIndices(frames.length, count).map((index) => frames[index]);
    }
    return pickDiverseFrameIndices(available, count).map((index) => frames[indexMap[index]]);
}
