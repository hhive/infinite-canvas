// 视频抽帧入口：把视频解成若干张 JPEG 帧图，供文本链路以多张 input_image 的形式反推提示词。
//
// 分工：本文件只做参数校验、结果排序与中止检查；真正的解码与缩放跑在 Web Worker 里，
// 以免几百毫秒到数秒的解码阻塞画布主线程。纯计算部分在 video-frame-sampling-plan.ts。
import { DEFAULT_VIDEO_FRAME_JPEG_QUALITY, DEFAULT_VIDEO_FRAME_MAX_EDGE, resolveFrameCount, type SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";
import { runVideoFrameSampling } from "@/lib/canvas/video-frame-sampling-runner";

export type { SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";
export { computeTargetSize, DEFAULT_VIDEO_FRAME_MAX_EDGE, DEFAULT_VIDEO_REVERSE_FRAME_COUNT, MAX_VIDEO_REVERSE_FRAME_COUNT, planFrameTimestamps, resolveFrameCount } from "@/lib/canvas/video-frame-sampling-plan";

export type SampleVideoFramesInput = {
    /** 已解析的媒体地址（http/https/blob 均可）。 */
    source: string;
    /** 抽帧数，缺省 DEFAULT_VIDEO_REVERSE_FRAME_COUNT，超过上限按上限截断。 */
    count?: number;
    /** 长边上限，缺省 768，等比缩放以约束输入 token。 */
    maxEdge?: number;
    /** JPEG 质量，缺省 0.85。 */
    quality?: number;
    signal?: AbortSignal;
};

/**
 * 抽取视频帧。返回结果按时间戳升序。
 * 帧数非正、地址为空、视频不可解码或一帧都解不出来时抛明确错误，不返回空数组伪装成功。
 */
export async function sampleVideoFrames(input: SampleVideoFramesInput): Promise<SampledVideoFrame[]> {
    const source = input.source?.trim();
    if (!source) throw new Error("视频地址为空，无法抽帧");
    const count = resolveFrameCount(input.count);
    if (count <= 0) throw new Error("抽帧数量必须大于 0");
    throwIfAborted(input.signal);

    const frames = await runVideoFrameSampling({ source, count, maxEdge: input.maxEdge ?? DEFAULT_VIDEO_FRAME_MAX_EDGE, quality: resolveQuality(input.quality) }, input.signal);
    throwIfAborted(input.signal);
    if (!frames.length) throw new Error("未能从视频中解出任何帧，视频可能为空或不可解码");
    return [...frames].sort((left, right) => left.timestampMs - right.timestampMs);
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
