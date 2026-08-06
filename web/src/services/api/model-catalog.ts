import axios from "axios";

export type MarketplaceCall = { method: string; path: string; example: string; auth: string };
export type MarketplaceModel = {
    media_type: "image" | "video";
    name: string;
    provider?: string;
    sizes?: string[];
    qualities?: string[];
    price_1k?: number;
    price_2k?: number;
    price_4k?: number;
    price_low?: number;
    price_medium?: number;
    price_high?: number;
    price_quota?: number;
    max_reference_images?: number;
    max_reference_videos?: number;
    max_reference_audios?: number;
    supported_seconds?: number[];
    api: MarketplaceCall;
};
export type MarketplaceGroup = { id: number; name: string; models: MarketplaceModel[] };
export type MarketplaceResponse = { enabled: boolean; fields: string[]; groups: MarketplaceGroup[] };

export async function fetchModelCatalog(signal?: AbortSignal) {
    const response = await axios.get<MarketplaceResponse>("/api/models/catalog", { signal });
    return response.data;
}
