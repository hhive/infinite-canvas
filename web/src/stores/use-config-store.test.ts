import { beforeEach, describe, expect, it } from "vitest";

import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

beforeEach(() => {
    useConfigStore.setState({
        config: {
            ...defaultConfig,
            apiKey: "sk-top-level-old",
            channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-channel-old" })),
        },
    });
});

describe("config authentication cleanup", () => {
    it("clears both the top-level and channel API keys for a Cookie launch", () => {
        useConfigStore.getState().clearAPIKeys();

        const config = useConfigStore.getState().config;
        expect(config.apiKey).toBe("");
        expect(config.channels.every((channel) => channel.apiKey === "")).toBe(true);
    });
});
