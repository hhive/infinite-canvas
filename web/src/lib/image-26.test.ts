import { describe, expect, it } from "vitest";

import { imageMimeTypeForFormat, normalizeImageComplexity, normalizeImageFrameCount, normalizeImageFrameDurationMs, normalizeImageOutputFormat, supportsImage26 } from "@/lib/image-26";

describe("image 2.6 capability", () => {
    it("trusts the media catalog api_mode when the model is listed", () => {
        expect(supportsImage26("default::gpt-image-2.6-flare", [{ model: "gpt-image-2.6-flare", apiMode: "images_2_6" }])).toBe(true);
        expect(supportsImage26("gpt-image-2.6-flare", [{ model: "gpt-image-2.6-flare", apiMode: "images" }])).toBe(false);
        expect(supportsImage26("gpt-image-2.5-flare", [{ model: "gpt-image-2.5-flare", apiMode: "images" }])).toBe(false);
    });

    it("falls back to the model name for direct channels", () => {
        expect(supportsImage26("gpt-image-2.6-sunburst", [])).toBe(true);
        expect(supportsImage26("default::GPT-Image-2.6-flare", [])).toBe(true);
        expect(supportsImage26("gpt-image-2.5-flare", [])).toBe(false);
        expect(supportsImage26("gpt-6-astra", [])).toBe(false);
    });

    it("normalizes complexity and output format", () => {
        expect(normalizeImageComplexity(undefined)).toBe("");
        expect(normalizeImageComplexity("auto")).toBe("");
        expect(normalizeImageComplexity(" HIGH ")).toBe("high");
        expect(normalizeImageComplexity("xhigh")).toBe("");
        expect(normalizeImageOutputFormat(undefined)).toBe("png");
        expect(normalizeImageOutputFormat("GIF")).toBe("gif");
        expect(normalizeImageOutputFormat("svg")).toBe("svg");
        expect(normalizeImageOutputFormat("jpeg")).toBe("png");
    });

    it("clamps GIF frame parameters", () => {
        expect(normalizeImageFrameCount(undefined)).toBe(9);
        expect(normalizeImageFrameCount("1")).toBe(2);
        expect(normalizeImageFrameCount("12")).toBe(12);
        expect(normalizeImageFrameCount("99")).toBe(16);
        expect(normalizeImageFrameDurationMs(undefined)).toBe(200);
        expect(normalizeImageFrameDurationMs("5")).toBe(20);
        expect(normalizeImageFrameDurationMs("1200")).toBe(1200);
        expect(normalizeImageFrameDurationMs("9000")).toBe(2000);
    });

    it("maps backend format values to result MIME types", () => {
        expect(imageMimeTypeForFormat(undefined)).toBe("image/png");
        expect(imageMimeTypeForFormat("png")).toBe("image/png");
        expect(imageMimeTypeForFormat("jpeg")).toBe("image/jpeg");
        expect(imageMimeTypeForFormat("webp")).toBe("image/webp");
        expect(imageMimeTypeForFormat("gif")).toBe("image/gif");
        expect(imageMimeTypeForFormat("svg")).toBe("image/svg+xml");
    });
});
