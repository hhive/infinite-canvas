import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMediaModels } from "@/services/api/media-models";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchMediaModels", () => {
    it("keeps image model names as request identities and display names as labels", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                object: "list",
                data: [
                    { id: " image-public-1 ", model_name: " image-public-1 ", display_name: "完整图片显示名称" },
                    { id: "image-public-2", model_name: "image-public-2", display_name: "完整图片显示名称" },
                    { id: "image-public-1", display_name: "重复记录" },
                    { id: "   " }, null, "not-an-object",
                ],
            },
        });

        await expect(fetchMediaModels("image", "sk-test")).resolves.toEqual([
            { id: "image-public-1", mediaType: "image", model: "image-public-1", displayName: "完整图片显示名称", providerName: "", apiMode: "", priceQuota: 0 },
            { id: "image-public-2", mediaType: "image", model: "image-public-2", displayName: "完整图片显示名称", providerName: "", apiMode: "", priceQuota: 0 },
        ]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", {
            headers: { Authorization: "Bearer sk-test" },
            signal: undefined,
            withCredentials: true,
        });
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "seedance-2.0-mini", api_mode: "seedance_content_generation", price_quota: 12, max_reference_images: 4, max_reference_videos: 3, max_reference_audios: 1, supported_seconds: [15, 4, 4, 0] }] });
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 8, mediaType: "video", model: "seedance-2.0-mini", apiMode: "seedance_content_generation", priceQuota: 12, maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1, supportedSeconds: [4, 15] }]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "video" } }));
    });

    it("keeps video model names separate from display names", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                { id: 15, media_type: "video", model: "upstream-video", model_name: "video-public-1", display_name: "完整视频显示名称" },
                { id: 16, media_type: "video", model: "upstream-video", model_name: "video-public-2", display_name: "完整视频显示名称" },
            ],
        });

        await expect(fetchMediaModels("video")).resolves.toMatchObject([
            { id: 15, model: "video-public-1", displayName: "完整视频显示名称" },
            { id: 16, model: "video-public-2", displayName: "完整视频显示名称" },
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
