import axios from "axios";

export type MediaCapability = "image" | "video";

export type MediaModel = {
    id: number;
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
    const seen = new Set<number>();
    const models: MediaModel[] = [];
    for (const raw of response.data) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const id = Number(item.id);
        const model = typeof item.model === "string" ? item.model.trim() : "";
        const mediaType = typeof item.media_type === "string" ? item.media_type : capability;
        if (!Number.isSafeInteger(id) || id <= 0 || !model || mediaType !== capability || seen.has(id)) continue;
        const rawPriceQuota = Number(item.price_quota);
        seen.add(id);
        models.push({
            id,
            mediaType: capability,
            model,
            displayName: typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : model,
            providerName: typeof item.provider_name === "string" ? item.provider_name.trim() : "",
            apiMode: typeof item.api_mode === "string" ? item.api_mode.trim() : "",
            priceQuota: Number.isFinite(rawPriceQuota) && rawPriceQuota > 0 ? rawPriceQuota : 0,
        });
    }
    return models;
}
