import type { MediaModel } from "@/services/api/media-models";

/** 媒体站图片模型的 2.6 能力模式值。 */
export const IMAGE_26_API_MODE = "images_2_6";

export type ImageOutputFormat = "png" | "gif" | "svg";
export type ImageComplexity = "" | "low" | "medium" | "high";

/**
 * 判断模型是否具备 2.6 能力。
 *
 * 目录里能查到该模型时以 `api_mode` 为准（2.6 名称也可能被配成普通 images）；
 * 查不到（直连渠道）时按模型名识别。
 */
export function supportsImage26(model: string, mediaModels: ReadonlyArray<Pick<MediaModel, "model" | "apiMode">> = []) {
    const name = model.includes("::") ? model.slice(model.indexOf("::") + 2) : model;
    const matched = mediaModels.find((item) => item.model === name);
    if (matched?.apiMode) return matched.apiMode === IMAGE_26_API_MODE;
    return /gpt-image-2\.6/i.test(name);
}

/** 非 2.6 的 Images 类模型也支持用复杂度选择质量档。 */
export function supportsImageComplexity(model: string, mediaModels: ReadonlyArray<Pick<MediaModel, "model" | "apiMode">> = []) {
    const name = model.includes("::") ? model.slice(model.indexOf("::") + 2) : model;
    const matched = mediaModels.find((item) => item.model === name);
    if (matched?.apiMode) return matched.apiMode === IMAGE_26_API_MODE || matched.apiMode === "images" || matched.apiMode === "images_official";
    return true;
}

/** 空串表示不显式传 complexity，由上游默认或按 quality 折算。 */
export function normalizeImageComplexity(value: string | undefined): ImageComplexity {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "low" || normalized === "medium" || normalized === "high" ? normalized : "";
}

export function normalizeImageOutputFormat(value: string | undefined): ImageOutputFormat {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "gif" || normalized === "svg" ? normalized : "png";
}

export function normalizeImageFrameCount(value: string | number | undefined) {
    const count = Math.floor(Number(value));
    if (!Number.isFinite(count)) return 9;
    return Math.min(16, Math.max(2, count));
}

export function normalizeImageFrameDurationMs(value: string | number | undefined) {
    const duration = Math.round(Number(value));
    if (!Number.isFinite(duration)) return 200;
    return Math.min(2000, Math.max(20, duration));
}

/** 服务端结果里的格式值可能是 png/jpeg/webp/gif/svg，统一映射到 MIME。 */
export function imageMimeTypeForFormat(value: string | undefined) {
    switch (String(value || "").trim().toLowerCase()) {
        case "gif":
            return "image/gif";
        case "svg":
            return "image/svg+xml";
        case "jpeg":
        case "jpg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        default:
            return "image/png";
    }
}
