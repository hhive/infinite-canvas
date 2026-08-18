import { describe, expect, it } from "vitest";

import { mergeFetchedChannelModels, shouldInitializeClientRoot } from "@/components/layout/client-root-init";
import { defaultConfig, selectableModelsByCapability } from "@/stores/use-config-store";

describe("shouldInitializeClientRoot", () => {
    it("does not initialize API key prompts on the public model marketplace", () => {
        expect(shouldInitializeClientRoot("/models")).toBe(false);
        expect(shouldInitializeClientRoot("/")).toBe(true);
        expect(shouldInitializeClientRoot("/image")).toBe(true);
    });

    it("keeps restored video models when the generic image model request finishes later", () => {
        const videoModel = { id: 9, mediaType: "video" as const, model: "seedance-video", displayName: "Seedance", providerName: "Provider", apiMode: "videos", priceQuota: 0 };
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [{ name: videoModel.model, capability: "video" as const }] }],
            models: [`default::${videoModel.model}`],
            videoModels: [`default::${videoModel.model}`],
            videoModel: `default::${videoModel.model}`,
        };

        const merged = mergeFetchedChannelModels(config, ["gpt-image-2"]);

        expect(selectableModelsByCapability(merged, "video")).toEqual([`default::${videoModel.model}`]);
        expect(merged.videoModel).toBe(`default::${videoModel.model}`);
    });
});
