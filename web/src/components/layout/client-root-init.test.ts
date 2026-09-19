import { describe, expect, it } from "vitest";

import { cookieSessionReadiness, mergeFetchedChannelModels, shouldInitializeClientRoot } from "@/components/layout/client-root-init";
import { defaultConfig, selectableModelsByCapability } from "@/stores/use-config-store";

describe("shouldInitializeClientRoot", () => {
    it("does not initialize API key prompts on the public model marketplace", () => {
        expect(shouldInitializeClientRoot("/pricing")).toBe(false);
        expect(shouldInitializeClientRoot("/")).toBe(true);
        expect(shouldInitializeClientRoot("/image")).toBe(true);
    });

    it("does not initialize API key prompts on user-center routes", () => {
        // 用户配置页只做账号操作；匿名访客应看到登录引导，而不是盖在上面的渠道配置框。
        expect(shouldInitializeClientRoot("/account")).toBe(false);
        expect(shouldInitializeClientRoot("/account/keys")).toBe(false);
        expect(shouldInitializeClientRoot("/account/usage")).toBe(false);
        expect(shouldInitializeClientRoot("/account/balance")).toBe(false);
        expect(shouldInitializeClientRoot("/account/redeem")).toBe(false);
        // 段边界：同前缀的其它路径不享受豁免。
        expect(shouldInitializeClientRoot("/accounts")).toBe(true);
        // 生成页与页面配置页保持原行为。
        expect(shouldInitializeClientRoot("/video")).toBe(true);
        expect(shouldInitializeClientRoot("/canvas")).toBe(true);
        expect(shouldInitializeClientRoot("/config")).toBe(true);
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

describe("cookieSessionReadiness", () => {
    it("accepts only a successful probe without a bearer key", () => {
        expect(cookieSessionReadiness(true, "")).toBe(true);
        expect(cookieSessionReadiness(true, "sk-manual")).toBe(false);
        expect(cookieSessionReadiness(false, "")).toBe(false);
    });
});
