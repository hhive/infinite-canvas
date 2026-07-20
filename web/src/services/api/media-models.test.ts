import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMediaModels } from "@/services/api/media-models";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchMediaModels", () => {
    it("loads model-only image records and uses the public name as identity", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [{ model: " gpt-image-2 " }, { model: "gpt-image-2" }, { model: "GPT-Image-2" }, { model: "   " }, null, "not-an-object"],
        });

        await expect(fetchMediaModels("image", "sk-test")).resolves.toEqual([
            { id: "gpt-image-2", mediaType: "image", model: "gpt-image-2", displayName: "gpt-image-2", providerName: "", apiMode: "", priceQuota: 0 },
            { id: "GPT-Image-2", mediaType: "image", model: "GPT-Image-2", displayName: "GPT-Image-2", providerName: "", apiMode: "", priceQuota: 0 },
        ]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "image" }, headers: { Authorization: "Bearer sk-test" }, withCredentials: true }));
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "seedance-2.0-mini", api_mode: "openai_videos_v2", price_quota: 12 }] });
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 8, mediaType: "video", model: "seedance-2.0-mini", apiMode: "openai_videos_v2", priceQuota: 12 }]);
    });

    it("keeps video records distinct when only their display names match", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 15, media_type: "video", model: "video-fast", display_name: "Video" },
                { id: 16, media_type: "video", model: "video-quality", display_name: "Video" },
            ],
        });

        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ model: "video-fast" }, { model: "video-quality" }]);
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
