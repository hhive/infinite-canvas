import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMediaModels } from "@/services/api/media-models";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchMediaModels", () => {
    it("loads OpenAI-compatible image model records and uses the public id as identity", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                object: "list",
                data: [{ id: " gpt-image-2 " }, { id: "gpt-image-2" }, { id: "GPT-Image-2" }, { id: "   " }, null, "not-an-object"],
            },
        });

        await expect(fetchMediaModels("image", "sk-test")).resolves.toEqual([
            { id: "gpt-image-2", mediaType: "image", model: "gpt-image-2", displayName: "gpt-image-2", providerName: "", apiMode: "", priceQuota: 0 },
            { id: "GPT-Image-2", mediaType: "image", model: "GPT-Image-2", displayName: "GPT-Image-2", providerName: "", apiMode: "", priceQuota: 0 },
        ]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", {
            headers: { Authorization: "Bearer sk-test" },
            signal: undefined,
            withCredentials: true,
        });
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "seedance-2.0-mini", api_mode: "seedance_content_generation", price_quota: 12, max_reference_images: 3, max_reference_videos: 1, max_reference_audios: 0 }] });
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 8, mediaType: "video", model: "seedance-2.0-mini", apiMode: "seedance_content_generation", priceQuota: 12, maxReferenceImages: 3, maxReferenceVideos: 1, maxReferenceAudios: 0 }]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "video" } }));
    });

    it("uses distinct video display names as public model identities when the upstream model matches", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 15, media_type: "video", model: "seedance-2.0-mini", display_name: "seedance-2.0-mini" },
                { id: 16, media_type: "video", model: "seedance-2.0-mini", display_name: "seedance-2.0-mini-1" },
            ],
        });

        await expect(fetchMediaModels("video")).resolves.toMatchObject([
            { id: 15, model: "seedance-2.0-mini", displayName: "seedance-2.0-mini" },
            { id: 16, model: "seedance-2.0-mini-1", displayName: "seedance-2.0-mini-1" },
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

    it("rejects an image model envelope without object=list", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [{ id: "gpt-image-2" }] } });
        await expect(fetchMediaModels("image")).rejects.toThrow("图片模型接口返回格式无效");
    });
});
