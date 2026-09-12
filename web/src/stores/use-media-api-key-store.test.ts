import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMediaAPIKeys, fetchMediaModels, switchMediaAPIKey } = vi.hoisted(() => ({
    fetchMediaAPIKeys: vi.fn(),
    fetchMediaModels: vi.fn(),
    switchMediaAPIKey: vi.fn(),
}));

vi.mock(import("@/services/api/media-api-keys"), async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchMediaAPIKeys, switchMediaAPIKey };
});
vi.mock("@/services/api/media-models", () => ({ fetchMediaModels }));

import { useConfigStore } from "@/stores/use-config-store";
import { currentMediaModelRequestEpoch, ensureMediaModelsLoaded, isMediaModelRequestEpochCurrent, resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

const emptyMediaModels = { image: [], video: [], text: [] };

const keys = [
    { id: 10, name: "Launch", maskedKey: "****0010", groupName: "默认", imageModelCount: 1, videoModelCount: 0, textModelCount: 0, current: true },
    { id: 20, name: "视频", maskedKey: "****0020", groupName: "视频", imageModelCount: 0, videoModelCount: 4, textModelCount: 0, current: false },
    { id: 30, name: "后建图片", maskedKey: "****0030", groupName: "图片", imageModelCount: 2, videoModelCount: 0, textModelCount: 0, current: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    resetMediaAPIKeyStore();
    fetchMediaAPIKeys.mockResolvedValue(keys);
    switchMediaAPIKey.mockResolvedValue(undefined);
    fetchMediaModels.mockImplementation(async (capability: string) => [{ id: capability, mediaType: capability, model: `${capability}-model`, displayName: capability, providerName: "", apiMode: "", priceQuota: 0 }]);
    useConfigStore.setState({ mediaModels: { ...emptyMediaModels }, mediaModelStatus: { image: "idle", video: "idle", text: "idle" }, mediaModelErrors: { image: "", video: "", text: "" } });
});

describe("Media API Key session selection", () => {
    it("keeps the launch key when it supports the active media type", async () => {
        await useMediaAPIKeyStore.getState().activate("image", false);
        expect(switchMediaAPIKey).not.toHaveBeenCalled();
        expect(useMediaAPIKeyStore.getState().currentKeyId).toBe(10);
    });

    it("auto switches once using the stable server order when the launch key has zero models", async () => {
        await useMediaAPIKeyStore.getState().activate("video", false);
        expect(switchMediaAPIKey).toHaveBeenCalledWith(20);
        expect(fetchMediaModels).toHaveBeenCalledTimes(3);
        expect(useMediaAPIKeyStore.getState().currentKeyId).toBe(20);
    });

    it("refreshes the text catalog together with image and video on a key switch", async () => {
        await useMediaAPIKeyStore.getState().activate("video", false);
        await vi.waitFor(() => expect(useConfigStore.getState().mediaModels.text[0]?.model).toBe("text-model"));
        expect(fetchMediaModels.mock.calls.map(([capability]) => capability).sort()).toEqual(["image", "text", "video"]);
    });

    it("keeps the key switch when only the text catalog fails", async () => {
        fetchMediaModels.mockImplementation(async (capability: string) => {
            if (capability === "text") throw new Error("文本目录不可用");
            return [{ id: capability, mediaType: capability, model: `${capability}-model`, displayName: capability, providerName: "", apiMode: "", priceQuota: 0 }];
        });

        await useMediaAPIKeyStore.getState().activate("video", false);

        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 20, error: "" });
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("image-model");
        expect(useConfigStore.getState().mediaModels.text).toEqual([]);
        expect(switchMediaAPIKey.mock.calls.map(([id]) => id)).toEqual([20]);
    });

    it("never filters keys by the text model count", async () => {
        await useMediaAPIKeyStore.getState().select(20, "text");
        expect(switchMediaAPIKey).toHaveBeenCalledWith(20);
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 20, error: "" });
    });

    it("invalidates startup model responses when a key switch begins", async () => {
        const startupEpoch = currentMediaModelRequestEpoch();
        await useMediaAPIKeyStore.getState().activate("video", false);
        expect(isMediaModelRequestEpochCurrent(startupEpoch)).toBe(false);
        expect(isMediaModelRequestEpochCurrent(currentMediaModelRequestEpoch())).toBe(true);
    });

    it("remembers independent image and video preferences for this in-memory session", async () => {
        await useMediaAPIKeyStore.getState().activate("video", false);
        await useMediaAPIKeyStore.getState().select(30, "image");
        await useMediaAPIKeyStore.getState().activate("video", false);
        await useMediaAPIKeyStore.getState().activate("image", false);
        expect(switchMediaAPIKey.mock.calls.map(([id]) => id)).toEqual([20, 30, 20, 30]);
    });

    it("does not auto switch while a task is active or the context is inactive", async () => {
        await useMediaAPIKeyStore.getState().activate("video", true);
        await useMediaAPIKeyStore.getState().activate("video", false, false);
        expect(switchMediaAPIKey).not.toHaveBeenCalled();
    });

    it("keeps the previous state and models when switching fails", async () => {
        switchMediaAPIKey.mockRejectedValueOnce(new Error("切换失败"));
        useConfigStore.setState({ mediaModels: { image: [{ id: 1, mediaType: "image", model: "old", displayName: "old", providerName: "", apiMode: "", priceQuota: 0 }], video: [], text: [] } });
        await expect(useMediaAPIKeyStore.getState().activate("video", false)).resolves.toBeUndefined();
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 10, error: "切换失败" });
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("old");
    });

    it("rolls the server session back when either model refresh fails", async () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: 1, mediaType: "image", model: "old", displayName: "old", providerName: "", apiMode: "", priceQuota: 0 }], video: [], text: [] } });
        fetchMediaModels.mockImplementation(async (capability: string) => {
            if (capability === "video") throw new Error("刷新失败");
            return [{ id: 2, mediaType: "image", model: "new", displayName: "new", providerName: "", apiMode: "", priceQuota: 0 }];
        });

        await useMediaAPIKeyStore.getState().activate("video", false);
        await Promise.resolve();
        await Promise.resolve();

        expect(switchMediaAPIKey.mock.calls.map(([id]) => id)).toEqual([20, 10]);
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 10, error: "刷新失败" });
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("old");
        // 切换已回滚，失败 Key 的文本目录不能再写进配置
        expect(fetchMediaModels.mock.calls.some(([capability]) => capability === "text")).toBe(true);
        expect(useConfigStore.getState().mediaModels.text).toEqual([]);
    });

    it("accepts only the latest rapid manual selection result", async () => {
        let finishFirst!: () => void;
        let serverKey = 10;
        switchMediaAPIKey
            .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = () => { serverKey = 30; resolve(); }; }))
            .mockImplementationOnce(async () => { serverKey = 20; });
        fetchMediaModels.mockImplementation(async (capability: string) => [{ id: `${capability}-${serverKey}`, mediaType: capability, model: `${capability}-${serverKey}`, displayName: capability, providerName: "", apiMode: "", priceQuota: 0 }]);
        const first = useMediaAPIKeyStore.getState().select(30, "image");
        const second = useMediaAPIKeyStore.getState().select(20, "video");
        await vi.waitFor(() => expect(switchMediaAPIKey.mock.calls.map(([id]) => id)).toEqual([30]));
        finishFirst();
        await Promise.all([first, second]);
        expect(useMediaAPIKeyStore.getState().currentKeyId).toBe(20);
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("image-20");
        expect(useConfigStore.getState().mediaModels.video[0]?.model).toBe("video-20");
        expect(switchMediaAPIKey.mock.calls.every(([, signal]) => signal === undefined)).toBe(true);
    });
});

describe("ensureMediaModelsLoaded", () => {
    it("reuses an already loaded catalog without another request", async () => {
        useConfigStore.setState({ mediaModels: { ...emptyMediaModels, text: [{ id: "gpt-6-astra", mediaType: "text", model: "gpt-6-astra", displayName: "gpt-6-astra", providerName: "", apiMode: "", priceQuota: 0 }] } });
        await expect(ensureMediaModelsLoaded("text")).resolves.toMatchObject([{ model: "gpt-6-astra" }]);
        expect(fetchMediaModels).not.toHaveBeenCalled();
    });

    it("loads the text catalog on demand and writes it into the config store", async () => {
        await expect(ensureMediaModelsLoaded("text")).resolves.toMatchObject([{ model: "text-model" }]);
        expect(fetchMediaModels).toHaveBeenCalledWith("text", "");
        expect(useConfigStore.getState().mediaModels.text[0]?.model).toBe("text-model");
    });

    it("returns an empty catalog silently when the request fails", async () => {
        fetchMediaModels.mockRejectedValueOnce(new Error("文本目录不可用"));
        await expect(ensureMediaModelsLoaded("text")).resolves.toEqual([]);
        expect(useConfigStore.getState().mediaModels.text).toEqual([]);
    });

    it("does not touch the media catalog when the user configured an API key manually", async () => {
        useConfigStore.setState((state) => ({ config: { ...state.config, apiKey: "manual-secret" } }));

        await expect(ensureMediaModelsLoaded("text")).resolves.toEqual([]);

        expect(fetchMediaModels).not.toHaveBeenCalled();
    });
});
