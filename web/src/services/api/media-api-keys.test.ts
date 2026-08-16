import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMediaAPIKeys, switchMediaAPIKey } from "@/services/api/media-api-keys";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("media session API keys", () => {
    it("normalizes the server list without accepting a full API key", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [
            { id: 8, name: "图片", mask: "sk-****1234", group_name: "绘图组", image_model_count: 6, video_model_count: 0, selected: true, key: "must-not-leak" },
            { id: 9, name: "视频", mask: "sk-****5678", group_name: "", image_model_count: 0, video_model_count: 4 },
        ] } });

        const result = await fetchMediaAPIKeys();
        expect(result).toEqual([
            { id: 8, name: "图片", maskedKey: "sk-****1234", groupName: "绘图组", imageModelCount: 6, videoModelCount: 0, current: true },
            { id: 9, name: "视频", maskedKey: "sk-****5678", groupName: "未分组", imageModelCount: 0, videoModelCount: 4, current: false },
        ]);
        expect(JSON.stringify(result)).not.toContain("must-not-leak");
        expect(axios.get).toHaveBeenCalledWith("/api/session/api-keys", { withCredentials: true, signal: undefined });
    });

    it("switches only by opaque key id with Cookie credentials", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { selected_api_key_id: 12 } });
        await switchMediaAPIKey(12);
        expect(axios.post).toHaveBeenCalledWith("/api/session/api-key", { api_key_id: 12 }, { withCredentials: true, signal: undefined });
    });
});
