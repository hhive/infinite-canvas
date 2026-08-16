import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelVideoGenerationTask, createVideoGenerationTask, pollVideoGenerationTask, validateVideoReferenceCounts, type VideoGenerationTask } from "@/services/api/video";
import { defaultConfig } from "@/stores/use-config-store";

vi.mock("axios", () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        isAxiosError: vi.fn(() => false),
        isCancel: vi.fn(() => false),
    },
}));

function config(model: string, apiKey = "") {
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
    vi.clearAllMocks();
});

describe("media video task API", () => {
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
            expect.objectContaining({ model: "media-video-create", model_config_id: 7, prompt: "ocean at dusk", charge_mode: "per_request", supports_face: true, generate_audio: true, watermark: false, reference_images: [], reference_videos: [], reference_audios: [] }),
            expect.objectContaining({ headers: { Authorization: "Bearer secret-key" }, withCredentials: true }),
        );
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

    it("reads completed content when the task has no result URL", async () => {
        const blob = new Blob(["video"], { type: "video/mp4" });
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { task_id: "video-1", status: "completed", model_config_id: 7, model: task.model } })
            .mockResolvedValueOnce({ data: blob });

        const state = await pollVideoGenerationTask(config(task.model), task);

        expect(state.status).toBe("completed");
        if (state.status === "completed") expect(state.result.blob).toBe(blob);
        expect(axios.get).toHaveBeenLastCalledWith("/v1/videos/video-1/content", expect.objectContaining({ responseType: "blob", withCredentials: true }));
    });

    it("uses DELETE only for an explicit server cancellation", async () => {
        vi.mocked(axios.delete).mockResolvedValueOnce({ data: { task_id: "video-1", status: "canceled", model_config_id: 7, model: task.model } });

        await expect(cancelVideoGenerationTask(config(task.model), task)).resolves.toEqual({ ...task, status: "canceled", pollAfterMs: undefined });
        expect(axios.delete).toHaveBeenCalledWith("/v1/videos/video-1", expect.objectContaining({ withCredentials: true }));
    });
});
