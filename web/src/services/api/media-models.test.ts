import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMediaModels } from "@/services/api/media-models";

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

        await expect(fetchMediaModels("image", "sk-test")).resolves.toEqual([
            { id: 2, mediaType: "image", model: "gpt-image-2", displayName: "GPT Image", providerName: "openai", apiMode: "images", priceQuota: 0 },
        ]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "image" }, headers: { Authorization: "Bearer sk-test" }, withCredentials: true }));
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "seedance-2.0-mini", api_mode: "openai_videos_v2", price_quota: 12 }] });
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 8, mediaType: "video", model: "seedance-2.0-mini", apiMode: "openai_videos_v2", priceQuota: 12 }]);
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
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 9, priceQuota: 0 }]);
    });

    it("normalizes negative zero to ordinary zero", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 10, model: "video-negative-zero", price_quota: -0 }] });
        const [model] = await fetchMediaModels("video");
        expect(model.priceQuota).toBe(0);
        expect(Object.is(model.priceQuota, -0)).toBe(false);
    });

    it("rejects a non-array response", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { error: "bad response" } });
        await expect(fetchMediaModels("image")).rejects.toThrow("图片模型接口返回格式无效");
    });
});
