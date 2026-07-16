import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mediaModelsApi from "@/services/api/media-models";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchMediaModels", () => {
    it("loads and validates image models with the media filter", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 2, media_type: "image", model: "gpt-image-2", display_name: "GPT Image", provider_name: "openai", api_mode: "images" },
                { id: 2, media_type: "image", model: "duplicate" },
                { id: 7, media_type: "video", model: "wrong-capability" },
                { id: "bad", media_type: "image", model: "invalid" },
            ],
        });

        const models = await mediaModelsApi.fetchMediaModels("image", "sk-test");
        expect(models).toEqual([{ id: 2, mediaType: "image", model: "gpt-image-2", displayName: "GPT Image", providerName: "openai", priceQuota: 0 }]);
        expect(models[0]).not.toHaveProperty("apiMode");
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "image" }, headers: { Authorization: "Bearer sk-test" }, withCredentials: true }));
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "seedance-2.0-mini", api_mode: "openai_videos_v2", price_quota: 12 }] });
        const models = await mediaModelsApi.fetchMediaModels("video");
        expect(models).toMatchObject([{ id: 8, mediaType: "video", model: "seedance-2.0-mini", priceQuota: 12 }]);
        expect(models[0]).not.toHaveProperty("apiMode");
    });

    it("keeps the first image record for duplicate normalized model names", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 11, media_type: "image", model: " gpt-image-2 ", display_name: "Primary", provider_name: "provider-a", api_mode: "images", price_quota: 8 },
                { id: 12, media_type: "image", model: "gpt-image-2", display_name: "Fallback", provider_name: "provider-b", api_mode: "responses", price_quota: 3 },
            ],
        });

        const models = await mediaModelsApi.fetchMediaModels("image");
        expect(models).toEqual([{ id: 11, mediaType: "image", model: "gpt-image-2", displayName: "Primary", providerName: "provider-a", priceQuota: 8 }]);
        expect(models[0]).not.toHaveProperty("apiMode");
    });

    it("keeps case-distinct model names separate", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 13, media_type: "image", model: "GPT-Image-2" },
                { id: 14, media_type: "image", model: "gpt-image-2" },
            ],
        });

        await expect(mediaModelsApi.fetchMediaModels("image")).resolves.toMatchObject([
            { id: 13, model: "GPT-Image-2" },
            { id: 14, model: "gpt-image-2" },
        ]);
    });

    it.each([
        ["negative", -1],
        ["NaN", Number.NaN],
        ["positive infinity", Number.POSITIVE_INFINITY],
        ["undefined", undefined],
        ["null", null],
        ["non-numeric string", "not-a-number"],
    ])("normalizes %s video price to zero", async (_label, priceQuota) => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 9, model: "video-invalid-price", price_quota: priceQuota }] });
        await expect(mediaModelsApi.fetchMediaModels("video")).resolves.toMatchObject([{ id: 9, priceQuota: 0 }]);
    });

    it("normalizes negative zero to ordinary zero", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 10, model: "video-negative-zero", price_quota: -0 }] });
        const [model] = await mediaModelsApi.fetchMediaModels("video");
        expect(model.priceQuota).toBe(0);
        expect(Object.is(model.priceQuota, -0)).toBe(false);
    });

    it("rejects a non-array response", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { error: "bad response" } });
        await expect(mediaModelsApi.fetchMediaModels("image")).rejects.toThrow("图片模型接口返回格式无效");
    });
});
