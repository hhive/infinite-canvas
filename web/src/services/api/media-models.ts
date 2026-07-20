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
};

function authHeaders(apiKey: string) {
    return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined;
}

export async function fetchMediaModels(capability: MediaCapability, apiKey = "", signal?: AbortSignal): Promise<MediaModel[]> {
    const response = await axios.get<unknown>("/v1/models", {
        headers: authHeaders(apiKey),
        params: { media_type: capability },
        signal,
        withCredentials: true,
    });
    if (!Array.isArray(response.data)) throw new Error(`${capability === "image" ? "图片" : "视频"}模型接口返回格式无效`);
    const seenIds = new Set<number>();
    const seenSelectionModels = new Set<string>();
    const models: MediaModel[] = [];
    for (const raw of response.data) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const model = typeof item.model === "string" ? item.model.trim() : "";
        if (capability === "image") {
            if (!model || seenSelectionModels.has(model)) continue;
            seenSelectionModels.add(model);
            models.push({ id: model, mediaType: "image", model, displayName: model, providerName: "", apiMode: "", priceQuota: 0 });
            continue;
        }
        const id = Number(item.id);
        const displayName = typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : model;
        const selectionModel = model;
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
        });
    }
    return models;
}
