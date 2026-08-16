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
    return { id, mediaType: "image", model, displayName, providerName: "provider", apiMode: "images", priceQuota: id };
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
    it("keeps distinct image model names when display names match", () => {
        useConfigStore.setState((state) => ({
            config: {
                ...state.config,
                channels: [{ ...state.config.channels[0], models: ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k"] }],
                imageModels: ["default::gpt-image-2-1k", "default::gpt-image-2-2k", "default::gpt-image-2-4k"],
                imageModel: "default::gpt-image-2-1k",
            },
        }));
        useConfigStore.getState().applyMediaModels("image", [
            imageModel(11, "gpt-image-2-2k", " gpt-image-2 "),
            imageModel(12, "gpt-image-2-4k", "gpt-image-2"),
            imageModel(13, "gpt-image-2-1k", "gpt-image-2"),
        ]);

        const state = useConfigStore.getState();
        expect(state.mediaModels.image).toEqual([
            imageModel(11, "gpt-image-2-2k", "gpt-image-2"),
            imageModel(12, "gpt-image-2-4k", "gpt-image-2"),
            imageModel(13, "gpt-image-2-1k", "gpt-image-2"),
        ]);
        expect(state.config.imageModels).toEqual(["default::gpt-image-2-2k", "default::gpt-image-2-4k", "default::gpt-image-2-1k"]);
        expect(state.config.models).toEqual(expect.arrayContaining(["default::gpt-image-2-2k", "default::gpt-image-2-4k", "default::gpt-image-2-1k"]));
        expect(state.config.imageModel).toBe("default::gpt-image-2-1k");
    });

    it("does not group video records by display name", () => {
        const videoModels: MediaModel[] = [
            { ...imageModel(14, "video-fast", "Video"), mediaType: "video" },
            { ...imageModel(15, "video-quality", "Video"), mediaType: "video" },
        ];

        useConfigStore.getState().applyMediaModels("video", videoModels);

        expect(useConfigStore.getState().config.videoModels).toEqual(["default::video-fast", "default::video-quality"]);
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
