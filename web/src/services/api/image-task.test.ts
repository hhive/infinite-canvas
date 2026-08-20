import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runModelPlugin } = vi.hoisted(() => ({ runModelPlugin: vi.fn() }));
vi.mock("@/services/api/model-plugin", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/api/model-plugin")>()),
    runModelPlugin,
}));

import { cancelImageTask, fetchChannelModels, fetchImageModels, probeImageSession, requestEdit, requestGeneration, waitForImageTask, type ImageTask } from "@/services/api/image";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
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

function imageRequestConfig(model: string): AiConfig {
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

function openAIModelList(...ids: string[]) {
    return {
        object: "list",
        data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "media-playground" })),
    };
}

afterEach(() => vi.clearAllMocks());

describe("scripted image model", () => {
    it("uses the configured plugin script without submitting a Media image task", async () => {
        runModelPlugin.mockResolvedValueOnce(["data:image/png;base64,aW1hZ2U="]);
        const scripted = imageRequestConfig("scripted-image");
        scripted.channels = scripted.channels.map((channel) => ({
            ...channel,
            baseUrl: "https://plugin.example.test/v1",
            models: [{ name: "scripted-image", capability: "image" as const, script: "return ['data:image/png;base64,aW1hZ2U='];" }],
        }));

        await expect(requestGeneration(scripted, "draw a harbor")).resolves.toMatchObject([{ dataUrl: "data:image/png;base64,aW1hZ2U=" }]);

        expect(runModelPlugin).toHaveBeenCalledWith(expect.objectContaining({ capability: "image", prompt: "draw a harbor" }));
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });
});

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

describe("channel model discovery", () => {
    it("uses the Gemini v1beta models endpoint for Gemini channels", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-2.5-flash" }] } });

        await expect(fetchChannelModels({ id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "gemini-key", apiFormat: "gemini", models: [] })).resolves.toEqual(["gemini-2.5-flash"]);
        expect(axios.get).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models", {
            headers: { "x-goog-api-key": "gemini-key", "Content-Type": "application/json" },
            withCredentials: true,
        });
    });
});

describe("image edit task payload", () => {
    it("submits the public model name with references and a mask", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList("gpt-image-2") });
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
        expect(axios.post).toHaveBeenCalledWith("/v1/images/edits/async", expect.any(FormData), expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }));
        const form = vi.mocked(axios.post).mock.calls[0]?.[1] as FormData;
        expect(form.get("model")).toBe("gpt-image-2");
        expect(form.get("prompt")).toContain("edit");
        expect(form.getAll("image[]")).toHaveLength(1);
        expect(form.get("mask")).toBeInstanceOf(Blob);
    });

    it("normalizes declared MIME conflicts by signature before the async task POST", async () => {
        const model = "gpt-image-signature-boundary";
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList(model) });
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

        const requestBody = vi.mocked(axios.post).mock.calls[0]?.[1] as FormData;
        expect(requestBody.getAll("image[]")).toHaveLength(3);
        expect((requestBody.getAll("image[]")[0] as Blob).type).toBe("image/png");
        expect((requestBody.getAll("image[]")[1] as Blob).type).toBe("image/jpeg");
        expect((requestBody.getAll("image[]")[2] as Blob).type).toBe("image/webp");
        expect((requestBody.get("mask") as Blob).type).toBe("image/png");
    });

    it("rejects an unsupported signature before posting an async image task", async () => {
        const model = "gpt-image-invalid-signature";
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList(model) });
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
            expect(atobCallsAfterPrepare).toBe(4);
            expect(sliceCallsAfterPrepare).toBe(2);

            const model = "gpt-image-prepared-references";
            vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList(model) });
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
    it("returns trimmed unique public ids from an OpenAI-compatible model list", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { object: "list", data: [{ id: " gpt-image-2 " }, { id: "gpt-image-2" }, { id: "GPT-Image-2" }, { id: "  " }, null] } });
        await expect(fetchImageModels({ baseUrl: "/v1", apiKey: "", apiFormat: "openai" })).resolves.toEqual(["gpt-image-2", "GPT-Image-2"]);
    });

    it("submits the public name for generation", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList("gpt-image-2") });
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
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList("gpt-image-exact-1k") });
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
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList("gpt-image-refresh") });
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
        vi.mocked(axios.get).mockResolvedValueOnce({ data: openAIModelList("other-image-model") });
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
