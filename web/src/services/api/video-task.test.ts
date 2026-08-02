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
    it("enforces reference counts from the selected video model", () => {
        expect(() => validateVideoReferenceCounts({ images: 2, videos: 1, audios: 0 }, { images: 3, videos: 0, audios: 0 })).toThrow("图片")
        expect(() => validateVideoReferenceCounts({ images: 2, videos: 1, audios: 0 }, { images: 2, videos: 1, audios: 0 })).not.toThrow()
    });
    it("resolves the server model and creates a same-origin domain request", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "upstream-video", display_name: "media-video-create", media_type: "video" }] });
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { task_id: "video-1", status: "queued", model_config_id: 7, model: "media-video-create", poll_after_ms: 1500 } });

        const created = await createVideoGenerationTask(config("media-video-create", "secret-key"), "ocean at dusk");

        expect(created).toEqual({ id: "video-1", modelConfigId: 7, model: "media-video-create", status: "queued", pollAfterMs: 1500 });
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "video" }, withCredentials: true }));
        expect(axios.post).toHaveBeenCalledWith(
            "/v1/videos",
            expect.objectContaining({ model: "media-video-create", model_config_id: 7, prompt: "ocean at dusk", reference_images: [], reference_videos: [], reference_audios: [] }),
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
