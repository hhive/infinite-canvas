import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMediaAPIKeys, fetchMediaModels, switchMediaAPIKey } = vi.hoisted(() => ({
    fetchMediaAPIKeys: vi.fn(),
    fetchMediaModels: vi.fn(),
    switchMediaAPIKey: vi.fn(),
}));

vi.mock("@/services/api/media-api-keys", () => ({ fetchMediaAPIKeys, switchMediaAPIKey }));
vi.mock("@/services/api/media-models", () => ({ fetchMediaModels }));

import { useConfigStore } from "@/stores/use-config-store";
import { resetMediaAPIKeyStore, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

const keys = [
    { id: 10, name: "Launch", maskedKey: "****0010", groupName: "默认", imageModelCount: 1, videoModelCount: 0, current: true },
    { id: 20, name: "视频", maskedKey: "****0020", groupName: "视频", imageModelCount: 0, videoModelCount: 4, current: false },
    { id: 30, name: "后建图片", maskedKey: "****0030", groupName: "图片", imageModelCount: 2, videoModelCount: 0, current: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    resetMediaAPIKeyStore();
    fetchMediaAPIKeys.mockResolvedValue(keys);
    switchMediaAPIKey.mockResolvedValue(undefined);
    fetchMediaModels.mockImplementation(async (capability: string) => [{ id: capability, mediaType: capability, model: `${capability}-model`, displayName: capability, providerName: "", apiMode: "", priceQuota: 0 }]);
    useConfigStore.setState({ mediaModels: { image: [], video: [] }, mediaModelStatus: { image: "idle", video: "idle" }, mediaModelErrors: { image: "", video: "" } });
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
        expect(fetchMediaModels).toHaveBeenCalledTimes(2);
        expect(useMediaAPIKeyStore.getState().currentKeyId).toBe(20);
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
        useConfigStore.setState({ mediaModels: { image: [{ id: 1, mediaType: "image", model: "old", displayName: "old", providerName: "", apiMode: "", priceQuota: 0 }], video: [] } });
        await expect(useMediaAPIKeyStore.getState().activate("video", false)).resolves.toBeUndefined();
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 10, error: "切换失败" });
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("old");
    });

    it("rolls the server session back when either model refresh fails", async () => {
        useConfigStore.setState({ mediaModels: { image: [{ id: 1, mediaType: "image", model: "old", displayName: "old", providerName: "", apiMode: "", priceQuota: 0 }], video: [] } });
        fetchMediaModels.mockImplementation(async (capability: string) => {
            if (capability === "video") throw new Error("刷新失败");
            return [{ id: 2, mediaType: "image", model: "new", displayName: "new", providerName: "", apiMode: "", priceQuota: 0 }];
        });

        await useMediaAPIKeyStore.getState().activate("video", false);

        expect(switchMediaAPIKey.mock.calls.map(([id]) => id)).toEqual([20, 10]);
        expect(useMediaAPIKeyStore.getState()).toMatchObject({ currentKeyId: 10, error: "刷新失败" });
        expect(useConfigStore.getState().mediaModels.image[0]?.model).toBe("old");
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
