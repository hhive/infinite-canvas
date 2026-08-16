import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchModelCatalog, message } = vi.hoisted(() => ({
    fetchModelCatalog: vi.fn(),
    message: { error: vi.fn(), success: vi.fn() },
}));

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
        fields: [],
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
                        calls: [{ label: "同步生成", method: "POST", path: "/v1/images/generations", example: "curl image-public", auth: "Bearer" }],
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
        expect(container.textContent).toContain("curl image-public");
    });
});
