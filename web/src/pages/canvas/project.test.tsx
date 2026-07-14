import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasTopBar } from "@/pages/canvas/project";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/constant/env", () => ({ DOCS_URL: "https://docs.example.test" }));

vi.mock("antd", () => ({
    App: { useApp: () => ({ message: {} }) },
    Button: ({ children, icon, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", props, icon, children),
    Dropdown: ({ children }: { children: ReactElement }) => children,
    Modal: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? createElement("div", null, children) : null),
}));

vi.mock("@/components/layout/user-status-actions", () => ({
    UserStatusActions: () =>
        createElement("div", { className: "user-status-actions" },
            createElement("button", { type: "button", "aria-label": "配置" }, "配置"),
            createElement("button", { type: "button", "aria-label": "账户操作" }, "账户"),
        ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function renderTopBar(overrides: Partial<ComponentProps<typeof CanvasTopBar>> = {}) {
    const props: ComponentProps<typeof CanvasTopBar> = {
        title: "一个需要在窄屏省略显示的无限画布项目标题",
        titleDraft: "一个需要在窄屏省略显示的无限画布项目标题",
        isTitleEditing: false,
        onTitleDraftChange: vi.fn(),
        onStartTitleEditing: vi.fn(),
        onFinishTitleEditing: vi.fn(),
        onCancelTitleEditing: vi.fn(),
        canUndo: true,
        canRedo: true,
        onHome: vi.fn(),
        onProjects: vi.fn(),
        onCreateProject: vi.fn(),
        onDeleteProject: vi.fn(),
        onImportImage: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        agentOpen: false,
        compactAgentStatus: { connected: false, enabled: false, activity: "" },
        onToggleAgent: vi.fn(),
        ...overrides,
    };
    act(() => root.render(createElement(CanvasTopBar, props)));
    return props;
}

function button(name: string) {
    const matched = Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name);
    expect(matched, `button ${name}`).toBeTruthy();
    return matched as HTMLButtonElement;
}

function expectClasses(element: Element | null, classes: string[]) {
    expect(element).toBeTruthy();
    for (const className of classes) expect(element?.classList.contains(className), `${element?.className} contains ${className}`).toBe(true);
}

describe("CanvasTopBar", () => {
    it("keeps mobile controls visible with a shrinking ellipsized title", () => {
        const props = renderTopBar();

        const topBar = container.querySelector(".canvas-top-bar");
        const primary = container.querySelector(".canvas-top-bar-primary");
        const title = container.querySelector(".canvas-top-bar-title");
        const titleButton = button(props.title);
        const actions = container.querySelector(".canvas-top-bar-actions");

        expectClasses(topBar, ["flex-wrap", "md:flex-nowrap"]);
        expectClasses(primary, ["w-full", "min-w-0", "md:w-auto"]);
        expectClasses(title, ["min-w-0", "flex-1", "overflow-hidden"]);
        expectClasses(titleButton, ["block", "w-full", "min-w-0", "truncate"]);
        expectClasses(actions, ["ml-auto", "shrink-0"]);

        button("打开画布菜单");
        button("配置");
        button("账户操作");

        act(() => button("Codex 未连接").click());
        act(() => button("Agent").click());
        act(() => titleButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        expect(props.onToggleAgent).toHaveBeenCalledTimes(2);
        expect(props.onStartTitleEditing).toHaveBeenCalledOnce();
    });

    it("preserves the desktop control order", () => {
        renderTopBar();
        const controls = [
            button("打开画布菜单"),
            button("Codex 未连接"),
            button("配置"),
            button("账户操作"),
            button("Agent"),
        ];

        for (let index = 0; index < controls.length - 1; index += 1) {
            expect(controls[index].compareDocumentPosition(controls[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });
});
