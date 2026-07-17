import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadImage } = vi.hoisted(() => ({ uploadImage: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async (_key: string, value: unknown) => value),
            removeItem: vi.fn(async () => undefined),
            iterate: vi.fn(async () => undefined),
        }),
    },
}));

vi.mock("@/services/image-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/image-storage")>()),
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
    requestEdit: vi.fn(),
    requestGeneration: vi.fn(),
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
vi.mock("@/components/prompts/prompt-select-dialog", () => ({ PromptSelectDialog: () => null }));
vi.mock("@/components/canvas/asset-picker-modal", () => ({ AssetPickerModal: () => null }));

vi.mock("antd", () => {
    const Button = ({ children, icon, onClick, disabled, className }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", { type: "button", onClick, disabled, className }, icon, children);
    const Input = (props: ComponentProps<"input">) => createElement("input", props);
    Input.TextArea = (props: ComponentProps<"textarea">) => createElement("textarea", props);
    const Empty = ({ description }: { description?: ReactNode }) => createElement("div", null, description);
    Empty.PRESENTED_IMAGE_SIMPLE = "simple";
    return {
        App: { useApp: () => ({ message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }) },
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
    uploadImage.mockReset();
    uploadImage.mockImplementation(async (file: File) => ({
        url: `blob:${file.name}`,
        storageKey: `image:${file.name}`,
        width: 1,
        height: 1,
        bytes: file.size,
        mimeType: "image/jpeg",
    }));
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
    it("uses the exact extension accept list on the real file input", () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        expect(input).toBeTruthy();
        expect(input?.accept).toBe(".pjp,.jfif,.jpe,.pjpeg,.jpeg,.jpg,.png,.webp");
    });

    it("only uploads supported filenames through the real file input change path", async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        expect(input).toBeTruthy();

        const files = [
            new File([new Uint8Array([1])], "allowed.JFIF", { type: "image/pjpeg" }),
            new File([new Uint8Array([2])], "blocked.gif", { type: "image/gif" }),
            new File([new Uint8Array([3])], "blocked.bmp", { type: "image/bmp" }),
            new File([new Uint8Array([4])], "no-extension", { type: "image/jpeg" }),
        ];
        Object.defineProperty(input, "files", { configurable: true, value: files });

        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(uploadImage).toHaveBeenCalledOnce();
        expect(uploadImage).toHaveBeenCalledWith(files[0]);
        expect(container.querySelector('img[alt="allowed.JFIF"]')).toBeTruthy();
        expect(container.querySelector('img[alt="blocked.gif"]')).toBeNull();
        expect(container.querySelector('img[alt="blocked.bmp"]')).toBeNull();
        expect(container.querySelector('img[alt="no-extension"]')).toBeNull();
    });
});
