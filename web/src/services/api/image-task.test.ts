import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as imageApi from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";

vi.mock("axios", () => ({
    default: { get: vi.fn(), post: vi.fn(), isAxiosError: vi.fn(), isCancel: vi.fn(() => false) },
}));

const runningTask: imageApi.ImageTask = { task_id: "task-1", status: "running", model_config_id: 1, model: "gpt-image-2", poll_after_ms: 500 };

afterEach(() => vi.clearAllMocks());

describe("image task cancellation boundaries", () => {
    it("does not expose server-side cancellation", () => {
        expect(imageApi).not.toHaveProperty("cancelImageTask");
    });

    it("detaching local polling never calls the cancel endpoint", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const pending = imageApi.waitForImageTask(runningTask, "", { signal: controller.signal });
        await Promise.resolve();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe("image session readiness", () => {
    it("uses a bearer header when a manual key exists", async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: {} });
        await expect(imageApi.probeImageSession("sk-test")).resolves.toBe(true);
        expect(axios.get).toHaveBeenCalledWith("/api/me", { headers: { Authorization: "Bearer sk-test" }, withCredentials: true });
    });

    it("uses the cookie session when no key exists", async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: {} });
        await expect(imageApi.probeImageSession()).resolves.toBe(true);
        expect(axios.get).toHaveBeenCalledWith("/api/me", { headers: undefined, withCredentials: true });
    });
});

describe("image edit task payload", () => {
    it("submits references and a mask through one async generation task", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "gpt-image-2" }] });
        await imageApi.fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-edit",
                status: "completed",
                model_config_id: 7,
                model: "gpt-image-2",
                poll_after_ms: 500,
                result: { data: [{ b64_json: "aW1hZ2U=" }] },
            },
        });
        const config = {
            ...defaultConfig,
            apiKey: "sk-test",
            channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-test" })),
            model: "default::gpt-image-2",
            imageModel: "default::gpt-image-2",
            size: "1024x1024",
            quality: "low",
            count: "1",
        };
        const reference = { id: "ref-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,cmVm" };
        const mask = { id: "mask-1", name: "mask.png", type: "image/png", dataUrl: "data:image/png;base64,bWFzaw==" };

        await expect(imageApi.requestEdit(config, "edit", [reference], mask)).resolves.toHaveLength(1);

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith(
            "/v1/images/generations/async",
            expect.objectContaining({
                model: "gpt-image-2",
                images: [{ image_url: reference.dataUrl }],
                mask: { image_url: mask.dataUrl },
            }),
            expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }),
        );
    });
});

describe("image model config mapping", () => {
    it("refreshes models once before generation when the mapping is missing", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 9, model: "gpt-image-refresh" }] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-refresh",
                status: "completed",
                model_config_id: 9,
                model: "gpt-image-refresh",
                poll_after_ms: 500,
                result: { data: [{ b64_json: "aW1hZ2U=" }] },
            },
        });
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-refresh"] })),
            model: "default::gpt-image-refresh",
            imageModel: "default::gpt-image-refresh",
        };

        await expect(imageApi.requestGeneration(config, "draw")).resolves.toHaveLength(1);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith("/v1/images/generations/async", expect.objectContaining({ model: "gpt-image-refresh" }), expect.anything());
    });

    it("reports a missing server model after a successful refresh", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 10, model: "other-image-model" }] });
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-missing"] })),
            model: "default::gpt-image-missing",
            imageModel: "default::gpt-image-missing",
        };

        await expect(imageApi.requestGeneration(config, "draw")).rejects.toThrow("当前模型 gpt-image-missing 没有可用的图片站配置");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
