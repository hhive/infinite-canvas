import { describe, expect, it } from "vitest";

import { configPromptForProbeFailure, cookieSessionReadiness, mergeFetchedChannelModels, shouldInitializeClientRoot } from "@/components/layout/client-root-init";
import { defaultConfig, selectableModelsByCapability } from "@/stores/use-config-store";

describe("shouldInitializeClientRoot", () => {
    it("initializes on routes that need the channel and model catalog", () => {
        expect(shouldInitializeClientRoot("/")).toBe(true);
        expect(shouldInitializeClientRoot("/image")).toBe(true);
        expect(shouldInitializeClientRoot("/video")).toBe(true);
        expect(shouldInitializeClientRoot("/canvas")).toBe(true);
        // 配置面板的模型选项来自根初始化写入的媒体模型目录，必须保留。
        expect(shouldInitializeClientRoot("/config")).toBe(true);
    });

    it("initializes canvas project sub-routes", () => {
        // /canvas/:id（画布项目页）是产品内可达路由：列表与项目卡片都会导航过去，
        // 硬刷新或直链进入时同样要初始化，否则会话探测、媒体模型目录与 launch 参数消费会整条丢失。
        expect(shouldInitializeClientRoot("/canvas/abc123")).toBe(true);
        expect(shouldInitializeClientRoot("/canvas/")).toBe(true);
        // 段边界：同前缀的其它路径不享受豁免。
        expect(shouldInitializeClientRoot("/canvases")).toBe(false);
    });

    it("does not initialize on routes that never need it", () => {
        // 定价页是纯展示；用户配置页只做账号操作，弹渠道配置框会盖住登录引导。
        expect(shouldInitializeClientRoot("/pricing")).toBe(false);
        expect(shouldInitializeClientRoot("/account")).toBe(false);
        expect(shouldInitializeClientRoot("/account/keys")).toBe(false);
        expect(shouldInitializeClientRoot("/account/usage")).toBe(false);
        expect(shouldInitializeClientRoot("/account/balance")).toBe(false);
        expect(shouldInitializeClientRoot("/account/redeem")).toBe(false);
        // 提示词来源由 usePromptSourceScheduler 独立驱动，不依赖模型目录。
        expect(shouldInitializeClientRoot("/prompts")).toBe(false);
        expect(shouldInitializeClientRoot("/accounts")).toBe(false);
    });

    it("keeps unknown routes out of the initialization set", () => {
        // 允许名单的意义：新增路由默认不继承初始化与自动弹框，需要时显式加入。
        expect(shouldInitializeClientRoot("/some-future-page")).toBe(false);
        expect(shouldInitializeClientRoot("/image/extra")).toBe(false);
    });
});

describe("configPromptForProbeFailure", () => {
    it("offers login when the visitor has neither a key nor a session", () => {
        // 「用到 Key 却没有 Key」且连账号都没有：Key 只能由账号提供，给登录提示，
        // 而不是丢一个匿名访客看不懂也走不通的渠道配置框。
        expect(configPromptForProbeFailure("", false)).toBe("login");
        expect(configPromptForProbeFailure("   ", false)).toBe("login");
    });

    it("offers the config dialog when a key was supplied or a session exists", () => {
        // 这两类人的补救路径是修 Key 或进用户中心，不是登录。
        expect(configPromptForProbeFailure("sk-explicit-and-invalid", false)).toBe("config");
        expect(configPromptForProbeFailure("", true)).toBe("config");
        expect(configPromptForProbeFailure("sk-explicit", true)).toBe("config");
    });
});

describe("mergeFetchedChannelModels", () => {

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
