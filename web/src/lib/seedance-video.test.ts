import { describe, expect, it } from "vitest";

import {
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceDurationOptions,
    seedanceRatioOptions,
    seedanceReferenceEmptyHint,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";

describe("Seedance AI Proxy contract", () => {
    it("keeps only upload-size limits in the client contract", () => {
        expect(SEEDANCE_REFERENCE_LIMITS).toEqual({
            imageMaxBytes: 20 * 1024 * 1024,
            videoMaxBytes: 200 * 1024 * 1024,
            audioMaxBytes: 50 * 1024 * 1024,
        });
        expect(seedanceReferenceEmptyHint("image", 2)).toBe("暂无参考图，最多 2 张，单张 20MB 内");
        expect(seedanceReferenceEmptyHint("video", 1)).toBe("暂无参考视频，最多 1 个，单个 200MB 内");
        expect(seedanceReferenceEmptyHint("audio", 0)).toBe("暂无参考音频，最多 0 个，mp3/wav，单个 50MB 内");
    });

    it("removes adaptive ratio and smart duration from the selectable contract", () => {
        expect(seedanceRatioOptions.map((item) => item.value)).not.toContain("adaptive");
        expect(seedanceDurationOptions).not.toContain(-1);
        expect(normalizeSeedanceRatio("adaptive")).toBe("16:9");
        expect(normalizeSeedanceRatio("0x0")).toBe("16:9");
        expect(normalizeSeedanceDuration("-1")).toBe(4);
    });

    it("limits Mini and Fast to 720p while preserving the base model matrix", () => {
        expect(normalizeSeedanceResolution("1080p", "seedance-2.0-mini")).toBe("720p");
        expect(normalizeSeedanceResolution("1080p", "seedance-2.0-fast")).toBe("720p");
        expect(normalizeSeedanceResolution("1080p", "seedance-2.0")).toBe("1080p");
    });

    it("accepts a short reference video and rejects only the documented upper bounds", () => {
        expect(seedanceVideoReferenceError([{ id: "v", name: "v", type: "video/mp4", url: "https://media.example/v.mp4", durationMs: 1000 }])).toBe("");
        expect(seedanceVideoReferenceError([{ id: "v", name: "v", type: "video/mp4", url: "https://media.example/v.mp4", durationMs: 16000 }])).toContain("15 秒");
        expect(seedanceVideoReferenceError([{ id: "v", name: "v", type: "video/mp4", url: "https://media.example/v.mp4", bytes: 201 * 1024 * 1024 }])).toContain("200MB");
    });
});
