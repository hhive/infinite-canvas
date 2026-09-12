// 视频抽帧的纯计算部分：帧数裁剪、时间戳规划、目标尺寸计算。
// 这里刻意不引入 Mediabunny、Worker 与任何浏览器 API，便于在 jsdom 里独立测试；
// Worker 侧与主线程侧共用同一份规划逻辑，避免两边算法漂移。

/** 抽帧结果：JPEG data URL 与对应的视频时间戳（毫秒）。 */
export type SampledVideoFrame = { dataUrl: string; timestampMs: number };

/** 反推视频提示词时的默认抽帧数。 */
export const DEFAULT_VIDEO_REVERSE_FRAME_COUNT = 6;

/** 抽帧数上限：帧数直接线性放大文本链路的输入 token，必须封顶。 */
export const MAX_VIDEO_REVERSE_FRAME_COUNT = 12;

/** 帧图长边上限（像素），用于约束输入 token。 */
export const DEFAULT_VIDEO_FRAME_MAX_EDGE = 768;

/** JPEG 编码质量。 */
export const DEFAULT_VIDEO_FRAME_JPEG_QUALITY = 0.85;

const DURATION_ERROR = "视频时长无法确定，无法规划抽帧时间点";
const SIZE_ERROR = "视频尺寸无法确定，无法计算缩放尺寸";

/**
 * 把请求的帧数收敛到 [0, MAX] 的整数区间。
 * 缺省取默认帧数；0 与负数保留为 0，由调用方决定是否报错（不在这里抛，便于纯函数被复用）。
 */
export function resolveFrameCount(count?: number): number {
    if (count === undefined) return DEFAULT_VIDEO_REVERSE_FRAME_COUNT;
    if (Number.isNaN(count)) return 0;
    if (!Number.isFinite(count)) return count > 0 ? MAX_VIDEO_REVERSE_FRAME_COUNT : 0;
    return Math.min(MAX_VIDEO_REVERSE_FRAME_COUNT, Math.max(0, Math.floor(count)));
}

/**
 * 按时长等间隔规划抽帧时间戳（毫秒），取每段中点。
 * 取中点而非端点，是为了避开常见的第一帧黑场与最后一帧越界；可变帧率视频也按时间戳取帧，不按帧号索引。
 */
export function planFrameTimestamps(durationMs: number, count: number): number[] {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(DURATION_ERROR);
    if (count <= 0) return [];
    const step = durationMs / count;
    return Array.from({ length: count }, (_, index) => Math.round((index + 0.5) * step));
}

/**
 * 按长边上限等比缩放目标尺寸，不放大只缩小。
 * maxEdge 非正数表示不缩放（保留原始尺寸），短边最小取 1 像素以免产生零尺寸画布。
 */
export function computeTargetSize(width: number, height: number, maxEdge: number = DEFAULT_VIDEO_FRAME_MAX_EDGE): { width: number; height: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(SIZE_ERROR);
    if (!Number.isFinite(maxEdge) || maxEdge <= 0) return { width: Math.round(width), height: Math.round(height) };
    const scale = maxEdge / Math.max(width, height);
    if (scale >= 1) return { width: Math.round(width), height: Math.round(height) };
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
