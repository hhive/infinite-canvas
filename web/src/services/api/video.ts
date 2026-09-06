import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { boolConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { runModelPlugin } from "@/services/api/model-plugin";
import { buildApiUrl, modelOptionName, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoTaskStatus = "queued" | "running" | "completed" | "failed" | "expired";
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = {
    id: string;
    modelConfigId?: number;
    model: string;
    status?: VideoTaskStatus;
    pollAfterMs?: number;
    timeoutSeconds?: number;
    createdAt?: string;
    provider?: "media" | "openai" | "gemini" | "plugin";
};
export type VideoGenerationTaskState =
    | { status: "pending"; task: VideoGenerationTask }
    | { status: "completed"; task: VideoGenerationTask; result: VideoGenerationResult }
    | { status: "failed"; task: VideoGenerationTask; error: string };
type VideoTaskPollState =
    | { status: "pending" }
    | { status: "completed"; result: VideoGenerationResult }
    | { status: "failed"; error: string };
type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type VideoMediaOptions = { signal?: AbortSignal; onTask?: (task: VideoGenerationTask) => void | Promise<void>; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};

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

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return { Authorization: `Bearer ${config.apiKey}`, ...(contentType ? { "Content-Type": contentType } : {}) };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const mediaOptions = { ...options, videos: videoReferences, audios: audioReferences };
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, mediaOptions), mediaOptions);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (task.provider === "plugin") {
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        throw videoTaskFailed(state.status === "failed" ? state.error : apiText("pluginVideoExpired"));
    }
    await options?.onTask?.(task);
    return pollVideoUntilComplete(config, task, options);
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    return pollVideoUntilComplete(config, task, options);
}

async function pollVideoUntilComplete(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    let current = task;
    let deadline = videoTaskDeadline(current);
    while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw new DOMException("本地轮询已停止", "AbortError");
        let state: VideoGenerationTaskState;
        try {
            state = await pollVideoGenerationTask(config, current, options);
        } catch (error) {
            if (!(error instanceof RetryableVideoPollError)) throw error;
            await delay(Math.min(current.pollAfterMs || 5000, Math.max(0, deadline - Date.now())), options?.signal);
            continue;
        }
        current = state.task;
        deadline = Math.min(deadline, videoTaskDeadline(current));
        await options?.onTask?.(current);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        await delay(current.pollAfterMs || 5000, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        const channel = resolveModelChannel(config, selectedModel);
        return createPluginVideoTask({ ...requestConfig, baseUrl: channel.baseUrl }, selectedModel, script, prompt, references, options);
    }
    if (requestConfig.apiFormat === "gemini") {
        assertVideoConfig(requestConfig, requestConfig.model);
        return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    }
    if (!isSameOriginMediaConfig(requestConfig, selectedModel)) {
        assertVideoConfig(requestConfig, requestConfig.model);
        return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
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
        { images: references.length, videos: options?.videos?.length || 0, audios: options?.audios?.length || 0 },
    );

    try {
        const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
            Promise.all(references.map(async (reference) => uploadReference(await imageReferenceFile(reference), "image", requestConfig.apiKey, options?.signal))),
            Promise.all((options?.videos || []).map(async (reference) => uploadReference(await storedMediaFile(reference, "video"), "video", requestConfig.apiKey, options?.signal))),
            Promise.all((options?.audios || []).map(async (reference) => uploadReference(await storedMediaFile(reference, "audio"), "audio", requestConfig.apiKey, options?.signal))),
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
        const task = normalizeTask(response.data);
        const timeoutSeconds = positiveSeconds(modelConfig.timeout_seconds);
        return timeoutSeconds ? { ...task, timeoutSeconds } : task;
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
    if (task.provider === "gemini") return withTask(task, await pollGeminiVideoTask(requestConfig, task, options));
    if (task.provider === "openai") return withTask(task, await pollOpenAIVideoTask(requestConfig, task, options));
    try {
        const response = await axios.get<MediaVideoTask>(`${VIDEO_PATH}/${encodeURIComponent(task.id)}`, { headers: sameOriginHeaders(requestConfig.apiKey), signal: options?.signal, withCredentials: true });
        const current = normalizeTask(response.data);
        if (current.status === "queued" || current.status === "running") return { status: "pending", task: current };
        if (current.status !== "completed") return { status: "failed", task: current, error: response.data.error_message || terminalStatusMessage(current.status || "failed") };
        const result = response.data.result;
        if (result?.url) return { status: "completed", task: current, result: { url: result.url, mimeType: result.mime_type || "video/mp4" } };
        throw new Error("视频任务已完成但没有返回可播放地址");
    } catch (error) {
        if (isTransientVideoPollError(error)) throw new RetryableVideoPollError(readAxiosError(error, "视频任务查询失败"));
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

function withTask(task: VideoGenerationTask, state: VideoTaskPollState): VideoGenerationTaskState {
    if (state.status === "completed") return { status: "completed", result: state.result, task: { ...task, status: "completed" } };
    if (state.status === "failed") return { status: "failed", error: state.error, task: { ...task, status: "failed" } };
    return { status: "pending", task: { ...task, status: "running" } };
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

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 API 地址");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(await runModelPlugin({
        capability: "video",
        script,
        config,
        prompt,
        images,
        videos,
        audios,
        params: {
            seconds: normalizeVideoSeconds(config.videoSeconds),
            size: normalizeVideoSize(config.size, config.vquality),
            resolution: normalizeVideoResolution(config.vquality),
            ratio: videoAspectRatio(config.size),
            generateAudio: boolConfig(config.videoGenerateAudio, true),
            watermark: boolConfig(config.videoWatermark, false),
            mode: resolveVideoMode(config.videoMode, images.length),
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

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model, status: "queued" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions) {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed" as const, result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed" as const, result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed" as const, error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" as const };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function resolveVideoModelConfig(model: string, apiKey: string, signal?: AbortSignal) {
    const response = await axios.get<unknown>("/v1/models", { headers: sameOriginHeaders(apiKey), params: { media_type: "video" }, signal, withCredentials: true });
    const payload = response.data;
    const records = payload && typeof payload === "object" && !Array.isArray(payload) && (payload as { object?: unknown }).object === "list"
        ? (payload as { data?: unknown }).data
        : payload;
    if (!Array.isArray(records)) throw new Error("视频模型接口返回格式无效");
    const config = records.find((item): item is VideoModel => Boolean(item && typeof item === "object") && (!((item as VideoModel).media_type) || (item as VideoModel).media_type === "video") && publicVideoModelName(item as VideoModel) === model);
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

class RetryableVideoPollError extends Error {}

function isTransientVideoPollError(error: unknown) {
    return !axios.isCancel(error) && axios.isAxiosError(error) && !error.response;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error_message?: string; error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return responseData?.error_message || readApiErrorMessage(responseData) || error.message || statusMessage(error.response?.status, fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model, status: "queued" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions) {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed" as const, error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" as const };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed" as const, error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed" as const, result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    try {
        const payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
        if (payload.code || payload.msg || payload.error?.message) throw new Error(readApiErrorMessage(payload) || apiText("noPlayableVideo"));
    } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
    }
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function isSameOriginMediaConfig(config: Pick<AiConfig, "baseUrl">, selectedModel: string) {
    if (selectedModel.startsWith("default::")) return true;
    try {
        return new URL(config.baseUrl, window.location.origin).origin === window.location.origin;
    } catch {
        return false;
    }
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("本地轮询已停止", "AbortError"));
            return;
        }
        const abort = () => {
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", wakeOnVisible);
            reject(new DOMException("本地轮询已停止", "AbortError"));
        };
        const wakeOnVisible = () => {
            if (!document.hidden) {
                window.clearTimeout(timer);
                document.removeEventListener("visibilitychange", wakeOnVisible);
                signal?.removeEventListener("abort", abort);
                resolve();
            }
        };
        const timer = window.setTimeout(() => {
            document.removeEventListener("visibilitychange", wakeOnVisible);
            signal?.removeEventListener("abort", abort);
            resolve();
        }, ms);
        document.addEventListener("visibilitychange", wakeOnVisible);
        signal?.addEventListener("abort", abort, { once: true });
    });
}
