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
            { id: 2, mediaType: "image", model: "gpt-image-2", displayName: "GPT Image", providerName: "openai", apiMode: "images" },
        ]);
        expect(axios.get).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ params: { media_type: "image" }, headers: { Authorization: "Bearer sk-test" }, withCredentials: true }));
    });

    it("accepts video responses without a redundant media_type field", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 8, model: "video-ds-2.0", api_mode: "seedance_content_generation" }] });
        await expect(fetchMediaModels("video")).resolves.toMatchObject([{ id: 8, mediaType: "video", model: "video-ds-2.0", apiMode: "seedance_content_generation" }]);
    });

    it("rejects a non-array response", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { error: "bad response" } });
        await expect(fetchMediaModels("image")).rejects.toThrow("图片模型接口返回格式无效");
    });
});
