// 视频抽帧的纯计算部分：速率收敛、帧数与时间戳规划、目标尺寸计算。
// 这里刻意不引入 Mediabunny、Worker 与任何浏览器 API，便于在 jsdom 里独立测试；
// Worker 侧与主线程侧共用同一份规划逻辑，避免两边算法漂移。
//
// 抽帧按「速率（帧/秒）」而不是「固定帧数」定义：反推的细节密度取决于时长，短视频 6 帧够用，
// 长视频 6 帧只能看到零星几张，所以由用户选速率、由时长决定帧数；代价是长视频帧数会线性膨胀，
// 因此再用一个总帧数硬上限兜住输入 token。

/** 抽帧结果：JPEG data URL 与对应的视频时间戳（毫秒）。 */
export type SampledVideoFrame = { dataUrl: string; timestampMs: number };

/** 抽帧速率下界（帧/秒）：保证每秒至少有一帧。 */
export const MIN_VIDEO_REVERSE_FRAME_RATE = 1;

/** 抽帧速率上界（帧/秒）。 */
export const MAX_VIDEO_REVERSE_FRAME_RATE = 5;

/** 反推视频提示词时的默认抽帧速率（帧/秒）。 */
export const DEFAULT_VIDEO_REVERSE_FRAME_RATE = 2;

/** 总帧数硬上限：帧数直接线性放大文本链路的输入 token，必须封顶（5 帧/秒 × 60 秒 = 300 帧会打到十几万 token）。 */
export const MAX_VIDEO_REVERSE_FRAME_COUNT = 30;

/** 帧图长边上限（像素），用于约束输入 token。 */
export const DEFAULT_VIDEO_FRAME_MAX_EDGE = 768;

/** JPEG 编码质量。 */
export const DEFAULT_VIDEO_FRAME_JPEG_QUALITY = 0.85;

const DURATION_ERROR = "视频时长无法确定，无法规划抽帧时间点";
const SIZE_ERROR = "视频尺寸无法确定，无法计算缩放尺寸";
const LIMIT_ERROR = "抽帧上限必须大于 0";

/**
 * 把抽帧速率收敛到 [MIN, MAX]，缺省取默认速率。
 * 非法值（NaN、Infinity、非数字）一律回落缺省：速率会直接乘进帧数，放过 Infinity 会算出 NaN 帧数，
 * 而 NaN 帧数在规划里表现为「零帧」，最终伪装成「视频解不出帧」这种误导性错误。
 */
export function resolveFrameRate(rate?: number): number {
    if (typeof rate !== "number" || !Number.isFinite(rate)) return DEFAULT_VIDEO_REVERSE_FRAME_RATE;
    return Math.min(MAX_VIDEO_REVERSE_FRAME_RATE, Math.max(MIN_VIDEO_REVERSE_FRAME_RATE, rate));
}

/** 抽帧计划：按速率算出帧数后，若超过上限则按上限重新等间隔规划。 */
export type VideoFrameSamplingPlan = {
    /** 抽帧时间戳（毫秒，升序）。 */
    timestamps: number[];
    /** 按速率算出的期望帧数（截断前）。 */
    requestedCount: number;
    /** 是否因为总帧数上限被截断；上层据此在消息里告诉模型「看到的是稀疏采样」。 */
    truncated: boolean;
};

/** 抽帧结果里描述「采样密度」的元信息，不含帧图本身。 */
export type VideoFrameSamplingSummary = {
    /** 实际使用的抽帧速率（帧/秒）。 */
    frameRate: number;
    /** 解码器读出的视频时长（毫秒）。 */
    durationMs: number;
    /** 截断前的期望帧数。 */
    requestedCount: number;
    /** 实际解出的帧数（稀疏 VFR 去重后可能略少于计划帧数）。 */
    frameCount: number;
    /** 是否因总帧数上限被截断。 */
    truncated: boolean;
};

/** 抽帧结果：帧图与采样密度元信息。 */
export type VideoFrameSamplingResult = VideoFrameSamplingSummary & { frames: SampledVideoFrame[] };

/** 抽帧 Worker 的请求契约：Worker 侧与主线程侧共用同一份，避免字段漂移。 */
export type VideoFrameSamplingRequest = {
    source: string;
    frameRate: number;
    maxFrames: number;
    maxEdge: number;
    quality: number;
};

/**
 * 按时长与速率规划抽帧时间戳（毫秒），取每段中点。
 * 取中点而非端点，是为了避开常见的第一帧黑场与最后一帧越界；可变帧率视频也按时间戳取帧，不按帧号索引。
 * 帧数 = clamp(ceil(时长秒数 × 速率), 1, 上限)：极短视频（不足一个采样周期）也至少留一帧代表画面。
 * 超过上限时按上限重新等间隔规划，而不是丢掉尾部——截断后仍要覆盖整段时长。
 */
export function planVideoFrameTimestamps(durationMs: number, frameRate?: number, maxFrames: number = MAX_VIDEO_REVERSE_FRAME_COUNT): VideoFrameSamplingPlan {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(DURATION_ERROR);
    if (!Number.isFinite(maxFrames) || maxFrames < 1) throw new Error(LIMIT_ERROR);
    const requestedCount = Math.max(1, Math.ceil((durationMs / 1000) * resolveFrameRate(frameRate)));
    // 硬上限在这里再兜一层：无论调用方传多大的上限，都不可能抽出超过 MAX_VIDEO_REVERSE_FRAME_COUNT 帧。
    const count = Math.min(requestedCount, Math.floor(maxFrames), MAX_VIDEO_REVERSE_FRAME_COUNT);
    const step = durationMs / count;
    return {
        timestamps: Array.from({ length: count }, (_, index) => Math.round((index + 0.5) * step)),
        requestedCount,
        truncated: requestedCount > count,
    };
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
