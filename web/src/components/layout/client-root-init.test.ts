import { describe, expect, it } from "vitest";

import { cookieSessionReadiness, mergeFetchedChannelModels, shouldAutoOpenConfigDialog, shouldInitializeClientRoot } from "@/components/layout/client-root-init";
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

describe("shouldAutoOpenConfigDialog", () => {
    it("does not prompt anonymous visitors who never supplied a key", () => {
        // 探测失败只说明「没有可用凭据」，这在匿名首访是正常状态，不该弹渠道配置框。
        expect(shouldAutoOpenConfigDialog(false, "")).toBe(false);
        expect(shouldAutoOpenConfigDialog(false, "   ")).toBe(false);
    });

    it("prompts when an explicitly supplied key failed", () => {
        expect(shouldAutoOpenConfigDialog(false, "sk-explicit-and-invalid")).toBe(true);
    });

    it("never prompts after a successful probe", () => {
        expect(shouldAutoOpenConfigDialog(true, "")).toBe(false);
        expect(shouldAutoOpenConfigDialog(true, "sk-explicit")).toBe(false);
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
