// 视频抽帧入口：把视频解成若干张 JPEG 帧图，供文本链路以多张 input_image 的形式反推提示词。
//
// 分工：本文件只做参数收敛、结果排序与中止检查；真正的解码与缩放跑在 Web Worker 里，
// 以免几百毫秒到数秒的解码阻塞画布主线程。纯计算部分在 video-frame-sampling-plan.ts。
import {
    DEFAULT_VIDEO_FRAME_JPEG_QUALITY,
    DEFAULT_VIDEO_FRAME_MAX_EDGE,
    MAX_VIDEO_REVERSE_FRAME_COUNT,
    resolveFrameRate,
    type VideoFrameSamplingResult,
} from "@/lib/canvas/video-frame-sampling-plan";
import { runVideoFrameSampling } from "@/lib/canvas/video-frame-sampling-runner";

export type { SampledVideoFrame, VideoFrameSamplingResult, VideoFrameSamplingSummary } from "@/lib/canvas/video-frame-sampling-plan";
export {
    computeTargetSize,
    DEFAULT_VIDEO_FRAME_MAX_EDGE,
    DEFAULT_VIDEO_REVERSE_FRAME_RATE,
    MAX_VIDEO_REVERSE_FRAME_COUNT,
    MAX_VIDEO_REVERSE_FRAME_RATE,
    MIN_VIDEO_REVERSE_FRAME_RATE,
    planVideoFrameTimestamps,
    resolveFrameRate,
} from "@/lib/canvas/video-frame-sampling-plan";

export type SampleVideoFramesInput = {
    /** 已解析的媒体地址（http/https/blob 均可）。 */
    source: string;
    /** 抽帧速率（帧/秒），缺省 2，收敛到 [1, 5]。 */
    frameRate?: number;
    /** 总帧数上限，缺省 30，且不会超过硬上限。 */
    maxFrames?: number;
    /** 长边上限，缺省 768，等比缩放以约束输入 token。 */
    maxEdge?: number;
    /** JPEG 质量，缺省 0.85。 */
    quality?: number;
    signal?: AbortSignal;
};

/**
 * 抽取视频帧。返回结果按时间戳升序，并带上「是否因上限被截断」等采样密度元信息——
 * 调用方需要据此在消息里说明自己看到的是稀疏采样，否则模型会把 30 张图当成连续时间轴。
 * 地址为空、视频不可解码或一帧都解不出来时抛明确错误，不返回空数组伪装成功。
 */
export async function sampleVideoFrames(input: SampleVideoFramesInput): Promise<VideoFrameSamplingResult> {
    const source = input.source?.trim();
    if (!source) throw new Error("视频地址为空，无法抽帧");
    const frameRate = resolveFrameRate(input.frameRate);
    const maxFrames = resolveMaxFrames(input.maxFrames);
    throwIfAborted(input.signal);

    const result = await runVideoFrameSampling({ source, frameRate, maxFrames, maxEdge: input.maxEdge ?? DEFAULT_VIDEO_FRAME_MAX_EDGE, quality: resolveQuality(input.quality) }, input.signal);
    throwIfAborted(input.signal);
    if (!result.frames.length) throw new Error("未能从视频中解出任何帧，视频可能为空或不可解码");
    return { ...result, frames: [...result.frames].sort((left, right) => left.timestampMs - right.timestampMs) };
}

/** 上限只做收紧不做放宽：非法值回落缺省，超过硬上限按硬上限。 */
function resolveMaxFrames(maxFrames?: number) {
    if (typeof maxFrames !== "number" || !Number.isFinite(maxFrames) || maxFrames < 1) return MAX_VIDEO_REVERSE_FRAME_COUNT;
    return Math.min(Math.floor(maxFrames), MAX_VIDEO_REVERSE_FRAME_COUNT);
}

function resolveQuality(quality?: number) {
    return typeof quality === "number" && Number.isFinite(quality) && quality > 0 && quality <= 1 ? quality : DEFAULT_VIDEO_FRAME_JPEG_QUALITY;
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
