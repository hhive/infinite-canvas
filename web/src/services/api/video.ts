import axios from "axios";

import { dataUrlToFile } from "@/lib/image-utils";
import { boolConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoTaskStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "cancelled" | "expired";
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = {
    id: string;
    modelConfigId: number;
    model: string;
    status: VideoTaskStatus;
    pollAfterMs?: number;
};
export type VideoGenerationTaskState =
    | { status: "pending"; task: VideoGenerationTask }
    | { status: "completed"; task: VideoGenerationTask; result: VideoGenerationResult }
    | { status: "failed"; task: VideoGenerationTask; error: string };

type RequestOptions = { signal?: AbortSignal; onTask?: (task: VideoGenerationTask) => void | Promise<void> };
type VideoModel = { id: number; model: string; media_type?: string };
type UploadResponse = { upload_token?: string; token?: string; id?: string | number };
type MediaVideoTask = {
    task_id?: string;
    id?: string;
    status: VideoTaskStatus;
    model_config_id: number;
    model: string;
    poll_after_ms?: number;
    error_message?: string;
    result?: { url?: string; content_url?: string; mime_type?: string } | null;
};

const VIDEO_PATH = "/v1/videos";
const UPLOAD_PATH = "/v1/media/uploads";
const videoModelConfigIDs = new Map<string, number>();

function sameOriginHeaders(apiKey: string) {
    return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined;
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    let task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    await options?.onTask?.(task);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("本地轮询已停止", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        task = state.task;
        await options?.onTask?.(task);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
        await delay(state.task.pollAfterMs || 5000, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    let current = task;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await pollVideoGenerationTask(config, current, options);
        current = state.task;
        await options?.onTask?.(current);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        await delay(current.pollAfterMs || 5000, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const model = modelOptionName(selectedModel);
    if (!model) throw new Error("请先选择视频模型");
    const modelConfigId = await resolveVideoModelConfigId(model, requestConfig.apiKey, options?.signal);

    try {
        const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
            Promise.all(references.map(async (reference) => uploadReference(await imageReferenceFile(reference), "image", modelConfigId, requestConfig.apiKey, options?.signal))),
            Promise.all(videoReferences.map(async (reference) => uploadReference(await storedMediaFile(reference, "video"), "video", modelConfigId, requestConfig.apiKey, options?.signal))),
            Promise.all(audioReferences.map(async (reference) => uploadReference(await storedMediaFile(reference, "audio"), "audio", modelConfigId, requestConfig.apiKey, options?.signal))),
        ]);
        const response = await axios.post<MediaVideoTask>(
            VIDEO_PATH,
            {
                model_config_id: modelConfigId,
                prompt,
                seconds: normalizeSeedanceDuration(config.videoSeconds),
                size: normalizeSeedanceRatio(config.size),
                resolution: normalizeSeedanceResolution(config.vquality, model),
                generate_audio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                reference_images: referenceImages,
                reference_videos: referenceVideos,
                reference_audios: referenceAudios,
            },
            { headers: sameOriginHeaders(requestConfig.apiKey), signal: options?.signal, withCredentials: true },
        );
        return normalizeTask(response.data);
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    try {
        const response = await axios.get<MediaVideoTask>(`${VIDEO_PATH}/${encodeURIComponent(task.id)}`, { headers: sameOriginHeaders(requestConfig.apiKey), signal: options?.signal, withCredentials: true });
        const current = normalizeTask(response.data);
        if (current.status === "queued" || current.status === "running") return { status: "pending", task: current };
        if (current.status !== "completed") return { status: "failed", task: current, error: response.data.error_message || terminalStatusMessage(current.status) };
        const result = response.data.result;
        if (result?.url || result?.content_url) return { status: "completed", task: current, result: { url: result.url || result.content_url, mimeType: result.mime_type || "video/mp4" } };
        const content = await axios.get<Blob>(`${VIDEO_PATH}/${encodeURIComponent(task.id)}/content`, { headers: sameOriginHeaders(requestConfig.apiKey), responseType: "blob", signal: options?.signal, withCredentials: true });
        await assertVideoBlob(content.data);
        return { status: "completed", task: current, result: { blob: content.data, mimeType: content.data.type || "video/mp4" } };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function resolveVideoModelConfigId(model: string, apiKey: string, signal?: AbortSignal) {
    let id = videoModelConfigIDs.get(model);
    if (!id) {
        const response = await axios.get<VideoModel[]>("/v1/models", { headers: sameOriginHeaders(apiKey), params: { media_type: "video" }, signal, withCredentials: true });
        for (const item of response.data) if (!item.media_type || item.media_type === "video") videoModelConfigIDs.set(item.model, item.id);
        id = videoModelConfigIDs.get(model);
    }
    if (!id) throw new Error(`当前模型 ${model} 没有可用的媒体站视频配置`);
    return id;
}

async function uploadReference(file: File, kind: "image" | "video" | "audio", modelConfigId: number, apiKey: string, signal?: AbortSignal) {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    const response = await axios.post<UploadResponse>(UPLOAD_PATH, form, { headers: sameOriginHeaders(apiKey), params: { model_config_id: modelConfigId }, signal, withCredentials: true });
    const token = response.data.upload_token || response.data.token || response.data.id;
    if (token === undefined || token === "") throw new Error(`${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}上传没有返回 token`);
    return String(token);
}

async function imageReferenceFile(reference: ReferenceImage) {
    return dataUrlToFile({ ...reference, dataUrl: await imageToDataUrl(reference) });
}

async function storedMediaFile(reference: ReferenceVideo | ReferenceAudio, kind: "video" | "audio") {
    let blob: Blob | null = reference.storageKey ? await getMediaBlob(reference.storageKey) : null;
    if (!blob && reference.url) blob = await (await fetch(reference.url)).blob();
    if (!blob) throw new Error(`参考${kind === "video" ? "视频" : "音频"}读取失败，请重新添加`);
    return new File([blob], reference.name || `reference.${kind === "video" ? "mp4" : "mp3"}`, { type: blob.type || reference.type });
}

function normalizeTask(payload: MediaVideoTask): VideoGenerationTask {
    const id = payload.task_id || payload.id;
    if (!id) throw new Error("视频接口没有返回任务 ID");
    return { id, modelConfigId: payload.model_config_id, model: payload.model, status: payload.status, pollAfterMs: payload.poll_after_ms };
}

function terminalStatusMessage(status: VideoTaskStatus) {
    if (status === "canceled" || status === "cancelled") return "视频任务已取消";
    if (status === "expired") return "视频任务已过期";
    return "视频生成失败";
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.size) throw new Error("视频内容为空");
    if (blob.type && !blob.type.startsWith("video/") && blob.type !== "application/octet-stream") throw new Error("视频接口返回了非视频内容");
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { error_message?: string; error?: { message?: string }; message?: string } | undefined;
        return data?.error_message || data?.error?.message || data?.message || error.message || fallback;
    }
    return error instanceof Error ? error.message : fallback;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("本地轮询已停止", "AbortError"));
        }, { once: true });
    });
}
