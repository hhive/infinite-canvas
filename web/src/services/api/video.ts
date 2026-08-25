import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { boolConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { runModelPlugin } from "@/services/api/model-plugin";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoTaskStatus = "queued" | "running" | "completed" | "failed" | "expired";
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = {
    id: string;
    modelConfigId: number;
    model: string;
    status: VideoTaskStatus;
    pollAfterMs?: number;
    timeoutSeconds?: number;
    createdAt?: string;
    provider?: "media" | "plugin";
};
export type VideoGenerationTaskState =
    | { status: "pending"; task: VideoGenerationTask }
    | { status: "completed"; task: VideoGenerationTask; result: VideoGenerationResult }
    | { status: "failed"; task: VideoGenerationTask; error: string };

type RequestOptions = { signal?: AbortSignal; onTask?: (task: VideoGenerationTask) => void | Promise<void> };
type VideoModel = { id: number; model: string; model_name?: string; display_name?: string; media_type?: string; max_reference_images?: number; max_reference_videos?: number; max_reference_audios?: number; supported_seconds?: number[]; supported_resolutions?: string[]; supports_face?: boolean; charge_mode?: "cnt" | "second"; timeout_seconds?: number };
type UploadResponse = { upload_token?: string; token?: string; id?: string | number };
type MediaVideoTask = {
    task_id?: string;
    id?: string;
    status: VideoTaskStatus;
    model_config_id: number;
    model: string;
    poll_after_ms?: number;
    timeout_seconds?: number;
    created_at?: string;
    error_message?: string;
    result?: { url?: string; mime_type?: string } | null;
};

const VIDEO_PATH = "/v1/videos";
const UPLOAD_PATH = "/v1/media/uploads";
export const GENERATED_VIDEO_LOCAL_STORE_TIMEOUT_MS = 8000;
const pluginVideoResults = new Map<string, VideoGenerationResult>();
function sameOriginHeaders(apiKey: string) {
    return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined;
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    let task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    if (task.provider === "plugin") {
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        throw new Error(state.status === "failed" ? state.error : "插件视频尚未完成");
    }
    await options?.onTask?.(task);
    let deadline = videoTaskDeadline(task);
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("本地轮询已停止", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        task = state.task;
        deadline = Math.min(deadline, videoTaskDeadline(task));
        await options?.onTask?.(task);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        await delay(state.task.pollAfterMs || 5000, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    let current = task;
    let deadline = videoTaskDeadline(current);
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
        const state = await pollVideoGenerationTask(config, current, options);
        current = state.task;
        deadline = Math.min(deadline, videoTaskDeadline(current));
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
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        const channel = resolveModelChannel(config, selectedModel);
        return createPluginVideoTask({ ...requestConfig, baseUrl: channel.baseUrl }, selectedModel, script, prompt, references, options);
    }
    const model = modelOptionName(selectedModel);
    if (!model) throw new Error("请先选择视频模型");
    const modelConfig = await resolveVideoModelConfig(model, requestConfig.apiKey, options?.signal);
    const seconds = normalizeSeedanceDuration(config.videoSeconds);
    const resolution = normalizeSeedanceResolution(config.vquality, model);
    const size = normalizeSeedanceRatio(config.size);
    if (Array.isArray(modelConfig.supported_seconds) && !modelConfig.supported_seconds.includes(seconds)) throw new Error(`当前视频模型不支持 ${seconds} 秒`);
    if (!supportsVideoCapability(modelConfig.supported_resolutions, resolution)) throw new Error(`当前视频模型不支持分辨率 ${resolution}`);
    validateVideoReferenceCounts(
        { images: referenceLimit(modelConfig.max_reference_images), videos: referenceLimit(modelConfig.max_reference_videos), audios: referenceLimit(modelConfig.max_reference_audios) },
        { images: references.length, videos: videoReferences.length, audios: audioReferences.length },
    );

    try {
        const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
            Promise.all(references.map(async (reference) => uploadReference(await imageReferenceFile(reference), "image", requestConfig.apiKey, options?.signal))),
            Promise.all(videoReferences.map(async (reference) => uploadReference(await storedMediaFile(reference, "video"), "video", requestConfig.apiKey, options?.signal))),
            Promise.all(audioReferences.map(async (reference) => uploadReference(await storedMediaFile(reference, "audio"), "audio", requestConfig.apiKey, options?.signal))),
        ]);
        const response = await axios.post<MediaVideoTask>(
            VIDEO_PATH,
            {
                model,
                prompt,
                seconds,
                size,
                resolution,
                charge_mode: modelConfig.charge_mode || "cnt",
                supports_face: true,
                generate_audio: true,
                watermark: false,
                reference_images: referenceImages,
                reference_videos: referenceVideos,
                reference_audios: referenceAudios,
            },
            { headers: sameOriginHeaders(requestConfig.apiKey), signal: options?.signal, withCredentials: true },
        );
        return { ...normalizeTask(response.data), timeoutSeconds: modelConfig.timeout_seconds };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result
            ? { status: "completed", task: { ...task, status: "completed" }, result }
            : { status: "failed", task: { ...task, status: "expired" }, error: "插件视频结果已失效，请重新生成" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    try {
        const response = await axios.get<MediaVideoTask>(`${VIDEO_PATH}/${encodeURIComponent(task.id)}`, { headers: sameOriginHeaders(requestConfig.apiKey), signal: options?.signal, withCredentials: true });
        const current = normalizeTask(response.data);
        if (current.status === "queued" || current.status === "running") return { status: "pending", task: current };
        if (current.status !== "completed") return { status: "failed", task: current, error: response.data.error_message || terminalStatusMessage(current.status) };
        const result = response.data.result;
        if (result?.url) return { status: "completed", task: current, result: { url: result.url, mimeType: result.mime_type || "video/mp4" } };
        throw new Error("视频任务已完成但没有返回可播放地址");
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

/* Video task cancellation is intentionally disabled in the public contract.
 * Restore this helper only when the backend route is re-enabled at the same time.
export async function cancelVideoGenerationTask(config: AiConfig, task: VideoGenerationTask): Promise<void> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    await axios.delete(`${VIDEO_PATH}/${encodeURIComponent(task.id)}`, {
        headers: sameOriginHeaders(requestConfig.apiKey),
        withCredentials: true,
    });
}
*/

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await settleWithin(uploadMediaFile(result.url, "video"), GENERATED_VIDEO_LOCAL_STORE_TIMEOUT_MS);
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

export function previewGeneratedVideo(result: VideoGenerationResult): UploadedFile {
    if (result.blob) return { url: URL.createObjectURL(result.blob), storageKey: "", bytes: result.blob.size, mimeType: result.mimeType || result.blob.type || "video/mp4" };
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 API 地址");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(await runModelPlugin({
        capability: "video",
        script,
        config,
        prompt,
        images,
        params: {
            seconds: normalizeSeedanceDuration(config.videoSeconds),
            size: normalizeSeedanceRatio(config.size),
            resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
            ratio: config.size,
            generateAudio: boolConfig(config.videoGenerateAudio, true),
            watermark: boolConfig(config.videoWatermark, false),
        },
        signal: options?.signal,
    }));
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, modelConfigId: 0, model, status: "completed", provider: "plugin" };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result, mimeType: result.type || "video/mp4" };
    if (typeof result === "string" && result) return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob, mimeType: record.blob.type || "video/mp4" };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error("模型脚本没有返回视频");
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer = 0;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = window.setTimeout(() => reject(new Error("本地视频保存超时")), timeoutMs);
            }),
        ]);
    } finally {
        window.clearTimeout(timer);
    }
}

async function resolveVideoModelConfig(model: string, apiKey: string, signal?: AbortSignal) {
    const response = await axios.get<VideoModel[]>("/v1/models", { headers: sameOriginHeaders(apiKey), params: { media_type: "video" }, signal, withCredentials: true });
    const config = response.data.find((item) => (!item.media_type || item.media_type === "video") && publicVideoModelName(item) === model);
    if (!config) throw new Error(`当前模型 ${model} 没有可用的媒体站视频配置`);
    return config;
}

function publicVideoModelName(model: VideoModel) {
    return model.model_name?.trim() || model.display_name?.trim() || model.model.trim();
}

export function validateVideoReferenceCounts(limits: { images: number; videos: number; audios: number }, counts: { images: number; videos: number; audios: number }) {
    if (counts.images > limits.images) throw new Error(`当前视频模型最多支持 ${limits.images} 张参考图片`);
    if (counts.videos > limits.videos) throw new Error(`当前视频模型最多支持 ${limits.videos} 个参考视频`);
    if (counts.audios > limits.audios) throw new Error(`当前视频模型最多支持 ${limits.audios} 个参考音频`);
}

function referenceLimit(value: number | undefined) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function supportsVideoCapability(values: string[] | undefined, requested: string) {
    if (!Array.isArray(values) || values.length === 0) return true;
    const normalized = requested.trim().toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === normalized);
}

async function uploadReference(file: File, kind: "image" | "video" | "audio", apiKey: string, signal?: AbortSignal) {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    const response = await axios.post<UploadResponse>(UPLOAD_PATH, form, { headers: sameOriginHeaders(apiKey), signal, withCredentials: true });
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
    const task: VideoGenerationTask = { id, modelConfigId: payload.model_config_id, model: payload.model, status: payload.status, pollAfterMs: payload.poll_after_ms };
    const timeoutSeconds = positiveSeconds(payload.timeout_seconds);
    if (timeoutSeconds) task.timeoutSeconds = timeoutSeconds;
    if (payload.created_at) task.createdAt = payload.created_at;
    return task;
}

const DEFAULT_VIDEO_TIMEOUT_SECONDS = 1200;

function videoTaskDeadline(task: VideoGenerationTask) {
    const timeoutSeconds = positiveSeconds(task.timeoutSeconds) || DEFAULT_VIDEO_TIMEOUT_SECONDS;
    const createdAt = task.createdAt ? Date.parse(task.createdAt) : Number.NaN;
    const startedAt = Number.isFinite(createdAt) ? createdAt : Date.now();
    return startedAt + timeoutSeconds * 1000;
}

function positiveSeconds(value: unknown) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function terminalStatusMessage(status: VideoTaskStatus) {
    if (status === "expired") return "视频任务已过期";
    return "视频生成失败";
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
        const wakeOnVisible = () => {
            if (!document.hidden) {
                window.clearTimeout(timer);
                document.removeEventListener("visibilitychange", wakeOnVisible);
                resolve();
            }
        };
        const timer = window.setTimeout(() => {
            document.removeEventListener("visibilitychange", wakeOnVisible);
            resolve();
        }, ms);
        document.addEventListener("visibilitychange", wakeOnVisible);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", wakeOnVisible);
            reject(new DOMException("本地轮询已停止", "AbortError"));
        }, { once: true });
    });
}
