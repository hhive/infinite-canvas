import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { imageToDataUrl, message, prepareImageEditReferences, requestEdit, requestGeneration, storedLogs, uploadGeneratedImage, uploadImage } = vi.hoisted(() => ({
    imageToDataUrl: vi.fn(),
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    prepareImageEditReferences: vi.fn(),
    requestEdit: vi.fn(),
    requestGeneration: vi.fn(),
    storedLogs: new Map<string, unknown>(),
    uploadGeneratedImage: vi.fn(),
    uploadImage: vi.fn(),
}));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x01]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const FORMAT_ERROR_MESSAGE = "图片格式无效，仅支持有效的 PNG、JPEG 或 WebP 图片";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("localforage", () => ({
    default: {
        createInstance: ({ storeName }: { storeName: string }) => ({
            getItem: vi.fn(async (key: string) => (storeName === "image_generation_logs" ? storedLogs.get(key) ?? null : null)),
            setItem: vi.fn(async (key: string, value: unknown) => {
                if (storeName === "image_generation_logs") storedLogs.set(key, value);
                return value;
            }),
            removeItem: vi.fn(async (key: string) => {
                if (storeName === "image_generation_logs") storedLogs.delete(key);
            }),
            iterate: vi.fn(async (callback: (value: unknown, key: string, iterationNumber: number) => void) => {
                if (storeName === "image_generation_logs") Array.from(storedLogs).forEach(([key, value], index) => callback(value, key, index + 1));
            }),
        }),
    },
}));

vi.mock("@/services/image-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/image-storage")>()),
    imageToDataUrl,
    uploadGeneratedImage,
    uploadImage,
}));

vi.mock("@/services/image-task-storage", () => ({
    canResumeImageTask: vi.fn(() => true),
    imageTaskAuthIdentity: vi.fn(async () => "cookie-session"),
    readImageWorkbenchTasks: vi.fn(async () => []),
    removeImageWorkbenchTask: vi.fn(async () => undefined),
    resolveImageTaskCancel: vi.fn(),
    resumeImageWorkbenchRecord: vi.fn(),
    saveImageWorkbenchTask: vi.fn(async () => undefined),
}));

vi.mock("@/services/api/image", () => ({
    cancelImageTask: vi.fn(),
    prepareImageEditReferences,
    requestEdit,
    requestGeneration,
    resumeImageTask: vi.fn(),
}));

const config = {
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    quality: "auto",
    size: "1:1",
    count: "1",
};

vi.mock("@/stores/use-config-store", () => ({
    modelOptionLabel: () => "GPT Image",
    useConfigStore: (selector: (state: unknown) => unknown) =>
        selector({
            config,
            updateConfig: vi.fn(),
            isAiConfigReady: vi.fn(() => true),
            openConfigDialog: vi.fn(),
        }),
    useEffectiveConfig: () => config,
}));

vi.mock("@/stores/use-theme-store", () => ({ useThemeStore: (selector: (state: unknown) => unknown) => selector({ theme: "dark" }) }));
vi.mock("@/stores/use-asset-store", () => ({ useAssetStore: (selector: (state: unknown) => unknown) => selector({ addAsset: vi.fn() }) }));
vi.mock("@/stores/use-workbench-agent-store", () => ({
    useWorkbenchAgentStore: (selector: (state: unknown) => unknown) => selector({ imageCommand: null, clearImageCommand: vi.fn() }),
}));

vi.mock("@/components/image-settings-panel", () => ({ ImageSettingsPanel: () => null }));
vi.mock("@/components/model-picker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/media-api-key-picker", () => ({ MediaAPIKeyPicker: () => null }));
vi.mock("@/components/prompts/prompt-select-dialog", () => ({ PromptSelectDialog: () => null }));
vi.mock("@/components/canvas/asset-picker-modal", () => ({ AssetPickerModal: () => null }));

vi.mock("antd", () => {
    const Button = ({ children, icon, onClick, disabled, className }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", { type: "button", onClick, disabled, className }, icon, children);
    const Input = (props: ComponentProps<"input">) => createElement("input", props);
    Input.TextArea = (props: ComponentProps<"textarea">) => createElement("textarea", props);
    const Empty = ({ description }: { description?: ReactNode }) => createElement("div", null, description);
    Empty.PRESENTED_IMAGE_SIMPLE = "simple";
    return {
        App: { useApp: () => ({ message }) },
        Button,
        Checkbox: (props: ComponentProps<"input">) => createElement("input", { ...props, type: "checkbox" }),
        Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? createElement("div", null, children) : null),
        Empty,
        Image: (props: ComponentProps<"img">) => createElement("img", props),
        Input,
        Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? createElement("div", null, children) : null),
        Tag: ({ children, className }: { children?: ReactNode; className?: string }) => createElement("span", { className }, children),
        Tooltip: ({ children }: { children?: ReactNode }) => children,
        Typography: { Paragraph: ({ children }: { children?: ReactNode }) => createElement("p", null, children) },
    };
});

vi.mock("lucide-react", () => {
    const Icon = () => createElement("span");
    return {
        ArrowLeft: Icon,
        ArrowRight: Icon,
        BookOpen: Icon,
        CheckSquare: Icon,
        ClipboardPaste: Icon,
        Download: Icon,
        FolderPlus: Icon,
        History: Icon,
        ImagePlus: Icon,
        LoaderCircle: Icon,
        PenLine: Icon,
        Plus: Icon,
        SlidersHorizontal: Icon,
        Sparkles: Icon,
        Square: Icon,
        Trash2: Icon,
        Upload: Icon,
    };
});

import ImagePage from "@/pages/image";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
    storedLogs.clear();
    message.error.mockReset();
    message.success.mockReset();
    message.warning.mockReset();
    imageToDataUrl.mockReset();
    prepareImageEditReferences.mockReset();
    requestEdit.mockReset();
    requestGeneration.mockReset();
    const actualStorage = await vi.importActual<typeof import("@/services/image-storage")>("@/services/image-storage");
    imageToDataUrl.mockImplementation(actualStorage.imageToDataUrl);
    prepareImageEditReferences.mockImplementation(async (items: Array<{ dataUrl: string; storageKey?: string; url?: string }>) =>
        Promise.all(items.map(async (item) => ({ ...item, dataUrl: await imageToDataUrl(item), storageKey: undefined, url: undefined }))),
    );
    uploadImage.mockReset();
    uploadImage.mockImplementation(async (input: Blob) => {
        const bytes = new Uint8Array(await input.slice(0, 12).arrayBuffer());
        const mimeType = testImageMime(bytes);
        if (!mimeType) {
            const error = new Error(FORMAT_ERROR_MESSAGE);
            error.name = "InvalidImageFormatError";
            throw error;
        }
        const name = input instanceof File ? input.name : "clipboard";
        return { url: `blob:${name}`, storageKey: `image:${name}`, width: 1, height: 1, bytes: input.size, mimeType };
    });
    uploadGeneratedImage.mockReset();
    uploadGeneratedImage.mockResolvedValue({ url: "blob:generated", storageKey: "image:generated", width: 1280, height: 720, bytes: PNG_BYTES.byteLength, mimeType: "image/png" });
    requestEdit.mockResolvedValue([{ id: "generated", dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}` }]);
    requestGeneration.mockResolvedValue([{ id: "generated", dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}` }]);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: vi.fn(async () => []) } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
        root.render(createElement(ImagePage));
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("ImagePage reference uploads", () => {
    it("persists a generated result once and reuses the stored image metadata", async () => {
        const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
        const generateButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("开始生成"));
        expect(textarea).toBeTruthy();
        expect(generateButton).toBeTruthy();

        await act(async () => {
            textarea?.focus();
            if (textarea) {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "生成一张测试图片");
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                textarea.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        await act(async () => {
            generateButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(uploadGeneratedImage).toHaveBeenCalledOnce();
        expect(uploadGeneratedImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
        expect(container.querySelector('img[src="blob:generated"]')).toBeTruthy();
        expect(container.textContent).toContain("1280x720");
    });

    it("shows the completed server result before local persistence finishes", async () => {
        let finishPersistence!: (value: { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string }) => void;
        uploadGeneratedImage.mockReturnValueOnce(new Promise((resolve) => {
            finishPersistence = resolve;
        }));
        const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
        const generateButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("开始生成"));

        await act(async () => {
            if (textarea) {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "立即展示结果");
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            generateButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.querySelector('img[src^="data:image/png;base64,"]')).toBeTruthy();
        expect(container.textContent).not.toContain("生成中");

        await act(async () => {
            finishPersistence({ url: "blob:persisted", storageKey: "image:persisted", width: 1280, height: 720, bytes: PNG_BYTES.byteLength, mimeType: "image/png" });
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    it("uses the exact extension accept list on the real file input", () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        expect(input).toBeTruthy();
        expect(input?.accept).toBe(".pjp,.jfif,.jpe,.pjpeg,.jpeg,.jpg,.png,.webp");
    });

    it("shows the format error and keeps the reference list unchanged when every selected file is invalid", async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        expect(input).toBeTruthy();

        const files = [
            new File([GIF_BYTES], "blocked.gif", { type: "image/gif" }),
            new File([new Uint8Array([1, 2, 3, 4])], "blocked.bmp", { type: "image/bmp" }),
        ];
        Object.defineProperty(input, "files", { configurable: true, value: files });

        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(message.error).toHaveBeenCalledWith(FORMAT_ERROR_MESSAGE);
        expect(message.warning).not.toHaveBeenCalled();
        expect(container.querySelectorAll('img[alt]').length).toBe(0);
        expect(container.querySelector('img[alt="blocked.gif"]')).toBeNull();
        expect(container.querySelector('img[alt="blocked.bmp"]')).toBeNull();
    });

    it("adds valid references and warns with success and skipped counts for a mixed batch", async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        const files = [
            new File([PNG_BYTES], "allowed.png", { type: "image/png" }),
            new File([GIF_BYTES], "blocked.gif", { type: "image/gif" }),
        ];
        Object.defineProperty(input as HTMLInputElement, "files", { configurable: true, value: files });

        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(container.querySelector('img[alt="allowed.png"]')).toBeTruthy();
        expect(container.querySelector('img[alt="blocked.gif"]')).toBeNull();
        expect(message.warning).toHaveBeenCalledWith("已添加 1 张参考图，跳过 1 张无效图片：blocked.gif");
        expect(message.error).not.toHaveBeenCalled();
    });

    it("lists at most three invalid filenames and summarizes the remaining skipped files", async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        const files = [
            new File([PNG_BYTES], "allowed.png", { type: "image/png" }),
            new File([GIF_BYTES], "one.gif", { type: "image/gif" }),
            new File([GIF_BYTES], "two.bmp", { type: "image/bmp" }),
            new File([GIF_BYTES], "three.tiff", { type: "image/tiff" }),
            new File([GIF_BYTES], "four.avif", { type: "image/avif" }),
        ];
        Object.defineProperty(input as HTMLInputElement, "files", { configurable: true, value: files });

        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(message.warning).toHaveBeenCalledWith("已添加 1 张参考图，跳过 4 张无效图片：one.gif、two.bmp、three.tiff，另有 1 张");
        expect(message.warning.mock.calls[0]?.[0]).not.toContain("four.avif");
    });

    it("names a pasted WebP with a clipboard sequence and its real extension", async () => {
        const blob = new Blob([WEBP_BYTES], { type: "image/webp" });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { read: vi.fn(async () => [{ types: ["image/webp"], getType: vi.fn(async () => blob) }]) },
        });
        const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("剪切板"));

        await act(async () => {
            button?.click();
        });

        expect(container.querySelector('img[alt="剪贴板图片 1.webp"]')).toBeTruthy();
        expect(container.querySelector('img[alt$=".png"]')).toBeNull();
    });

    it("uses a clipboard sequence without a fake extension when reporting an invalid pasted blob", async () => {
        const blob = new Blob([GIF_BYTES], { type: "image/gif" });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { read: vi.fn(async () => [{ types: ["image/gif"], getType: vi.fn(async () => blob) }]) },
        });
        const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("剪切板"));

        await act(async () => {
            button?.click();
        });

        expect(message.error).toHaveBeenCalledWith(`${FORMAT_ERROR_MESSAGE}：剪贴板图片 1`);
        expect(container.querySelectorAll('img[alt]').length).toBe(0);
    });

    it("blocks an invalid historical reference before generation while preserving the editing state", async () => {
        storedLogs.set("history-invalid", {
            id: "history-invalid",
            createdAt: 1,
            title: "历史无效引用",
            prompt: "保留这段历史提示词",
            time: "2026/7/17 10:00:00",
            model: "gpt-image-2",
            config,
            references: [{ id: "legacy-ref", name: "历史伪装.png", type: "image/png", dataUrl: `data:image/png;base64,${Buffer.from(GIF_BYTES).toString("base64")}` }],
            durationMs: 1,
            successCount: 1,
            failCount: 0,
            imageCount: 1,
            size: "1:1",
            quality: "auto",
            status: "成功",
            images: [],
            thumbnails: [],
        });
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(createElement(ImagePage)));
        const logButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("历史无效引用"));
        await act(async () => logButton?.click());
        const generateButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("开始生成"));

        await act(async () => {
            generateButton?.click();
        });

        expect(message.error).toHaveBeenCalledWith(`${FORMAT_ERROR_MESSAGE}：历史伪装.png`);
        expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("保留这段历史提示词");
        expect(container.querySelector('img[alt="历史伪装.png"]')).toBeTruthy();
        expect(container.textContent).not.toContain("生成失败");
        expect(requestEdit).not.toHaveBeenCalled();
        expect(requestGeneration).not.toHaveBeenCalled();
    });

    it("locks generation synchronously while reference preparation is pending", async () => {
        const reference = { id: "pending-ref", name: "pending.png", type: "image/png", dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}` };
        storedLogs.set("pending-prepare", {
            id: "pending-prepare",
            createdAt: 1,
            title: "等待引用准备",
            prompt: "只允许启动一个批次",
            time: "2026/7/17 10:00:00",
            model: "gpt-image-2",
            config,
            references: [reference],
            durationMs: 1,
            successCount: 1,
            failCount: 0,
            imageCount: 1,
            size: "1:1",
            quality: "auto",
            status: "成功",
            images: [],
            thumbnails: [],
        });
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(createElement(ImagePage)));
        const logButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("等待引用准备"));
        await act(async () => logButton?.click());
        let releasePreparation!: (items: typeof reference[]) => void;
        const pendingPreparation = new Promise<typeof reference[]>((resolve) => {
            releasePreparation = resolve;
        });
        prepareImageEditReferences.mockReturnValue(pendingPreparation);
        requestEdit.mockRejectedValue(new Error("stop after request boundary"));
        const generateButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("开始生成"));

        await act(async () => {
            generateButton?.click();
            generateButton?.click();
            await Promise.resolve();
        });

        expect(prepareImageEditReferences).toHaveBeenCalledOnce();
        expect(requestEdit).not.toHaveBeenCalled();

        await act(async () => {
            releasePreparation([reference]);
            await pendingPreparation;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(prepareImageEditReferences).toHaveBeenCalledOnce();
        expect(requestEdit).toHaveBeenCalledOnce();
    });
});

function testImageMime(bytes: Uint8Array) {
    if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 12 && [0x52, 0x49, 0x46, 0x46].every((value, index) => bytes[index] === value) && [0x57, 0x45, 0x42, 0x50].every((value, index) => bytes[index + 8] === value)) return "image/webp";
    return undefined;
}
