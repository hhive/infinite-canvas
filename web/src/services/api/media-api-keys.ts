import axios from "axios";

export type MediaAPIKey = {
    id: number;
    name: string;
    maskedKey: string;
    groupName: string;
    imageModelCount: number;
    videoModelCount: number;
    current: boolean;
};

export async function fetchMediaAPIKeys(signal?: AbortSignal): Promise<MediaAPIKey[]> {
    const response = await axios.get<unknown>("/api/session/api-keys", { withCredentials: true, signal });
    const envelope = record(response.data);
    const values = Array.isArray(envelope?.data) ? envelope.data : [];
    return values.flatMap((value) => {
        const item = record(value);
        const id = Number(item?.id);
        if (!item || !Number.isSafeInteger(id) || id <= 0) return [];
        return [{
            id,
            name: text(item.name) || `API Key ${id}`,
            maskedKey: text(item.mask),
            groupName: text(item.group_name) || "未分组",
            imageModelCount: count(item.image_model_count),
            videoModelCount: count(item.video_model_count),
            current: item.selected === true,
        }];
    });
}

export async function switchMediaAPIKey(apiKeyId: number, signal?: AbortSignal) {
    await axios.post("/api/session/api-key", { api_key_id: apiKeyId }, { withCredentials: true, signal });
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
