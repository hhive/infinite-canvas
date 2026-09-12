import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import { MediaContentError, uploadMediaFile } from "@/services/file-storage";

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

const createObjectUrlMock = vi.fn((blob: Blob) => `blob:mock/${blob.size}`);

describe("媒体落盘前的响应类型校验", () => {
    beforeEach(() => {
        storage.clear();
        setItemMock.mockClear();
        createObjectUrlMock.mockClear();
        vi.stubGlobal("URL", {
            createObjectURL: createObjectUrlMock,
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

    it("非 2xx 但 content-type 看似媒体时也要拒绝（状态码守卫不得被 content-type 判定遮盖）", async () => {
        // 404 + application/octet-stream 不会命中非媒体判定，只有 !response.ok 能拦下它；
        // 若后续有人精简掉状态码判断，这条用例必须变红。
        stubFetch(responseFor(new Uint8Array([0, 1, 2, 3]), { status: 404, contentType: "application/octet-stream" }));

        await expect(uploadMediaFile("https://media.example.test/file_task/x.mp4", "video")).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("失败路径不得产生 blob 对象 URL（既不能落盘也不能泄漏）", async () => {
        stubFetch(responseFor(HTML_ERROR_PAGE, { contentType: "text/html" }));

        await expect(uploadMediaFile("https://media.example.test/file_task/x.mp4", "video")).rejects.toThrow();
        expect(createObjectUrlMock).not.toHaveBeenCalled();
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

    it("storeGeneratedVideo 抓到错误页时向上抛错，而不是静默回退成肯定播不了的地址", async () => {
        stubFetch(responseFor(HTML_ERROR_PAGE, { contentType: "text/html" }));

        await expect(storeGeneratedVideo({ url: "https://media.example.test/file_task/x.mp4", mimeType: "video/mp4" })).rejects.toThrow(MediaContentError);
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("storeGeneratedVideo 对非媒体判定之外的失败仍回退远端地址（瞬时失败不得当成坏内容）", async () => {
        // 500 走的是状态码分支（普通 Error），不是内容判定，应当保留 URL 回退让节点继续流式播放
        stubFetch(responseFor("<html>boom</html>", { status: 500, contentType: "text/html" }));

        const stored = await storeGeneratedVideo({ url: "https://media.example.test/file_task/x.mp4", mimeType: "video/mp4" });

        expect(stored.url).toBe("https://media.example.test/file_task/x.mp4");
        expect(stored.storageKey).toBe("");
    });

    it("assertVideoBlob 先解析 JSON 错误体再落媒体守卫（私有函数，用源码契约锁住）", () => {
        const source = readFileSync(resolve(process.cwd(), "src/services/api/video.ts"), "utf8");
        const matched = /async function assertVideoBlob\(blob: Blob\) \{([\s\S]*?)\n\}/.exec(source);
        expect(matched, "未能定位 assertVideoBlob 函数体").not.toBeNull();
        const body = matched![1];

        // 该守卫是私有函数、经公开路径触达需要拉起 axios，故用源码契约锁住两点：
        expect(body).toContain("assertMediaBlob(blob)");
        // JSON 分支必须排在前面，否则上游 msg 会被通用的"不是媒体内容"覆盖，诊断退化
        expect(body.indexOf("json")).toBeGreaterThanOrEqual(0);
        expect(body.indexOf("json")).toBeLessThan(body.indexOf("assertMediaBlob(blob)"));
    });

    // 音频侧会在落盘前把内容强制改写成 audio/*，改写之后 uploadMediaFile 的类型判定就失效了，
    // 因此闸门必须在改写之前；插件与非插件两条音频路径都汇入 storeGeneratedAudio。
    it("音频：text/html 内容不得被改写成 audio/* 后落盘", async () => {
        await expect(storeGeneratedAudio(new Blob([HTML_ERROR_PAGE], { type: "text/html" }), "mp3")).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    // 注意：这条锁的是 uploadMediaFile 内既有的落盘闸门（file-storage），
    // 并没有覆盖 assertVideoBlob —— 后者由下面那条源码契约用例覆盖。
    it("视频：非媒体 blob 不得落盘（锁 file-storage 的落盘闸门）", async () => {
        await expect(storeGeneratedVideo({ blob: new Blob([HTML_ERROR_PAGE], { type: "text/html" }) })).rejects.toThrow();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("音频：正常 audio/* 内容照常落盘", async () => {
        const stored = await storeGeneratedAudio(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), "mp3");

        expect(stored.storageKey).toBe("audio:fixed-id");
        expect(setItemMock).toHaveBeenCalledTimes(1);
    });
});
