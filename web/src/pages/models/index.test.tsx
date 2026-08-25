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
    Input: (props: ComponentProps<"input">) => createElement("input", props),
    Modal: ({ children, open, title }: { children?: ReactNode; open?: boolean; title?: ReactNode }) => (open ? createElement("section", { "data-testid": "model-modal" }, title, children) : null),
    Segmented: ({ options, value, onChange, ...props }: { options: Array<{ label: string; value: string }>; value: string; onChange: (value: string) => void; [key: string]: unknown }) => createElement("div", props, options.map((option) => createElement("button", { key: option.value, type: "button", "aria-pressed": value === option.value, onClick: () => onChange(option.value) }, option.label))),
    Select: ({ options, value, onChange, ...props }: { options: Array<{ label: string; value: string }>; value: string; onChange: (value: string) => void; [key: string]: unknown }) => createElement("select", { ...props, value, onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value) }, options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))),
    Spin: () => createElement("div", null, "loading"),
    Tag: ({ children, className }: { children?: ReactNode; className?: string }) => createElement("span", { className }, children),
}));

vi.mock("lucide-react", () => ({
    Copy: () => createElement("span"),
    ExternalLink: () => createElement("span"),
    RotateCcw: () => createElement("span"),
    Search: () => createElement("span"),
}));

import ModelsPage, { expandMarketplaceModels } from "@/pages/models";

let container: HTMLDivElement;
let root: Root;

function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
}

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
                        provider: "OpenAI",
                        note: "这是需要完整换行展示的公开模型备注，不应该被截断。",
                        calls: [{ label: "同步生成", method: "POST", path: "/v1/images/generations", example: longCallExample, auth: "Bearer" }],
                    },
                    {
                        media_type: "video", name: "video-public", model_name: "video-public", display_name: "视频模型", provider: "Google",
                        resolution_prices: { "720p": 1.25, "1k": 1.75 }, face_price: 0.5,
                        max_reference_images: 4, max_reference_videos: 2, max_reference_audios: 1,
                        supported_seconds: [4, 8], supported_resolutions: ["720p", "1k"],
                        supports_face: true, charge_mode: "second", calls: [],
                    },
                ],
            },
            {
                id: 2,
                name: "创意模型",
                models: [
                    {
                        media_type: "image", name: "flux-public", model_name: "flux-public", display_name: "Flux 绘图", provider: "Black Forest Labs", calls: [],
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
    it("renders marketplace cards under their Sub2API group headings", () => {
        const imageGroup = container.querySelector('[data-testid="marketplace-group-1"]');
        const creativeGroup = container.querySelector('[data-testid="marketplace-group-2"]');
        expect(imageGroup?.textContent).toContain("图片模型");
        expect(imageGroup?.textContent).toContain("2 个模型");
        expect(imageGroup?.textContent).toContain("完整显示名称");
        expect(creativeGroup?.textContent).toContain("创意模型");
        expect(creativeGroup?.textContent).toContain("Flux 绘图");
    });

    it("splits video models that support both billing modes and annotates examples", () => {
        const [count, second] = expandMarketplaceModels({
            media_type: "video", name: "dual-video", charge_modes: ["cnt", "second"],
            resolution_prices: { "720p": 9 },
            charge_mode_prices: { cnt: { "720p": 3.6 }, second: { "720p": 0.28 } },
            charge_mode_face_prices: { cnt: 0.5, second: 0.05 },
            calls: [{ label: "生成", method: "POST", path: "/v1/videos", auth: "Bearer", example: '{"model":"dual-video"}' }],
        });
        expect(count.charge_mode).toBe("cnt");
        expect(second.charge_mode).toBe("second");
        expect(count.resolution_prices).toEqual({ "720p": 3.6 });
        expect(second.resolution_prices).toEqual({ "720p": 0.28 });
        expect(count.face_price).toBe(0.5);
        expect(second.face_price).toBe(0.05);
        expect(count.calls[0].example).toContain('"charge_mode": "cnt"');
        expect(second.calls[0].example).toContain('"charge_mode": "second"');
    });

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

    it("filters by trimmed case-insensitive keyword, media type and provider while hiding empty groups", () => {
        const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]');
        expect(search).toBeTruthy();

        act(() => changeValue(search!, "  VIDEO-PUBLIC  "));
        expect(container.textContent).toContain("视频模型");
        expect(container.textContent).not.toContain("完整显示名称");
        expect(container.textContent).not.toContain("创意模型");
        expect(container.textContent).toContain("当前命中 1 / 共 3 个模型");

        act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "图片")?.click());
        expect(container.textContent).toContain("没有符合当前筛选条件的模型");

        act(() => changeValue(search!, ""));
        const provider = container.querySelector<HTMLSelectElement>('select[aria-label="供应商筛选"]');
        act(() => changeValue(provider!, "Black Forest Labs"));
        expect(container.textContent).toContain("Flux 绘图");
        expect(container.textContent).not.toContain("图片模型");
        expect(container.textContent).toContain("当前命中 1 / 共 3 个模型");
    });

    it("clears active filters and restores all models", () => {
        const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]');
        act(() => changeValue(search!, "missing"));
        expect(container.textContent).toContain("没有符合当前筛选条件的模型");

        act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "清空筛选")?.click());

        expect(search?.value).toBe("");
        expect(container.textContent).toContain("完整显示名称");
        expect(container.textContent).toContain("视频模型");
        expect(container.textContent).toContain("Flux 绘图");
        expect(container.textContent).toContain("当前命中 3 / 共 3 个模型");
    });

    it("keeps request failures separate from disabled state and retries loading", async () => {
        act(() => root.unmount());
        root = createRoot(container);
        fetchModelCatalog.mockReset();
        fetchModelCatalog.mockRejectedValueOnce(new Error("catalog unavailable")).mockResolvedValueOnce({ enabled: false, fields: [], groups: [] });

        await act(async () => root.render(createElement(ModelsPage)));

        expect(container.textContent).toContain("模型广场加载失败");
        expect(container.textContent).toContain("catalog unavailable");
        expect(container.textContent).not.toContain("模型广场暂未开放");

        await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "重试")?.click());

        expect(fetchModelCatalog).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain("模型广场暂未开放");
        expect(container.textContent).not.toContain("模型广场加载失败");
    });
});
