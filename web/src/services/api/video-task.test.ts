import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runModelPlugin, uploadMediaFile } = vi.hoisted(() => ({ runModelPlugin: vi.fn(), uploadMediaFile: vi.fn() }));

vi.mock("@/services/api/model-plugin", () => ({ runModelPlugin }));
vi.mock("@/services/file-storage", () => ({ getMediaBlob: vi.fn(), uploadMediaFile }));

import { GENERATED_VIDEO_LOCAL_STORE_TIMEOUT_MS, createVideoGenerationTask, pollVideoGenerationTask, previewGeneratedVideo, requestVideoGeneration, resumeVideoGenerationTask, storeGeneratedVideo, validateVideoReferenceCounts, type VideoGenerationTask } from "@/services/api/video";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

vi.mock("axios", () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        isAxiosError: vi.fn(() => false),
        isCancel: vi.fn(() => false),
    },
}));

function config(model: string, apiKey = ""): AiConfig {
    return {
        ...defaultConfig,
        apiKey,
        model: `default::${model}`,
        videoModel: `default::${model}`,
        channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey, models: [model] })),
    };
}

const task: VideoGenerationTask = { id: "video-1", modelConfigId: 7, model: "media-video-test", status: "running", pollAfterMs: 1200 };

afterEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("media video task API", () => {
    it("creates an immediate playable preview without local persistence", () => {
        expect(previewGeneratedVideo({ url: "https://media.example.test/result.mp4", mimeType: "video/mp4" })).toEqual({
            url: "https://media.example.test/result.mp4",
            storageKey: "",
            bytes: 0,
            mimeType: "video/mp4",
        });
        expect(uploadMediaFile).not.toHaveBeenCalled();
    });

    it("polls immediately when a background video page becomes visible", async () => {
        vi.useFakeTimers();
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "running", model_config_id: 7, model: task.model, poll_after_ms: 10_000 } })
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "completed", model_config_id: 7, model: task.model, result: { url: "https://media.example.test/result.mp4" } } });

        const pending = resumeVideoGenerationTask(config(task.model), task);
        const addEventListener = vi.spyOn(document, "addEventListener");
        for (let index = 0; index < 10 && !addEventListener.mock.calls.some(([type]) => type === "visibilitychange"); index += 1) await Promise.resolve();
        expect(axios.get).toHaveBeenCalledOnce();
        expect(addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
        await expect(pending).resolves.toEqual({ url: "https://media.example.test/result.mp4", mimeType: "video/mp4" });
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("runs a scripted video model without creating or persisting a Media task", async () => {
        runModelPlugin.mockResolvedValueOnce({ video_url: "https://plugin.example.test/result.mp4" });
        const scripted = config("scripted-video", "plugin-key");
        scripted.channels = scripted.channels.map((channel) => ({
            ...channel,
            baseUrl: "https://plugin.example.test/v1",
            models: [{ name: "scripted-video", capability: "video" as const, script: "return { video_url: 'https://plugin.example.test/result.mp4' };" }],
        }));
        const onTask = vi.fn();

        await expect(requestVideoGeneration(scripted, "ocean at dusk", [], [], [], { onTask })).resolves.toEqual({
            url: "https://plugin.example.test/result.mp4",
            mimeType: "video/mp4",
        });

        expect(runModelPlugin).toHaveBeenCalledWith(expect.objectContaining({ capability: "video", prompt: "ocean at dusk" }));
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
        expect(onTask).not.toHaveBeenCalled();
    });

    it("keeps the locally stored result when persistence settles before the deadline", async () => {
        const local = { url: "blob:local-video", storageKey: "video:stored", bytes: 5, mimeType: "video/mp4", width: 1280, height: 720 };
        uploadMediaFile.mockResolvedValueOnce(local);

        await expect(storeGeneratedVideo({ url: "https://media.example.test/v1/media/result.mp4" })).resolves.toBe(local);
    });

    it("falls back to the backend-owned URL when local persistence never settles", async () => {
        vi.useFakeTimers();
        uploadMediaFile.mockImplementationOnce(() => new Promise(() => undefined));

        const stored = storeGeneratedVideo({ url: "https://media.example.test/v1/media/result.mp4", mimeType: "video/mp4" });
        await vi.advanceTimersByTimeAsync(GENERATED_VIDEO_LOCAL_STORE_TIMEOUT_MS);

        await expect(stored).resolves.toEqual({ url: "https://media.example.test/v1/media/result.mp4", storageKey: "", bytes: 0, mimeType: "video/mp4" });
    });

    it("enforces each configured reference count without protocol-specific caps", () => {
        const limits = { images: 4, videos: 3, audios: 1 };
        expect(() => validateVideoReferenceCounts(limits, limits)).not.toThrow();
        expect(() => validateVideoReferenceCounts(limits, { ...limits, images: 5 })).toThrow("图片");
        expect(() => validateVideoReferenceCounts(limits, { ...limits, videos: 4 })).toThrow("视频");
        expect(() => validateVideoReferenceCounts(limits, { ...limits, audios: 2 })).toThrow("音频");
    });
    it("resolves the server model and creates a same-origin domain request", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "upstream-video", model_name: "media-video-create", display_name: "完整视频显示名称", media_type: "video" }] });
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { task_id: "video-1", status: "queued", model_config_id: 7, model: "media-video-create", poll_after_ms: 1500 } });

        const created = await createVideoGenerationTask(config("media-video-create", "secret-key"), "ocean at dusk");

        expect(created).toEqual({ id: "video-1", modelConfigId: 7, model: "media-video-create", status: "queued", pollAfterMs: 1500 });
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "video" }, withCredentials: true }));
        expect(axios.post).toHaveBeenCalledWith(
            "/v1/videos",
            expect.objectContaining({ model: "media-video-create", prompt: "ocean at dusk", charge_mode: "cnt", supports_face: true, generate_audio: true, watermark: false, reference_images: [], reference_videos: [], reference_audios: [] }),
            expect.objectContaining({ headers: { Authorization: "Bearer secret-key" }, withCredentials: true }),
        );
        expect(vi.mocked(axios.post).mock.calls[0]?.[1]).not.toHaveProperty("model_config_id");
    });

    it("uploads reference media without binding the upload to a model config", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "upstream-video", model_name: "media-video-create", media_type: "video", max_reference_images: 1 }] });
        vi.mocked(axios.post)
            .mockResolvedValueOnce({ data: { upload_token: "upload-image-1" } })
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "queued", model_config_id: 7, model: "media-video-create" } });

        await createVideoGenerationTask(
            config("media-video-create", "secret-key"),
            "ocean at dusk",
            [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        );

        expect(axios.post).toHaveBeenNthCalledWith(
            1,
            "/v1/media/uploads",
            expect.any(FormData),
            expect.not.objectContaining({ params: expect.anything() }),
        );
        expect(axios.post).toHaveBeenNthCalledWith(2, "/v1/videos", expect.objectContaining({ reference_images: ["upload-image-1"] }), expect.anything());
        expect(vi.mocked(axios.post).mock.calls[1]?.[1]).not.toHaveProperty("model_config_id");
    });

    it("normalizes legacy Mini settings to the AI Proxy contract", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "seedance-2.0-mini", media_type: "video" }] });
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { task_id: "video-1", status: "queued", model_config_id: 7, model: "seedance-2.0-mini" } });
        const legacy = { ...config("seedance-2.0-mini"), vquality: "1080p", size: "adaptive", videoSeconds: "-1", videoWatermark: "true" };

        await createVideoGenerationTask(legacy, "ocean at dusk");

        expect(axios.post).toHaveBeenCalledWith(
            "/v1/videos",
            expect.objectContaining({ resolution: "720p", size: "16:9", seconds: 4, watermark: false }),
            expect.anything(),
        );
    });

    it("rejects resolution values outside the selected model capabilities", async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: [{ id: 7, model: "seedance-2.0", media_type: "video", supported_resolutions: ["720p"] }] });
        const unsupportedResolution = { ...config("seedance-2.0"), vquality: "1080p", size: "16:9", videoSeconds: "4" };
        await expect(createVideoGenerationTask(unsupportedResolution, "test")).rejects.toThrow("分辨率")
        expect(axios.post).not.toHaveBeenCalled();
    });

    it("maps running and failed server states without provider routing", async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "running", model_config_id: 7, model: task.model, poll_after_ms: 2000 } })
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "failed", model_config_id: 7, model: task.model, error_message: "upstream rejected" } });

        await expect(pollVideoGenerationTask(config(task.model), task)).resolves.toEqual({ status: "pending", task: { ...task, pollAfterMs: 2000 } });
        await expect(pollVideoGenerationTask(config(task.model), task)).resolves.toEqual({ status: "failed", task: { ...task, status: "failed", pollAfterMs: undefined }, error: "upstream rejected" });
    });

    it("uses the backend timeout instead of a fixed polling attempt limit", async () => {
        vi.useFakeTimers();
        const createdAt = new Date(Date.now() - 1000).toISOString();
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "running", model_config_id: 7, model: task.model, poll_after_ms: 500, timeout_seconds: 3, created_at: createdAt } })
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "completed", model_config_id: 7, model: task.model, result: { url: "https://media.example.test/result.mp4" }, timeout_seconds: 3, created_at: createdAt } });
        const pending = resumeVideoGenerationTask(config(task.model), task);
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).resolves.toEqual({ url: "https://media.example.test/result.mp4", mimeType: "video/mp4" });
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("does not call the removed content endpoint when a completed task has no result URL", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { task_id: "video-1", status: "completed", model_config_id: 7, model: task.model } });

        await expect(pollVideoGenerationTask(config(task.model), task)).rejects.toThrow("视频任务已完成但没有返回可播放地址");

        expect(axios.get).toHaveBeenCalledOnce();
        expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining("/content"), expect.anything());
    });

});
