import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelImageTask, fetchChannelModels, fetchImageModels, probeImageSession, requestEdit, requestGeneration, waitForImageTask, type ImageTask } from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

vi.mock("axios", () => ({
    default: { get: vi.fn(), post: vi.fn(), isAxiosError: vi.fn(), isCancel: vi.fn(() => false) },
}));

const runningTask: ImageTask = { task_id: "task-1", status: "running", model_config_id: 1, model: "gpt-image-2", poll_after_ms: 500 };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x01]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const FORMAT_ERROR_MESSAGE = "图片格式无效，仅支持有效的 PNG、JPEG 或 WebP 图片";

function dataUrl(mimeType: string, bytes: Uint8Array) {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function imageRequestConfig(model: string) {
    return {
        ...defaultConfig,
        apiKey: "sk-test",
        channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-test", models: [model] })),
        model: `default::${model}`,
        imageModel: `default::${model}`,
        size: "1024x1024",
        quality: "low",
        count: "1",
    };
}

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
    it("submits the public model name with references and a mask", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: "gpt-image-2" }] });
        await fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-edit",
                status: "completed",
                model_config_id: 0,
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
        const reference = { id: "ref-1", name: "reference.png", type: "image/png", dataUrl: dataUrl("image/png", PNG_BYTES) };
        const mask = { id: "mask-1", name: "mask.jpg", type: "image/jpeg", dataUrl: dataUrl("image/jpeg", JPEG_BYTES) };

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

    it("normalizes declared MIME conflicts by signature before the async task POST", async () => {
        const model = "gpt-image-signature-boundary";
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model }] });
        await fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-signature-boundary",
                status: "completed",
                model_config_id: 0,
                model,
                poll_after_ms: 500,
                result: { data: [{ b64_json: "aW1hZ2U=" }] },
            },
        });
        const references = [
            { id: "png", name: "declared-gif.png", type: "image/gif", dataUrl: dataUrl("image/gif", PNG_BYTES) },
            { id: "jpeg", name: "declared-png.jpg", type: "image/png", dataUrl: dataUrl("image/png", JPEG_BYTES) },
            { id: "webp", name: "declared-binary.webp", type: "application/octet-stream", dataUrl: dataUrl("application/octet-stream", WEBP_BYTES) },
        ];
        const mask = { id: "mask", name: "mask.png", type: "image/gif", dataUrl: dataUrl("image/gif", PNG_BYTES) };

        await expect(requestEdit(imageRequestConfig(model), "edit", references, mask)).resolves.toHaveLength(1);

        const requestBody = vi.mocked(axios.post).mock.calls[0]?.[1] as { images: Array<{ image_url: string }>; mask: { image_url: string } };
        expect(requestBody.images).toEqual([{ image_url: dataUrl("image/png", PNG_BYTES) }, { image_url: dataUrl("image/jpeg", JPEG_BYTES) }, { image_url: dataUrl("image/webp", WEBP_BYTES) }]);
        expect(requestBody.mask).toEqual({ image_url: dataUrl("image/png", PNG_BYTES) });
    });

    it("rejects an unsupported signature before posting an async image task", async () => {
        const model = "gpt-image-invalid-signature";
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model }] });
        await fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
        const reference = { id: "fake-png", name: "fake.png", type: "image/png", dataUrl: dataUrl("image/png", GIF_BYTES) };

        await expect(requestEdit(imageRequestConfig(model), "edit", [reference])).rejects.toThrow(FORMAT_ERROR_MESSAGE);

        expect(axios.post).not.toHaveBeenCalled();
    });

    it("reuses a prepared reference array across repeated image edit requests without decoding or copying again", async () => {
        const imageApi = (await import("@/services/api/image")) as typeof import("@/services/api/image") & {
            prepareImageEditReferences?: (references: ReferenceImage[]) => Promise<ReferenceImage[]>;
        };
        expect(imageApi.prepareImageEditReferences).toBeTypeOf("function");
        if (!imageApi.prepareImageEditReferences) return;
        const references: ReferenceImage[] = [
            { id: "prepared-png", name: "prepared.png", type: "image/gif", dataUrl: dataUrl("image/gif", PNG_BYTES) },
            { id: "prepared-webp", name: "prepared.webp", type: "application/octet-stream", dataUrl: dataUrl("application/octet-stream", WEBP_BYTES) },
        ];
        const atobSpy = vi.spyOn(globalThis, "atob");
        const sliceSpy = vi.spyOn(Blob.prototype, "slice");
        try {
            const prepared = await imageApi.prepareImageEditReferences(references);
            const atobCallsAfterPrepare = atobSpy.mock.calls.length;
            const sliceCallsAfterPrepare = sliceSpy.mock.calls.length;

            expect(prepared).not.toBe(references);
            expect(prepared.map((item) => item.dataUrl)).toEqual([dataUrl("image/png", PNG_BYTES), dataUrl("image/webp", WEBP_BYTES)]);
            expect(atobCallsAfterPrepare).toBe(2);
            expect(sliceCallsAfterPrepare).toBe(2);

            const model = "gpt-image-prepared-references";
            vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model }] });
            await fetchChannelModels({ id: "default", name: "default", baseUrl: "/v1", apiKey: "sk-test", apiFormat: "openai", models: [] });
            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    task_id: "task-prepared-references",
                    status: "completed",
                    model_config_id: 0,
                    model,
                    poll_after_ms: 500,
                    result: { data: [{ b64_json: "aW1hZ2U=" }] },
                },
            });

            await requestEdit(imageRequestConfig(model), "first edit", prepared);
            await requestEdit(imageRequestConfig(model), "second edit", prepared);

            expect(axios.post).toHaveBeenCalledTimes(2);
            expect(atobSpy).toHaveBeenCalledTimes(atobCallsAfterPrepare);
            expect(sliceSpy).toHaveBeenCalledTimes(sliceCallsAfterPrepare);
        } finally {
            atobSpy.mockRestore();
            sliceSpy.mockRestore();
        }
    });
});

describe("image model availability", () => {
    it("returns trimmed unique public names from model-only records", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: " gpt-image-2 " }, { model: "gpt-image-2" }, { model: "GPT-Image-2" }, { model: "  " }, null] });
        await expect(fetchImageModels({ baseUrl: "/v1", apiKey: "", apiFormat: "openai" })).resolves.toEqual(["gpt-image-2", "GPT-Image-2"]);
    });

    it("submits the public name for generation", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: "gpt-image-2" }] });
        await fetchChannelModels({ id: "display-name", name: "display-name", baseUrl: "/v1", apiKey: "", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-display-name",
                status: "completed",
                model_config_id: 0,
                model: "gpt-image-2",
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
        expect(axios.post).toHaveBeenCalledWith("/v1/images/generations/async", expect.objectContaining({ model: "gpt-image-2", model_display_name: "gpt-image-2" }), expect.anything());
    });

    it("always includes the public name for generation", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: "gpt-image-exact-1k" }] });
        await fetchChannelModels({ id: "exact-name", name: "exact-name", baseUrl: "/v1", apiKey: "", apiFormat: "openai", models: [] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-exact-model",
                status: "completed",
                model_config_id: 0,
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
        expect(requestBody.model_display_name).toBe("gpt-image-exact-1k");
    });

    it("refreshes models once before generation when the mapping is missing", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: "gpt-image-refresh" }] });
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                task_id: "task-refresh",
                status: "completed",
                model_config_id: 0,
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
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ model: "other-image-model" }] });
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-missing"] })),
            model: "default::gpt-image-missing",
            imageModel: "default::gpt-image-missing",
        };

        await expect(requestGeneration(config, "draw")).rejects.toThrow("当前模型 gpt-image-missing 没有可用的图片站配置");
        expect(axios.post).not.toHaveBeenCalled();
    });

    it("reports the refresh failure when availability cannot be loaded", async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error("model service unavailable"));
        const config = {
            ...defaultConfig,
            channels: defaultConfig.channels.map((channel) => ({ ...channel, models: ["gpt-image-refresh-failed"] })),
            model: "default::gpt-image-refresh-failed",
            imageModel: "default::gpt-image-refresh-failed",
        };

        await expect(requestGeneration(config, "draw")).rejects.toThrow("model service unavailable");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
