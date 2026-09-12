import axios from "axios";

import type { MediaCapability } from "@/services/api/media-models";

export type MediaAPIKey = {
    id: number;
    name: string;
    maskedKey: string;
    groupName: string;
    imageModelCount: number;
    videoModelCount: number;
    /** 该 Key 分组可见的文本模型数；计数不可得时为 0。 */
    textModelCount: number;
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
            textModelCount: count(item.text_model_count),
            current: item.selected === true,
        }];
    });
}

export async function switchMediaAPIKey(apiKeyId: number, signal?: AbortSignal) {
    await axios.post("/api/session/api-key", { api_key_id: apiKeyId }, { withCredentials: true, signal });
}

/**
 * Key 选择器与切换逻辑共用的可用性计数。
 * 文本恒返回大于 0 的哨兵：文本模型权限由 Sub2API 在调用时校验，Media 侧不做前置过滤；
 * `text_model_count` 计数不可得时会返回 0，若仍按计数过滤会把可选 Key 全部禁用。
 * 文本也不能做计数前置过滤：Media 会话 Key 是全局的，按文本计数触发切换（activate）会让
 * 文本节点挂载时抢走图片/视频正在使用的会话 Key；文本的 Key 维度重试改走请求头
 * （见 lib/canvas/text-model-fallback 的 buildTextModelAttempts），不切换全局会话。
 */
export function mediaAPIKeyCapabilityCount(key: Pick<MediaAPIKey, "imageModelCount" | "videoModelCount" | "textModelCount">, capability: MediaCapability): number {
    if (capability === "text") return 1;
    return capability === "image" ? key.imageModelCount : key.videoModelCount;
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
