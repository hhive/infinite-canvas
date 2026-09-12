import { create } from "zustand";

import { fetchMediaAPIKeys, mediaAPIKeyCapabilityCount, switchMediaAPIKey, type MediaAPIKey } from "@/services/api/media-api-keys";
import { fetchMediaModels, type MediaCapability, type MediaModel } from "@/services/api/media-models";
import { useConfigStore } from "@/stores/use-config-store";

type MediaAPIKeyStore = {
    keys: MediaAPIKey[];
    currentKeyId: number | null;
    preferences: Partial<Record<MediaCapability, number>>;
    status: "idle" | "loading" | "ready" | "switching" | "empty" | "unavailable";
    error: string;
    activate: (capability: MediaCapability, taskActive: boolean, active?: boolean) => Promise<void>;
    select: (apiKeyId: number, capability: MediaCapability) => Promise<void>;
};

const initialState = {
    keys: [] as MediaAPIKey[],
    currentKeyId: null as number | null,
    preferences: {} as Partial<Record<MediaCapability, number>>,
    status: "idle" as const,
    error: "",
};

let loadPromise: Promise<void> | null = null;
let requestSequence = 0;
let mediaModelRequestEpoch = 0;
let switchController: AbortController | null = null;
let switchMutationQueue: Promise<void> = Promise.resolve();

export function currentMediaModelRequestEpoch() {
    return mediaModelRequestEpoch;
}

export function isMediaModelRequestEpochCurrent(epoch: number) {
    return epoch === mediaModelRequestEpoch;
}

/**
 * 按需加载某个能力的模型目录：已有目录时直接复用，否则拉取一次并写入配置。
 * 失败时静默返回空数组（不弹提示），调用方自行回退到节点已选模型。
 */
export async function ensureMediaModelsLoaded(capability: MediaCapability): Promise<MediaModel[]> {
    const config = useConfigStore.getState().config;
    const existing = useConfigStore.getState().mediaModels?.[capability] ?? [];
    if (existing.length) return existing;
    // 手填 API Key 时不请求 Media 目录：与 MediaAPIKeyPicker 的显示条件一致，
    // 避免把同源渠道写进用户自己的渠道配置。
    if (config.apiKey.trim() || config.channels.some((channel) => channel.apiKey.trim())) return [];
    const epoch = mediaModelRequestEpoch;
    try {
        const models = await fetchMediaModels(capability, "");
        if (!isMediaModelRequestEpochCurrent(epoch)) return useConfigStore.getState().mediaModels?.[capability] ?? [];
        useConfigStore.getState().applyMediaModels(capability, models);
        return models;
    } catch {
        return [];
    }
}

export const useMediaAPIKeyStore = create<MediaAPIKeyStore>()((set, get) => ({
    ...initialState,
    activate: async (capability, taskActive, active = true) => {
        if (!active || taskActive) return;
        await ensureLoaded(set, get);
        const state = get();
        if (!state.keys.length || state.status === "unavailable") return;
        const preferred = state.keys.find((key) => key.id === state.preferences[capability] && mediaAPIKeyCapabilityCount(key, capability) > 0);
        const current = state.keys.find((key) => key.id === state.currentKeyId);
        const candidate = preferred || (current && mediaAPIKeyCapabilityCount(current, capability) > 0 ? current : state.keys.find((key) => mediaAPIKeyCapabilityCount(key, capability) > 0));
        if (candidate && candidate.id !== state.currentKeyId) await switchKey(candidate.id, capability, false, set, get);
    },
    select: async (apiKeyId, capability) => switchKey(apiKeyId, capability, true, set, get),
}));

async function ensureLoaded(set: StoreSet, get: StoreGet) {
    if (get().status !== "idle") return loadPromise;
    set({ status: "loading", error: "" });
    loadPromise = fetchMediaAPIKeys()
        .then((keys) => {
            set({ keys, currentKeyId: keys.find((key) => key.current)?.id ?? null, status: keys.length ? "ready" : "empty", error: "" });
        })
        .catch((error) => set({ status: "unavailable", error: errorText(error, "读取 API Key 失败") }));
    await loadPromise;
}

async function switchKey(apiKeyId: number, capability: MediaCapability, manual: boolean, set: StoreSet, get: StoreGet) {
    await ensureLoaded(set, get);
    const before = get();
    const candidate = before.keys.find((key) => key.id === apiKeyId);
    if (!candidate || mediaAPIKeyCapabilityCount(candidate, capability) <= 0 || candidate.id === before.currentKeyId) return;
    const sequence = ++requestSequence;
    mediaModelRequestEpoch += 1;
    switchController?.abort();
    const controller = new AbortController();
    switchController = controller;
    set({ status: "switching", error: "" });
    let serverSwitched = false;
    try {
        // Serialize mutation requests so model refresh always observes the final selected key.
        const mutation = switchMutationQueue.then(() => switchMediaAPIKey(apiKeyId));
        switchMutationQueue = mutation.catch(() => undefined);
        await mutation;
        serverSwitched = true;
        if (sequence !== requestSequence) return;
        // 文本目录与图片/视频并行刷新，但失败不参与回滚：文本模型权限由 Sub2API 在调用时校验，
        // 且 Media 的 text 目录在上游失败时按接口契约返回 502，不应因此把图片/视频的 Key 切换一起判失败。
        const textModelsRefresh = fetchMediaModels("text", "", controller.signal).catch(() => null);
        const [imageModels, videoModels] = await Promise.all([fetchMediaModels("image", "", controller.signal), fetchMediaModels("video", "", controller.signal)]);
        if (sequence !== requestSequence) return;
        useConfigStore.getState().applyMediaModels("image", imageModels);
        useConfigStore.getState().applyMediaModels("video", videoModels);
        void textModelsRefresh.then((textModels) => {
            // 切换已被更新的请求覆盖、或本次切换失败回滚时，不写入旧 Key 的文本目录。
            if (!textModels || sequence !== requestSequence || get().currentKeyId !== apiKeyId) return;
            useConfigStore.getState().applyMediaModels("text", textModels);
        });
        set((state) => ({
            currentKeyId: apiKeyId,
            keys: state.keys.map((key) => ({ ...key, current: key.id === apiKeyId })),
            preferences: manual ? { ...state.preferences, [capability]: apiKeyId } : state.preferences,
            status: "ready",
            error: "",
        }));
    } catch (error) {
        if (sequence !== requestSequence) return;
        if (serverSwitched && !controller.signal.aborted && before.currentKeyId && before.currentKeyId !== apiKeyId) {
            try { await switchMediaAPIKey(before.currentKeyId); } catch { /* The next request revalidates the server session. */ }
        }
        set({ status: "ready", error: errorText(error, "切换 API Key 失败") });
    }
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

type StoreSet = (partial: Partial<MediaAPIKeyStore> | ((state: MediaAPIKeyStore) => Partial<MediaAPIKeyStore>)) => void;
type StoreGet = () => MediaAPIKeyStore;

export function resetMediaAPIKeyStore() {
    loadPromise = null;
    requestSequence = 0;
    mediaModelRequestEpoch = 0;
    switchMutationQueue = Promise.resolve();
    switchController?.abort();
    switchController = null;
    useMediaAPIKeyStore.setState(initialState);
}
