import { describe, expect, it } from "vitest";

import { buildImageGenerationMetadata } from "@/lib/canvas/canvas-node-factory";
import { defaultConfig } from "@/stores/use-config-store";

describe("image generation metadata", () => {
    it("persists 2.6 settings on the generated node", () => {
        const metadata = buildImageGenerationMetadata("generation", { ...defaultConfig, model: "default::gpt-image-2.6-flare", imageComplexity: "high", imageFormat: "gif", imageFrameCount: "12", imageFrameDurationMs: "400" }, 3, []);

        expect(metadata).toMatchObject({ complexity: "high", format: "gif", frameCount: 12, frameDurationMs: 400, count: 3 });
    });

    it("records auto complexity and png for other models", () => {
        const metadata = buildImageGenerationMetadata("generation", { ...defaultConfig, imageComplexity: "auto", imageFormat: "png" }, 1, []);

        expect(metadata).toMatchObject({ complexity: "auto", format: "png", count: 1 });
        expect(metadata.frameCount).toBeUndefined();
    });

    it("clamps gif frame parameters to the supported range", () => {
        const metadata = buildImageGenerationMetadata("generation", { ...defaultConfig, imageFormat: "gif", imageFrameCount: "1", imageFrameDurationMs: "9000" }, 1, []);

        expect(metadata).toMatchObject({ frameCount: 2, frameDurationMs: 2000 });
    });
});
