import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Blob>());
const setItemMock = vi.hoisted(() =>
    vi.fn(async (key: string, value: Blob) => {
        storage.set(key, value);
        return value;
    }),
);

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

import { storeGeneratedVideo } from "@/services/api/video";
import { uploadMediaFile } from "@/services/file-storage";

const HTML_ERROR_PAGE = "<!doctype html><html><body>media playground</body></html>";
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function responseFor(body: BlobPart, options: { status?: number; contentType?: string | null } = {}) {
    const status = options.status ?? 200;
    const headers = new Headers();
    if (options.contentType) headers.set("content-type", options.contentType);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        blob: async () => new Blob([body], { type: options.contentType ?? "" }),
    };
}

function stubFetch(response: unknown) {
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const originalCreateElement = document.createElement.bind(document);

/** jsdom 不加载媒体，readVideoMeta/readAudioMeta 会一直等 onloadedmetadata|onerror；这里让它立即走 onerror 分支。 */
function stubMediaElements() {
    const fake = () => {
        const element: Record<string, unknown> = { duration: 4, videoWidth: 1280, videoHeight: 720 };
        Object.defineProperty(element, "src", {
            configurable: true,
            set() {
                queueMicrotask(() => (element.onerror as (() => void) | undefined)?.());
            },
        });
        return element as unknown as HTMLElement;
    };
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: unknown) =>
        tag === "video" || tag === "audio" ? fake() : originalCreateElement(tag as "div", options as never)) as typeof document.createElement);
}

describe("uploadMediaFile 响应校验", () => {
    beforeEach(() => {
        storage.clear();
        setItemMock.mockClear();
        let objectUrlIndex = 0;
        vi.stubGlobal("URL", {
            createObjectURL: vi.fn(() => `blob:mock/${++objectUrlIndex}`),
            revokeObjectURL: vi.fn(),
        });
        stubMediaElements();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("200 + text/html 的错误页不得当作视频落盘", async () => {
        stubFetch(responseFor(HTML_ERROR_PAGE, { contentType: "text/html" }));

        await expect(uploadMediaFile("https://media.example.test/file_task/x.mp4", "video")).rejects.toThrow();
        // 关键回归点：坏内容一旦落盘就是永久坏死，绝不能写进 IndexedDB
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("200 + application/json 的错误体同样拒绝", async () => {
        stubFetch(responseFor('{"error":"internal"}', { contentType: "application/json" }));

        await expect(uploadMediaFile("https://media.example.test/file_task/x.mp4", "video")).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("非 2xx 响应拒绝", async () => {
        stubFetch(responseFor(HTML_ERROR_PAGE, { status: 404, contentType: "text/html" }));

        await expect(uploadMediaFile("https://media.example.test/file_task/x.mp4", "video")).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("200 + video/mp4 正常落盘", async () => {
        stubFetch(responseFor(MP4_BYTES, { contentType: "video/mp4" }));

        const uploaded = await uploadMediaFile("https://media.example.test/file_task/x.mp4", "video");

        expect(uploaded.storageKey).toBe("video:fixed-id");
        expect(uploaded.bytes).toBe(MP4_BYTES.byteLength);
        expect(uploaded.mimeType).toBe("video/mp4");
        expect(setItemMock).toHaveBeenCalledTimes(1);
    });

    it("缺少 content-type 时不误伤，仍按媒体落盘", async () => {
        stubFetch(responseFor(MP4_BYTES, { contentType: null }));

        const uploaded = await uploadMediaFile("https://media.example.test/file_task/x.mp4", "video");

        expect(uploaded.storageKey).toBe("video:fixed-id");
        expect(setItemMock).toHaveBeenCalledTimes(1);
    });

    it("Blob 输入若自身类型是错误页文本，同样拒绝", async () => {
        await expect(uploadMediaFile(new Blob([HTML_ERROR_PAGE], { type: "text/html" }), "video")).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("storeGeneratedVideo 抓到错误页时回退为远端地址，不再写坏本地缓存", async () => {
        stubFetch(responseFor(HTML_ERROR_PAGE, { contentType: "text/html" }));

        const stored = await storeGeneratedVideo({ url: "https://media.example.test/file_task/x.mp4", mimeType: "video/mp4" });

        expect(stored.url).toBe("https://media.example.test/file_task/x.mp4");
        expect(stored.storageKey).toBe("");
        expect(setItemMock).not.toHaveBeenCalled();
    });
});
