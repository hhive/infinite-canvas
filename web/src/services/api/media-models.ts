import axios from "axios";

export type MediaCapability = "image" | "video";

export type MediaModel = {
    id: number | string;
    mediaType: MediaCapability;
    model: string;
    displayName: string;
    providerName: string;
    apiMode: string;
    priceQuota: number;
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxReferenceAudios?: number;
    supportedSeconds?: number[];
};

function authHeaders(apiKey: string) {
    return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined;
}

export async function fetchMediaModels(capability: MediaCapability, apiKey = "", signal?: AbortSignal): Promise<MediaModel[]> {
    const response = await axios.get<unknown>("/v1/models", {
        headers: authHeaders(apiKey),
        ...(capability === "video" ? { params: { media_type: "video" } } : {}),
        signal,
        withCredentials: true,
    });
    const imageEnvelope = response.data && typeof response.data === "object" && !Array.isArray(response.data) ? (response.data as Record<string, unknown>) : null;
    const records = capability === "image" ? (imageEnvelope?.object === "list" ? imageEnvelope.data : undefined) : response.data;
    if (!Array.isArray(records)) throw new Error(`${capability === "image" ? "图片" : "视频"}模型接口返回格式无效`);
    const seenIds = new Set<number>();
    const seenSelectionModels = new Set<string>();
    const models: MediaModel[] = [];
    for (const raw of records) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        if (capability === "image") {
            const model = typeof item.id === "string" ? item.id.trim() : "";
            if (!model || seenSelectionModels.has(model)) continue;
            seenSelectionModels.add(model);
            models.push({ id: model, mediaType: "image", model, displayName: model, providerName: "", apiMode: "", priceQuota: 0 });
            continue;
        }
        const model = typeof item.model === "string" ? item.model.trim() : "";
        const id = Number(item.id);
        const displayName = typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : model;
        const selectionModel = displayName;
        const mediaType = typeof item.media_type === "string" ? item.media_type : capability;
        if (!Number.isSafeInteger(id) || id <= 0 || !model || !selectionModel || mediaType !== capability || seenIds.has(id) || seenSelectionModels.has(selectionModel)) continue;
        const rawPriceQuota = Number(item.price_quota);
        seenIds.add(id);
        seenSelectionModels.add(selectionModel);
        models.push({
            id,
            mediaType: capability,
            model: selectionModel,
            displayName,
            providerName: typeof item.provider_name === "string" ? item.provider_name.trim() : "",
            apiMode: typeof item.api_mode === "string" ? item.api_mode.trim() : "",
            priceQuota: Number.isFinite(rawPriceQuota) && rawPriceQuota > 0 ? rawPriceQuota : 0,
            maxReferenceImages: referenceLimit(item.max_reference_images),
            maxReferenceVideos: referenceLimit(item.max_reference_videos),
            maxReferenceAudios: referenceLimit(item.max_reference_audios),
            supportedSeconds: supportedSeconds(item.supported_seconds),
        });
    }
    return models;
}

function supportedSeconds(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0 && item <= 3600))].sort((a, b) => a - b);
}

function referenceLimit(value: unknown) {
    const limit = Number(value);
    return Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
}
