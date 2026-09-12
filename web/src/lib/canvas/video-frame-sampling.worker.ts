// 抽帧 Worker：解码与缩放都放在这里，画布主线程只做消息往返。
// 为什么必须放 Worker：解码一个几秒的 H.264 视频大约要几百毫秒到数秒，放在主线程会让画布卡死，
// 用户看到的表现为「点了反推就整页顿住」；Worker 里跑解码则画布动画与交互不受影响。
//
// 注意：本文件运行在 Worker 环境，但全仓库共用一份 tsconfig（lib 只有 dom，没有 webworker），
// 因此这里沿用 DOM 的 self 类型；运行时由 Worker 全局作用域提供 postMessage/onmessage/FileReader/OffscreenCanvas。
import { ALL_FORMATS, BlobSource, Input, UrlSource, VideoSampleSink, type VideoSample } from "mediabunny";

import { computeTargetSize, planVideoFrameTimestamps, type SampledVideoFrame, type VideoFrameSamplingRequest, type VideoFrameSamplingResult } from "@/lib/canvas/video-frame-sampling-plan";

type VideoFrameSamplingResponse = ({ ok: true } & VideoFrameSamplingResult) | { ok: false; error: { name: string; message: string } };

/** 编码/轨道层面的确定性失败：重试整文件读取也不会有不同结果，不做整文件回退。 */
class UnsupportedVideoError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsupportedVideoError";
    }
}

self.onmessage = (event: MessageEvent<VideoFrameSamplingRequest>) => {
    void respond(event.data);
};

async function respond(request: VideoFrameSamplingRequest) {
    try {
        const result = await sampleVideoFramesInWorker(request);
        postMessage({ ok: true, ...result } satisfies VideoFrameSamplingResponse);
    } catch (error) {
        postMessage({
            ok: false,
            error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) },
        } satisfies VideoFrameSamplingResponse);
    }
}

async function sampleVideoFramesInWorker(request: VideoFrameSamplingRequest): Promise<VideoFrameSamplingResult> {
    // 优先按需分段读取：UrlSource 会按 HTTP Range 只拉解码所需的片段，避免把整个视频下载下来。
    // 服务端不支持 Range、CORS 受限、或读取中途失败时，回退为整文件 BlobSource。
    if (!/^(blob:|data:)/i.test(request.source)) {
        try {
            return await sampleFramesFromInput(new Input({ formats: ALL_FORMATS, source: new UrlSource(request.source) }), request);
        } catch (error) {
            if (error instanceof UnsupportedVideoError) throw error;
        }
    }
    return sampleFramesFromInput(new Input({ formats: ALL_FORMATS, source: new BlobSource(await fetchBlob(request.source)) }), request);
}

async function fetchBlob(source: string): Promise<Blob> {
    let response: Response;
    try {
        response = await fetch(source);
    } catch (error) {
        throw new Error(`视频读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`视频读取失败：HTTP ${response.status}`);
    return response.blob();
}

async function sampleFramesFromInput(input: Input, request: VideoFrameSamplingRequest): Promise<VideoFrameSamplingResult> {
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new UnsupportedVideoError("视频中没有可用的视频轨道");
        if (!(await track.canDecode())) throw new UnsupportedVideoError("该视频编码无法在当前浏览器中解码");

        const durationSeconds = await readDurationSeconds(input);
        const durationMs = Math.round(durationSeconds * 1000);
        const target = computeTargetSize(await track.getDisplayWidth(), await track.getDisplayHeight(), request.maxEdge);
        const sink = new VideoSampleSink(track);
        const frames: SampledVideoFrame[] = [];
        // 帧数由时长与速率算出，超过上限时按上限重新等间隔规划；截断标志原样回传给上层。
        const plan = planVideoFrameTimestamps(durationMs, request.frameRate, request.maxFrames);

        for (const plannedMs of plan.timestamps) {
            // 按时间戳取帧：VFR 视频的帧间隔不均匀，按帧号索引会取错位置。
            const sample = await sink.getSample(plannedMs / 1000);
            if (!sample) continue;
            try {
                // 用实际解码出来的帧时间戳而非计划时间戳，标注才是这一帧真实出现的时间。
                const timestampMs = Math.max(0, Math.round(sample.timestamp * 1000));
                // 稀疏 VFR 视频里相邻计划点可能落在同一帧上，重复帧只保留一次，避免给模型送去同一张图。
                if (frames.at(-1)?.timestampMs === timestampMs) continue;
                frames.push({ dataUrl: await renderFrameToJpegDataUrl(sample, target, request.quality), timestampMs });
            } finally {
                // VideoSample 内部持有 WebCodecs 帧，不显式关闭会一直占着 GPU 内存，抽十几帧就明显泄漏。
                sample.close();
            }
        }

        if (!frames.length) throw new Error("未能从视频中解出任何帧，视频可能为空或不可解码");
        return { frames, frameRate: request.frameRate, durationMs, requestedCount: plan.requestedCount, frameCount: frames.length, truncated: plan.truncated };
    } finally {
        input.dispose();
    }
}

async function readDurationSeconds(input: Input): Promise<number> {
    const precise = await input.computeDuration().catch(() => 0);
    if (Number.isFinite(precise) && precise > 0) return precise;
    // computeDuration 需要遍历所有轨道，个别容器拿不到精确时长时退回元数据里的近似值。
    const metadata = await input.getDurationFromMetadata().catch(() => null);
    return typeof metadata === "number" && Number.isFinite(metadata) ? metadata : 0;
}

async function renderFrameToJpegDataUrl(sample: VideoSample, target: { width: number; height: number }, quality: number): Promise<string> {
    if (typeof OffscreenCanvas === "undefined") throw new Error("当前浏览器不支持 OffscreenCanvas，无法在 Worker 中抽帧");
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 2D 绘图上下文，抽帧失败");
    // contain 会在目标画布内等比居中绘制，并自动应用视频的旋转元数据。
    sample.drawWithFit(context, { fit: "contain" });
    // 统一输出 JPEG：帧图只是给模型看的，PNG 会把输入 token 成本抬高好几倍。
    return blobToDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality }));
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("视频帧编码失败"));
        reader.readAsDataURL(blob);
    });
}
