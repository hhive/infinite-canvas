import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchModelCatalog, message } = vi.hoisted(() => ({
    fetchModelCatalog: vi.fn(),
    message: { error: vi.fn(), success: vi.fn() },
}));

const longCallExample = `curl -X POST 'https://media.example.com/v1/images/generations/with/a/very/long/path/that/must/wrap/inside/the/model/marketplace/dialog' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -d '{"model":"image-public-with-a-continuous-name-that-must-wrap-without-horizontal-dragging","prompt":"完整展示调用样例"}'`;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/api/model-catalog", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/api/model-catalog")>()),
    fetchModelCatalog,
}));

vi.mock("antd", () => ({
    App: { useApp: () => ({ message }) },
    Button: ({ children, icon, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", props, icon, children),
    Card: ({ children, title, onClick }: { children?: ReactNode; title?: ReactNode; onClick?: () => void }) => createElement("article", { onClick }, title, children),
    Empty: ({ description }: { description?: ReactNode }) => createElement("div", null, description),
    Modal: ({ children, open, title }: { children?: ReactNode; open?: boolean; title?: ReactNode }) => (open ? createElement("section", { "data-testid": "model-modal" }, title, children) : null),
    Spin: () => createElement("div", null, "loading"),
    Tag: ({ children, className }: { children?: ReactNode; className?: string }) => createElement("span", { className }, children),
}));

vi.mock("lucide-react", () => ({
    Copy: () => createElement("span"),
    ExternalLink: () => createElement("span"),
}));

import ModelsPage from "@/pages/models";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
    fetchModelCatalog.mockResolvedValue({
        enabled: true,
        fields: ["provider", "sizes", "qualities", "prices", "video_capabilities"],
        groups: [
            {
                id: 1,
                name: "图片模型",
                models: [
                    {
                        media_type: "image",
                        name: "image-public",
                        model_name: "image-public",
                        display_name: "完整显示名称",
                        note: "这是需要完整换行展示的公开模型备注，不应该被截断。",
                        calls: [{ label: "同步生成", method: "POST", path: "/v1/images/generations", example: longCallExample, auth: "Bearer" }],
                    },
                    {
                        media_type: "video", name: "video-public", model_name: "video-public", display_name: "视频模型",
                        resolution_prices: { "720p": 1.25, "1k": 1.75 }, face_price: 0.5,
                        max_reference_images: 4, max_reference_videos: 2, max_reference_audios: 1,
                        supported_seconds: [4, 8], supported_resolutions: ["720p", "1k"],
                        supports_face: true, charge_mode: "second", calls: [],
                    },
                ],
            },
        ],
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(ModelsPage)));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

describe("ModelsPage", () => {
    it("shows the complete public model note and preserves the existing card interaction", () => {
        const note = Array.from(container.querySelectorAll("p")).find((item) => item.textContent?.includes("公开模型备注"));

        expect(note).toBeTruthy();
        expect(note?.classList.contains("whitespace-pre-wrap")).toBe(true);
        expect(note?.classList.contains("break-words")).toBe(true);
        expect(note?.classList.contains("truncate")).toBe(false);
        expect(note?.className).not.toMatch(/line-clamp/);

        act(() => note?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

        expect(container.querySelector('[data-testid="model-modal"]')).toBeTruthy();
        const example = container.querySelector("pre");
        expect(example?.textContent).toBe(longCallExample);
        expect(example?.classList.contains("whitespace-pre-wrap")).toBe(true);
        expect(example?.classList.contains("break-words")).toBe(true);
        expect(example?.className).toContain("[overflow-wrap:anywhere]");
        expect(example?.classList.contains("overflow-x-auto")).toBe(false);
    });

    it("shows the complete video capability contract and billing unit", () => {
        expect(container.textContent).toContain("参考素材：4 图 / 2 视频 / 1 音频");
        expect(container.textContent).toContain("支持秒数：4 / 8");
        expect(container.textContent).toContain("支持分辨率：720p / 1k");
        expect(container.textContent).not.toContain("支持尺寸/画幅");
        expect(container.textContent).toContain("支持人脸：支持");
        expect(container.textContent).toContain("计费方式：按秒");
        expect(container.textContent).toContain("分辨率预扣额度：720p 1.25 / 秒 · 1k 1.75 / 秒");
        expect(container.textContent).toContain("卡脸附加预扣额度：0.5 / 秒");
        expect(container.textContent).not.toContain("预扣价格：");
    });
});
