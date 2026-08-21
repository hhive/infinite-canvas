import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Blob>());
const setItemMock = vi.hoisted(() => vi.fn(async (key: string, value: Blob) => {
    storage.set(key, value);
    return value;
}));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x01]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const FORMAT_ERROR_MESSAGE = "图片格式无效，仅支持有效的 PNG、JPEG 或 WebP 图片";

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            setItem: setItemMock,
            getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
            removeItem: vi.fn(async (key: string) => storage.delete(key)),
            iterate: vi.fn(async () => undefined),
        }),
    },
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed-id" }));
vi.mock("@/lib/image-utils", () => ({ readImageMeta: vi.fn(async () => ({ width: 2, height: 3, mimeType: "image/jpeg" })) }));

import { getImageBlob, IMAGE_UPLOAD_ACCEPT, imageMimeTypeFromFilename, imageToDataUrl, setImageBlob, uploadGeneratedImage, uploadImage } from "@/services/image-storage";

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
        setItemMock.mockClear();
        const objectUrlBlobs = new Map<string, Blob>();
        let objectUrlIndex = 0;
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: vi.fn((blob: Blob) => {
                const url = `blob:test-image-${++objectUrlIndex}`;
                objectUrlBlobs.set(url, blob);
                return url;
            }),
            revokeObjectURL: vi.fn(),
        });
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => ({
            blob: async () => objectUrlBlobs.get(String(input)) || new Blob(),
        })));
    });

    afterEach(() => vi.unstubAllGlobals());

    it("normalizes an uppercase JPEG filename at the IndexedDB storage boundary without changing its payload", async () => {
        const input = new File([JPEG_BYTES], "reference.JPEG", { type: "application/octet-stream", lastModified: 123 });
        const originalDataUrl = await readAsDataUrl(input);

        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(uploaded.storageKey).toBe("image:fixed-id");
        expect(stored).toBeInstanceOf(Blob);
        expect(stored?.type).toBe("image/jpeg");
        expect(stored?.size).toBe(input.size);
        expect((await readAsDataUrl(stored as Blob)).split(",")[1]).toBe(originalDataUrl.split(",")[1]);
    });

    it("warns about slow generated-image persistence without turning it into a failure", async () => {
        vi.useFakeTimers();
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const input = new File([PNG_BYTES], "generated.png", { type: "image/png" });
        let finishPersistence!: (blob: Blob) => void;
        setItemMock.mockImplementationOnce((_key: string, value: Blob) => new Promise<Blob>((resolve) => {
            finishPersistence = () => resolve(value);
        }));

        const pending = uploadGeneratedImage(input, 5);
        await vi.advanceTimersByTimeAsync(5);
        expect(warning).toHaveBeenCalledWith("[canvas:image] local persistence slow", expect.objectContaining({ thresholdMs: 5 }));

        finishPersistence(input);
        await expect(pending).resolves.toMatchObject({ bytes: input.size, mimeType: "image/png" });

        warning.mockRestore();
        vi.useRealTimers();
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
        const input = new File([JPEG_BYTES], filename, { type: browserMime });

        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(stored?.type).toBe("image/jpeg");
        expect(stored?.size).toBe(JPEG_BYTES.byteLength);
    });

    it.each([
        ["reference.png", "image/jpeg", "image/png"],
        ["reference.webp", "application/octet-stream", "image/webp"],
    ])("normalizes %s from %s to %s at storage", async (filename, browserMime, expected) => {
        const bytes = filename.endsWith(".png") ? PNG_BYTES : WEBP_BYTES;
        const uploaded = await uploadImage(new File([bytes], filename, { type: browserMime }));

        expect((await getImageBlob(uploaded.storageKey))?.type).toBe(expected);
    });

    it("uses the signature instead of an unsupported filename extension for shared upload callers", async () => {
        const input = new File([JPEG_BYTES], "reference.gif", { type: "image/gif" });

        expect(imageMimeTypeFromFilename(input.name)).toBeUndefined();
        const uploaded = await uploadImage(input);

        expect((await getImageBlob(uploaded.storageKey))?.type).toBe("image/jpeg");
    });

    it("defines the exact image workbench accept list and filters files with the shared mapping", () => {
        const filenames = ["a.pjp", "b.jfif", "c.jpe", "d.pjpeg", "e.jpeg", "f.jpg", "g.png", "h.webp", "i.gif", "j.bmp", "k.tiff", "l.avif", "m.heic", "n.svg", "no-extension"];
        const files = filenames.map((filename) => new File([new Uint8Array([1])], filename));

        expect(IMAGE_UPLOAD_ACCEPT).toBe(".pjp,.jfif,.jpe,.pjpeg,.jpeg,.jpg,.png,.webp");
        expect(files.filter((file) => imageMimeTypeFromFilename(file.name)).map((file) => file.name)).toEqual(filenames.slice(0, 8));
    });

    it.each([
        ["PNG", PNG_BYTES, "reference.jpg", "image/gif", "image/png"],
        ["JPEG", JPEG_BYTES, "reference.webp", "application/octet-stream", "image/jpeg"],
        ["WebP", WEBP_BYTES, "reference.png", "image/png", "image/webp"],
    ])("uses the %s signature instead of a conflicting filename or declared MIME", async (_format, bytes, filename, declaredMime, expectedMime) => {
        const input = new File([bytes], filename, { type: declaredMime });
        const originalPayload = (await readAsDataUrl(input)).split(",")[1];

        const uploaded = await uploadImage(input);
        const stored = await getImageBlob(uploaded.storageKey);

        expect(uploaded.mimeType).toBe(expectedMime);
        expect(stored?.type).toBe(expectedMime);
        expect(stored?.size).toBe(input.size);
        expect((await readAsDataUrl(stored as Blob)).split(",")[1]).toBe(originalPayload);
    });

    it("reads no more than the first 12 bytes to identify a supported signature", async () => {
        const input = new File([PNG_BYTES, new Uint8Array(128)], "reference.png", { type: "image/png" });
        const slice = vi.spyOn(input, "slice");

        await uploadImage(input);

        expect(slice).toHaveBeenCalled();
        expect(slice.mock.calls[0]?.[0]).toBe(0);
        expect(slice.mock.calls[0]?.[1]).toBe(12);
    });

    it.each([
        ["GIF", GIF_BYTES],
        ["random bytes", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
        ["empty content", new Uint8Array()],
        ["a short PNG prefix", PNG_BYTES.slice(0, 7)],
    ])("rejects %s even when the filename is .png", async (_label, bytes) => {
        await expect(uploadImage(new File([bytes], "fake.png", { type: "image/png" }))).rejects.toThrow(FORMAT_ERROR_MESSAGE);
        expect(storage.size).toBe(0);
    });

    it("normalizes setImageBlob by signature without changing the storage key or payload", async () => {
        const original = new Blob([WEBP_BYTES], { type: "image/gif" });
        const originalPayload = (await readAsDataUrl(original)).split(",")[1];

        await setImageBlob("image:legacy-set", original);
        const stored = await getImageBlob("image:legacy-set");

        expect(Array.from(storage.keys())).toEqual(["image:legacy-set"]);
        expect(stored?.type).toBe("image/webp");
        expect(stored?.size).toBe(original.size);
        expect((await readAsDataUrl(stored as Blob)).split(",")[1]).toBe(originalPayload);
    });

    it("normalizes a legacy IndexedDB blob at the imageToDataUrl request boundary", async () => {
        await setImageBlob("image:legacy-wrong-mime", new Blob([WEBP_BYTES], { type: "image/gif" }));

        const dataUrl = await imageToDataUrl({ storageKey: "image:legacy-wrong-mime" });

        expect(dataUrl).toBe(`data:image/webp;base64,${Buffer.from(WEBP_BYTES).toString("base64")}`);
        expect(storage.has("image:legacy-wrong-mime")).toBe(true);
    });

    it("normalizes a direct data URL by signature at the final request boundary", async () => {
        const conflicting = `data:image/gif;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

        await expect(imageToDataUrl({ dataUrl: conflicting })).resolves.toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`);
    });
});
