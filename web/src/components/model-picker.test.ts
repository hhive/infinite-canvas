import { describe, expect, it } from "vitest";

import { mediaModelLabel } from "@/components/model-picker";

describe("mediaModelLabel", () => {
    it("shows the per-call price for video models", () => {
        expect(mediaModelLabel([{ mediaType: "video", model: "video-1", displayName: "Video", providerName: "OpenAI", priceQuota: 12 }], "video-1")).toBe("Video · OpenAI · 12 / 次");
    });

    it("keeps image model labels unchanged", () => {
        expect(mediaModelLabel([{ mediaType: "image", model: "image-1", displayName: "Image", providerName: "OpenAI", priceQuota: 12 }], "image-1")).toBe("Image · OpenAI");
    });
});
