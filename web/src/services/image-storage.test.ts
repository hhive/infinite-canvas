import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Blob>());

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (key: string, value: Blob) => {
                storage.set(key, value);
                return value;
            }),
            getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
            removeItem: vi.fn(async (key: string) => storage.delete(key)),
            iterate: vi.fn(async () => undefined),
        }),
    },
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed-id" }));
vi.mock("@/lib/image-utils", () => ({ readImageMeta: vi.fn(async () => ({ width: 2, height: 3, mimeType: "image/jpeg" })) }));

import { getImageBlob, IMAGE_UPLOAD_ACCEPT, imageMimeTypeFromFilename, uploadImage } from "@/services/image-storage";

function readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

describe("image storage MIME normalization", () => {
    beforeEach(() => {
        storage.clear();
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: vi.fn(() => "blob:test-image"),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it("normalizes an uppercase JPEG filename at the IndexedDB storage boundary without changing its payload", async () => {
        const input = new File([new Uint8Array([0, 17, 128, 255])], "reference.JPEG", { type: "application/octet-stream", lastModified: 123 });
        const originalDataUrl = await readAsDataUrl(input);

        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(uploaded.storageKey).toBe("image:fixed-id");
        expect(stored).toBeInstanceOf(Blob);
        expect(stored?.type).toBe("image/jpeg");
        expect(stored?.size).toBe(input.size);
        expect((await readAsDataUrl(stored as Blob)).split(",")[1]).toBe(originalDataUrl.split(",")[1]);
    });

    it.each([
        ["reference.PJP", "image/jpeg"],
        ["reference.JFIF", "image/jpeg"],
        ["reference.JPE", "image/jpeg"],
        ["reference.PJPEG", "image/jpeg"],
        ["reference.JPEG", "image/jpeg"],
        ["reference.JPG", "image/jpeg"],
        ["reference.PNG", "image/png"],
        ["reference.WEBP", "image/webp"],
    ])("maps the case-insensitive extension in %s to %s", (filename, expected) => {
        expect(imageMimeTypeFromFilename(filename)).toBe(expected);
        expect(imageMimeTypeFromFilename(filename.toLowerCase())).toBe(expected);
    });

    it.each([
        ["reference.pjp", "image/pjp"],
        ["reference.jfif", "image/jfif"],
        ["reference.jpe", "image/jpe"],
        ["reference.pjpeg", "image/pjpeg"],
        ["reference.jpeg", "image/jpeg"],
        ["reference.jpg", "image/jpg"],
        ["reference.jpg", ""],
        ["reference.jpg", "application/octet-stream"],
    ])("uses the JPEG extension for %s instead of the browser MIME %s", async (filename, browserMime) => {
        const input = new File([new Uint8Array([1, 2, 3])], filename, { type: browserMime });

        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(stored?.type).toBe("image/jpeg");
        expect(stored?.size).toBe(3);
    });

    it.each([
        ["reference.png", "image/jpeg", "image/png"],
        ["reference.webp", "application/octet-stream", "image/webp"],
    ])("normalizes %s from %s to %s at storage", async (filename, browserMime, expected) => {
        const uploaded = await uploadImage(new File([new Uint8Array([4, 5])], filename, { type: browserMime }));

        expect((await getImageBlob(uploaded.storageKey))?.type).toBe(expected);
    });

    it("leaves unsupported filename types unchanged for shared upload callers", async () => {
        const rejected = ["reference.gif", "reference.bmp", "reference.tiff", "reference.avif", "reference.heic", "reference.svg", "reference"];
        const input = new File([new Uint8Array([6, 7, 8, 9])], rejected[0], { type: "image/gif" });
        const originalDataUrl = await readAsDataUrl(input);

        expect(rejected.map(imageMimeTypeFromFilename)).toEqual(rejected.map(() => undefined));
        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(stored?.type).toBe("image/gif");
        expect(stored?.size).toBe(input.size);
        expect((await readAsDataUrl(stored as Blob)).split(",")[1]).toBe(originalDataUrl.split(",")[1]);
    });

    it("defines the exact image workbench accept list and filters files with the shared mapping", () => {
        const filenames = ["a.pjp", "b.jfif", "c.jpe", "d.pjpeg", "e.jpeg", "f.jpg", "g.png", "h.webp", "i.gif", "j.bmp", "k.tiff", "l.avif", "m.heic", "n.svg", "no-extension"];
        const files = filenames.map((filename) => new File([new Uint8Array([1])], filename));

        expect(IMAGE_UPLOAD_ACCEPT).toBe(".pjp,.jfif,.jpe,.pjpeg,.jpeg,.jpg,.png,.webp");
        expect(files.filter((file) => imageMimeTypeFromFilename(file.name)).map((file) => file.name)).toEqual(filenames.slice(0, 8));
    });
});
