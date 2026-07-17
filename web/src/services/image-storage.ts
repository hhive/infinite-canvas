import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";

export type UploadedImage = {
    url: string;
    storageKey: string;
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
const objectUrls = new Map<string, string>();

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

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const source = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const { blob, format } = await normalizeSupportedImageBlob(source);
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: format.mimeType };
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

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    let source = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (!source) {
        const url = image.dataUrl || image.url || "";
        if (!url) throw new InvalidImageFormatError();
        source = url.startsWith("data:") ? dataUrlToBlob(url) : await (await fetch(url)).blob();
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
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl: string) {
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
