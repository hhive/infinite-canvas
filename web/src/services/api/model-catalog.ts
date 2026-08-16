import axios from "axios";

export type MarketplaceCall = { label: string; method: string; path: string; example: string; auth: string };
export type MarketplaceModel = {
    media_type: "image" | "video";
    name: string;
    model_name?: string;
    display_name?: string;
    note?: string;
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
    calls: MarketplaceCall[];
};
export type MarketplaceGroup = { id: number; name: string; models: MarketplaceModel[] };
export type MarketplaceResponse = { enabled: boolean; fields: string[]; groups: MarketplaceGroup[] };

export function imagePricingRows(model: MarketplaceModel) {
    const sizes = new Set(model.sizes ?? []);
    const qualities = new Set(model.qualities ?? []);
    return [
        ...(sizes.has("1k") ? [{ label: "1K", price: model.price_1k }] : []),
        ...(sizes.has("2k") ? [{ label: "2K", price: model.price_2k }] : []),
        ...(sizes.has("4k") ? [{ label: "4K", price: model.price_4k }] : []),
        ...(qualities.has("low") ? [{ label: "低", price: model.price_low }] : []),
        ...(qualities.has("medium") ? [{ label: "中", price: model.price_medium }] : []),
        ...(qualities.has("high") ? [{ label: "高", price: model.price_high }] : []),
    ];
}

export async function fetchModelCatalog(signal?: AbortSignal) {
    const response = await axios.get<MarketplaceResponse>("/api/models/catalog", { signal });
    return response.data;
}
