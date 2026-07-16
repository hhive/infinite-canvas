import { beforeEach, describe, expect, it } from "vitest";

import type { MediaModel } from "@/services/api/media-models";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

beforeEach(() => {
    useConfigStore.setState({
        config: {
            ...defaultConfig,
            apiKey: "sk-top-level-old",
            channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-channel-old" })),
        },
        mediaModels: { image: [], video: [] },
        mediaModelStatus: { image: "idle", video: "idle" },
        mediaModelErrors: { image: "", video: "" },
        mediaModelsRefreshedAt: { image: "", video: "" },
    });
});

function imageModel(id: number, model: string, displayName = model): MediaModel {
    return { id, mediaType: "image", model, displayName, providerName: "provider", priceQuota: id };
}

describe("config authentication cleanup", () => {
    it("clears both the top-level and channel API keys for a Cookie launch", () => {
        useConfigStore.getState().clearAPIKeys();

        const config = useConfigStore.getState().config;
        expect(config.apiKey).toBe("");
        expect(config.channels.every((channel) => channel.apiKey === "")).toBe(true);
    });
});

describe("applyMediaModels", () => {
    it("keeps one representative for duplicate normalized model names", () => {
        useConfigStore.getState().applyMediaModels("image", [imageModel(11, " gpt-image-2 ", "Primary"), imageModel(12, "gpt-image-2", "Fallback")]);

        const state = useConfigStore.getState();
        expect(state.mediaModels.image).toEqual([imageModel(11, "gpt-image-2", "Primary")]);
        expect(state.config.imageModels).toEqual(["default::gpt-image-2"]);
        expect(state.config.channels[0].models.filter((model) => model === "gpt-image-2")).toHaveLength(1);
        expect(state.config.models.filter((model) => model === "default::gpt-image-2")).toHaveLength(1);
    });

    it("preserves the current selection when the model still exists", () => {
        useConfigStore.setState((state) => ({
            config: {
                ...state.config,
                channels: [{ ...state.config.channels[0], models: ["gpt-image-current"] }],
                imageModel: "default::gpt-image-current",
            },
        }));

        useConfigStore.getState().applyMediaModels("image", [imageModel(21, "gpt-image-other"), imageModel(22, "gpt-image-current")]);

        expect(useConfigStore.getState().config.imageModel).toBe("default::gpt-image-current");
    });

    it("falls back to the first available model and clears an empty capability", () => {
        useConfigStore.setState((state) => ({ config: { ...state.config, imageModel: "default::gpt-image-missing" } }));

        useConfigStore.getState().applyMediaModels("image", [imageModel(31, "gpt-image-first"), imageModel(32, "gpt-image-second")]);
        expect(useConfigStore.getState().config.imageModel).toBe("default::gpt-image-first");

        useConfigStore.getState().applyMediaModels("image", []);
        const state = useConfigStore.getState();
        expect(state.mediaModels.image).toEqual([]);
        expect(state.config.imageModels).toEqual([]);
        expect(state.config.imageModel).toBe("");
    });
});
