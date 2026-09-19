import { beforeEach, describe, expect, it } from "vitest";

import type { MediaModel } from "@/services/api/media-models";
import { defaultConfig, resolveMissingKeyPrompt, resolveModelForCapability, useConfigStore } from "@/stores/use-config-store";
import { resetSessionStoreForTest, useSessionStore } from "@/stores/use-session-store";

beforeEach(() => {
    useConfigStore.setState({
        config: {
            ...defaultConfig,
            apiKey: "sk-top-level-old",
            channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-channel-old" })),
        },
        mediaModels: { image: [], video: [], text: [] },
        mediaModelStatus: { image: "idle", video: "idle", text: "idle" },
        mediaModelErrors: { image: "", video: "", text: "" },
        mediaModelsRefreshedAt: { image: "", video: "", text: "" },
        cookieSessionReady: false,
    });
});

it("defaults video charge mode to count-based billing", () => {
    expect((defaultConfig as unknown as { videoChargeMode: string }).videoChargeMode).toBe("cnt");
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

describe("configured model capabilities", () => {
    it("honors an explicit video capability for a model name without video keywords", () => {
        const config = {
            ...defaultConfig,
            channels: [{ ...defaultConfig.channels[0], models: [{ name: "custom-alpha", capability: "video" as const }] }],
            videoModel: "default::custom-alpha",
        };

        expect(resolveModelForCapability(config, "default::custom-alpha", "video")).toBe("default::custom-alpha");
    });
});

describe("cookie session readiness", () => {
    const configWithoutKey = () => {
        const state = useConfigStore.getState();
        return {
            ...state.config,
            channels: state.config.channels.map((channel) => ({ ...channel, apiKey: "" })),
            model: "default::gpt-image-2",
        };
    };

    it("accepts a verified cookie session that has bound a usable key", () => {
        useConfigStore.setState({ cookieSessionReady: true });
        useSessionStore.setState({ loaded: true, authSource: "password", hasApiKey: true });

        const config = configWithoutKey();

        expect(useConfigStore.getState().isAiConfigReady(config, config.model)).toBe(true);
    });

    it("does not accept a verified cookie session without a usable key", () => {
        // 探测通过只说明会话 cookie 有效（withAPIUser 会回落到会话、不要求已绑定 Key）；
        // 没有可用 Key 的会话点了生成只会在上游失败，不能算就绪。
        useConfigStore.setState({ cookieSessionReady: true });
        resetSessionStoreForTest();
        useSessionStore.setState({ loaded: true });

        const config = configWithoutKey();

        expect(useConfigStore.getState().isAiConfigReady(config, config.model)).toBe(false);
    });

    it("does not accept an unverified cookie session without a persisted API key", () => {
        useConfigStore.setState({ cookieSessionReady: false });
        useSessionStore.setState({ loaded: true, authSource: "password", hasApiKey: true });

        const config = configWithoutKey();

        expect(useConfigStore.getState().isAiConfigReady(config, config.model)).toBe(false);
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

    it("keeps the text catalog in its own slots without touching image or video", () => {
        const textModels: MediaModel[] = [
            { ...imageModel(41, "gpt-6-astra"), id: "gpt-6-astra", mediaType: "text" },
            { ...imageModel(42, "gpt-5.5"), id: "gpt-5.5", mediaType: "text" },
        ];

        useConfigStore.getState().applyMediaModels("text", textModels);

        const state = useConfigStore.getState();
        expect(state.mediaModels.text).toEqual(textModels);
        expect(state.config.textModels).toEqual(["default::gpt-6-astra", "default::gpt-5.5"]);
        // 已选文本模型仍在目录中时保持用户选择不变
        expect(state.config.textModel).toBe("default::gpt-5.5");
        expect(state.mediaModelStatus.text).toBe("ready");
        expect(state.mediaModels.image).toEqual([]);
        expect(state.config.imageModels).toEqual(defaultConfig.imageModels);
    });

    it("falls back to the first text model when the selected one left the catalog", () => {
        useConfigStore.setState((state) => ({ config: { ...state.config, textModel: "default::removed-text-model" } }));

        useConfigStore.getState().applyMediaModels("text", [{ ...imageModel(43, "gpt-6-astra"), id: "gpt-6-astra", mediaType: "text" }]);

        expect(useConfigStore.getState().config.textModel).toBe("default::gpt-6-astra");
    });
});

describe("isAiConfigReady 的会话模式判定", () => {
    const sessionConfig = {
        ...defaultConfig,
        apiKey: "",
        channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "" })),
    };

    it("会话模式但没有可用 Key 时不算就绪", () => {
        // 探测通过只说明会话 cookie 有效（withAPIUser 会回落到会话、不要求已绑定 Key），
        // 没有 Key 的会话点了生成只会在上游失败，所以不能算就绪。
        useConfigStore.setState({ cookieSessionReady: true });
        resetSessionStoreForTest();
        useSessionStore.setState({ loaded: true });

        expect(useConfigStore.getState().isAiConfigReady(sessionConfig, "gpt-image-2")).toBe(false);
    });

    it("会话绑定可用 Key 后算就绪", () => {
        useConfigStore.setState({ cookieSessionReady: true });
        useSessionStore.setState({ loaded: true, authSource: "password", hasApiKey: true });

        expect(useConfigStore.getState().isAiConfigReady(sessionConfig, "gpt-image-2")).toBe(true);
    });

    it("现取 hasApiKey：加载后绑定 Key 无需重算 cookieSessionReady", () => {
        // 页面加载时会话尚未绑定 Key（activate() 还没跑）；绑定完成后即应就绪，
        // 否则刚被自动绑定 Key 的用户会被自己的陈旧状态拦住。
        useConfigStore.setState({ cookieSessionReady: true });
        resetSessionStoreForTest();
        useSessionStore.setState({ loaded: true });
        expect(useConfigStore.getState().isAiConfigReady(sessionConfig, "gpt-image-2")).toBe(false);

        useSessionStore.setState({ authSource: "password", hasApiKey: true });
        expect(useConfigStore.getState().isAiConfigReady(sessionConfig, "gpt-image-2")).toBe(true);
    });

    it("手填 Key 时不依赖会话状态", () => {
        useConfigStore.setState({ cookieSessionReady: false });
        resetSessionStoreForTest();
        const manual = { ...sessionConfig, channels: sessionConfig.channels.map((channel) => ({ ...channel, apiKey: "sk-manual" })) };

        expect(useConfigStore.getState().isAiConfigReady(manual, "gpt-image-2")).toBe(true);
    });

    it("会话状态尚未加载完时不断言，避免刚进页面就点生成被误拦", () => {
        // hasApiKey 要等 /api/session/me 回来才准；这个窗口里 fail-open，
        // 与被拦相比宁可退回改动前的行为。
        useConfigStore.setState({ cookieSessionReady: true });
        resetSessionStoreForTest();
        useSessionStore.setState({ loaded: false, hasApiKey: false });

        expect(useConfigStore.getState().isAiConfigReady(sessionConfig, "gpt-image-2")).toBe(true);
    });
});

describe("missing-key prompt triage", () => {
    const clearManualKeys = () => {
        useConfigStore.setState({
            config: { ...defaultConfig, apiKey: "", channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "" })) },
            isConfigOpen: false,
            credentialPrompt: null,
        });
    };

    it("offers login only when there is neither a key nor a session", () => {
        expect(resolveMissingKeyPrompt(false, false, false)).toBe("login");
    });

    it("offers creating a key when a session has no usable key", () => {
        expect(resolveMissingKeyPrompt(false, true, false)).toBe("createKey");
    });

    it("offers the config dialog when a key was supplied or the session has one", () => {
        expect(resolveMissingKeyPrompt(true, false, false)).toBe("config");
        expect(resolveMissingKeyPrompt(false, true, true)).toBe("config");
        expect(resolveMissingKeyPrompt(true, true, false)).toBe("config");
    });

    it("routes the interruption to the login prompt for visitors with no credential", () => {
        clearManualKeys();
        resetSessionStoreForTest();

        // 返回值让调用方知道开的是哪一种，才能只在「配置框」分支补文案。
        expect(useConfigStore.getState().openConfigDialog(true)).toBe("login");

        expect(useConfigStore.getState().credentialPrompt).toBe("login");
        expect(useConfigStore.getState().isConfigOpen).toBe(false);
    });

    it("routes the interruption to the create-key prompt for a session without a key", () => {
        clearManualKeys();
        useSessionStore.setState({ authSource: "password", hasApiKey: false });

        expect(useConfigStore.getState().openConfigDialog(true)).toBe("createKey");

        expect(useConfigStore.getState().credentialPrompt).toBe("createKey");
        expect(useConfigStore.getState().isConfigOpen).toBe(false);
    });

    it("keeps the config dialog when the visitor hand-filled a key", () => {
        // beforeEach 已写入手填 Key；这类人的补救路径是修 Key，不是登录或建新 Key。
        useConfigStore.setState({ isConfigOpen: false, credentialPrompt: null });
        resetSessionStoreForTest();

        expect(useConfigStore.getState().openConfigDialog(true)).toBe("config");

        expect(useConfigStore.getState().isConfigOpen).toBe(true);
        expect(useConfigStore.getState().credentialPrompt).toBe(null);
    });

    it("keeps the config dialog for explicit intent even with no credential", () => {
        // 顶栏「系统配置」是用户显式意图，永远开配置框，不做分诊。
        clearManualKeys();
        resetSessionStoreForTest();

        expect(useConfigStore.getState().openConfigDialog(false)).toBe("config");

        expect(useConfigStore.getState().isConfigOpen).toBe(true);
        expect(useConfigStore.getState().credentialPrompt).toBe(null);
    });
});
