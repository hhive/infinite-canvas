import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelImageTask, fetchChannelModels, probeImageSession, requestEdit, requestGeneration, waitForImageTask, type ImageTask } from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";

vi.mock("axios", () => ({
    default: { get: vi.fn(), post: vi.fn(), isAxiosError: vi.fn(), isCancel: vi.fn(() => false) },
}));

const runningTask: ImageTask = { task_id: "task-1", status: "running", model_config_id: 1, model: "gpt-image-2", poll_after_ms: 500 };

afterEach(() => vi.clearAllMocks());

describe("image task cancellation boundaries", () => {
    it("explicit cancellation calls the server cancel endpoint", async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { ...runningTask, status: "canceled" } });
        await cancelImageTask("task-1", "sk-test");
        expect(axios.post).toHaveBeenCalledWith("/v1/images/tasks/task-1/cancel", undefined, expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }));
    });

    it("preserves a completed server result when cancellation loses the race", async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { ...runningTask, status: "completed" } });
        await expect(cancelImageTask("task-1")).resolves.toMatchObject({ status: "completed" });
    });

    it("surfaces cancellation failures instead of fabricating canceled", async () => {
        vi.mocked(axios.post).mockRejectedValue(new Error("network down"));
        await expect(cancelImageTask("task-1")).rejects.toThrow("network down");
    });

    it("detaching local polling never calls the cancel endpoint", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const pending = waitForImageTask(runningTask, "", { signal: controller.signal });
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
        await expect(probeImageSession("sk-test")).resolves.toBe(true);
        expect(axios.get).toHaveBeenCalledWith("/api/me", { headers: { Authorization: "Bearer sk-test" }, withCredentials: true });
    });

    it("uses the cookie session when no key exists", async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: {} });
        await expect(probeImageSession()).resolves.toBe(true);
        expect(axios.get).toHaveBeenCalledWith("/api/me", { headers: undefined, withCredentials: true });
    });
});

describe("image edit task payload", () => {
    it("submits the logical display name with references and a mask", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 7, model: "gpt-image-2-1k", display_name: "gpt-image-2" }] });
        await fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-edit",
                status: "completed",
                model_config_id: 7,
                model: "gpt-image-2-1k",
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

        await expect(requestEdit(config, "edit", [reference], mask)).resolves.toHaveLength(1);

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith(
            "/v1/images/generations/async",
            expect.objectContaining({
                model: "gpt-image-2",
                model_display_name: "gpt-image-2",
                images: [{ image_url: reference.dataUrl }],
                mask: { image_url: mask.dataUrl },
            }),
            expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }),
        );
    });
});

describe("image model config mapping", () => {
    it("submits a logical display name when only suffixed internal models exist", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 17, model: "gpt-image-2-4k", display_name: "gpt-image-2" }] });
        await fetchChannelModels({ id: "display-name", name: "display-name", baseUrl: "/v1", apiKey: "", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-display-name",
                status: "completed",
                model_config_id: 17,
                model: "gpt-image-2-4k",
                poll_after_ms: 500,
                result: { data: [{ b64_json: "aW1hZ2U=" }] },
            },
        });
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-2"] })),
            model: "default::gpt-image-2",
            imageModel: "default::gpt-image-2",
        };

        await expect(requestGeneration(config, "draw")).resolves.toHaveLength(1);
        expect(axios.post).toHaveBeenCalledWith(
            "/v1/images/generations/async",
            expect.objectContaining({ model: "gpt-image-2", model_display_name: "gpt-image-2" }),
            expect.anything(),
        );
    });

    it("keeps a suffixed internal model on the exact request path", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 18, model: "gpt-image-exact-1k", display_name: "gpt-image-exact" }] });
        await fetchChannelModels({ id: "exact-name", name: "exact-name", baseUrl: "/v1", apiKey: "", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-exact-model",
                status: "completed",
                model_config_id: 18,
                model: "gpt-image-exact-1k",
                poll_after_ms: 500,
                result: { data: [{ b64_json: "aW1hZ2U=" }] },
            },
        });
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-exact-1k"] })),
            model: "default::gpt-image-exact-1k",
            imageModel: "default::gpt-image-exact-1k",
        };

        await expect(requestGeneration(config, "draw")).resolves.toHaveLength(1);
        const requestBody = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>;
        expect(requestBody.model).toBe("gpt-image-exact-1k");
        expect(requestBody).not.toHaveProperty("model_display_name");
    });

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

        await expect(requestGeneration(config, "draw")).resolves.toHaveLength(1);
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

        await expect(requestGeneration(config, "draw")).rejects.toThrow("当前模型 gpt-image-missing 没有可用的图片站配置");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
