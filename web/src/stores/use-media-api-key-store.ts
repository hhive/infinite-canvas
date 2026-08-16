import { create } from "zustand";

import { fetchMediaAPIKeys, switchMediaAPIKey, type MediaAPIKey } from "@/services/api/media-api-keys";
import { fetchMediaModels, type MediaCapability } from "@/services/api/media-models";
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

export const useMediaAPIKeyStore = create<MediaAPIKeyStore>()((set, get) => ({
    ...initialState,
    activate: async (capability, taskActive, active = true) => {
        if (!active || taskActive) return;
        await ensureLoaded(set, get);
        const state = get();
        if (!state.keys.length || state.status === "unavailable") return;
        const preferred = state.keys.find((key) => key.id === state.preferences[capability] && modelCount(key, capability) > 0);
        const current = state.keys.find((key) => key.id === state.currentKeyId);
        const candidate = preferred || (current && modelCount(current, capability) > 0 ? current : state.keys.find((key) => modelCount(key, capability) > 0));
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
    if (!candidate || modelCount(candidate, capability) <= 0 || candidate.id === before.currentKeyId) return;
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
        const [imageModels, videoModels] = await Promise.all([fetchMediaModels("image", "", controller.signal), fetchMediaModels("video", "", controller.signal)]);
        if (sequence !== requestSequence) return;
        useConfigStore.getState().applyMediaModels("image", imageModels);
        useConfigStore.getState().applyMediaModels("video", videoModels);
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

function modelCount(key: MediaAPIKey, capability: MediaCapability) {
    return capability === "image" ? key.imageModelCount : key.videoModelCount;
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
