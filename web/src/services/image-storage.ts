import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type SupportedImageFormat = {
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    extension: ".png" | ".jpg" | ".webp";
};

export const INVALID_IMAGE_FORMAT_MESSAGE = "图片格式无效，仅支持有效的 PNG、JPEG 或 WebP 图片";

export class InvalidImageFormatError extends Error {
    constructor() {
        super(INVALID_IMAGE_FORMAT_MESSAGE);
        this.name = "InvalidImageFormatError";
    }
}

export function isInvalidImageFormatError(error: unknown): error is InvalidImageFormatError {
    return error instanceof InvalidImageFormatError || (error instanceof Error && error.name === "InvalidImageFormatError");
}

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_REMOTE_LOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    ".pjp": "image/jpeg",
    ".jfif": "image/jpeg",
    ".jpe": "image/jpeg",
    ".pjpeg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
};

export const IMAGE_UPLOAD_ACCEPT = Object.keys(IMAGE_MIME_BY_EXTENSION).join(",");
export const GENERATED_IMAGE_STORAGE_SLOW_MS = 15_000;

export function imageMimeTypeFromFilename(filename: string) {
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    return IMAGE_MIME_BY_EXTENSION[extension];
}

export async function detectSupportedImageFormat(blob: Blob): Promise<SupportedImageFormat | undefined> {
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return { mimeType: "image/png", extension: ".png" };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { mimeType: "image/jpeg", extension: ".jpg" };
    }
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return { mimeType: "image/webp", extension: ".webp" };
    }
    return undefined;
}

export async function normalizeSupportedImageBlob(blob: Blob) {
    const format = await detectSupportedImageFormat(blob);
    if (!format) throw new InvalidImageFormatError();
    return { blob: blob.type === format.mimeType ? blob : new Blob([blob], { type: format.mimeType }), format };
}

type ImageReadOptions = { signal?: AbortSignal };

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return storeImage(input, options);

    let blob: Blob;
    try {
        blob = await fetchImageBlob(input, options);
    } catch (error) {
        if (options?.signal?.aborted || isNamedError(error, IMAGE_RESPONSE_ERROR) || isNamedError(error, IMAGE_TIMEOUT_ERROR) || !/^https?:\/\//i.test(input)) throw error;
        const meta = await loadImageMeta(input, options, IMAGE_REMOTE_LOAD_TIMEOUT_MS);
        if (!meta) throw error;
        return { url: input, width: meta.width, height: meta.height, bytes: 0, mimeType: "" };
    }
    return storeImage(blob, options);
}

async function storeImage(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const normalized = await normalizeSupportedImageBlob(blob);
    blob = normalized.blob;
    const storageKey = `image:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    try {
        const meta = await loadImageMeta(url, options);
        if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
        throwIfAborted(options?.signal);
        await store.setItem(storageKey, blob);
        throwIfAborted(options?.signal);
        objectUrls.set(storageKey, url);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type.startsWith("image/") ? blob.type : "" };
    } catch (error) {
        URL.revokeObjectURL(url);
        await store.removeItem(storageKey).catch(() => undefined);
        throw error;
    }
}

export async function uploadGeneratedImage(input: string | Blob, slowMs = GENERATED_IMAGE_STORAGE_SLOW_MS): Promise<UploadedImage> {
    const thresholdMs = Math.max(1, Math.floor(slowMs));
    const startedAt = performance.now();
    const timer = setTimeout(() => {
        console.warn("[canvas:image] local persistence slow", { elapsedMs: Math.round(performance.now() - startedAt), thresholdMs });
    }, thresholdMs);
    try {
        const uploaded = await uploadImage(input);
        console.info("[canvas:image] local persistence completed", { elapsedMs: Math.round(performance.now() - startedAt), bytes: uploaded.bytes });
        return uploaded;
    } catch (error) {
        console.warn("[canvas:image] local persistence failed", { elapsedMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : String(error) });
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function isNamedError(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const normalized = await normalizeSupportedImageBlob(blob);
    await store.setItem(storageKey, normalized.blob);
    const url = URL.createObjectURL(normalized.blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    let source = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (!source) {
        const url = image.dataUrl || image.url || "";
        if (!url) throw new InvalidImageFormatError();
        source = url.startsWith("data:") ? dataUrlToBlob(url) : await fetchImageBlob(url, options);
    }
    const normalized = await normalizeSupportedImageBlob(source);
    return blobToDataUrl(normalized.blob);
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}

export function dataUrlToBlob(dataUrl: string) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) throw new InvalidImageFormatError();
    try {
        const content = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
        const bytes = Uint8Array.from(content, (character) => character.charCodeAt(0));
        return new Blob([bytes], { type: match[1] || "application/octet-stream" });
    } catch {
        throw new InvalidImageFormatError();
    }
}
