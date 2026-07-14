import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppTopNav } from "@/components/layout/app-top-nav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agentState = {
    token: "",
    enabled: false,
    connected: false,
    activity: "",
    connectError: "",
    panelOpen: false,
    connectAgent: vi.fn(),
    togglePanel: vi.fn(),
};

vi.mock("antd", () => ({
    Button: ({ children, icon, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", props, icon, children),
    Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-router-dom", () => ({
    Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
    useLocation: () => ({ pathname: "/video" }),
}));

vi.mock("@/constant/navigation-tools", () => ({ navigationTools: [] }));
vi.mock("@/components/layout/app-config-modal", () => ({ AppConfigModal: () => null }));
vi.mock("@/components/layout/mobile-nav-drawer", () => ({ MobileNavDrawer: () => null }));
vi.mock("@/components/layout/user-status-actions", () => ({ UserStatusActions: () => createElement("div", { "data-testid": "user-status-actions" }, "用户操作") }));
vi.mock("@/stores/use-agent-store", () => ({ useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState) }));
vi.mock("@/stores/use-config-store", () => ({ useConfigStore: (selector: (state: { openConfigDialog: ReturnType<typeof vi.fn> }) => unknown) => selector({ openConfigDialog: vi.fn() }) }));
vi.mock("lucide-react", () => ({
    Bot: () => createElement("span"),
    Menu: () => createElement("span"),
}));
vi.mock("@/lib/utils", () => ({ cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ") }));

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

function expectClasses(element: Element | null, classes: string[]) {
    expect(element).toBeTruthy();
    for (const className of classes) expect(element?.classList.contains(className), `${element?.className} contains ${className}`).toBe(true);
}

describe("AppTopNav", () => {
    it("moves mobile actions onto a separate row so they cannot overlap the menu", () => {
        act(() => root.render(createElement(AppTopNav)));

        const header = container.querySelector("header");
        const shell = header?.firstElementChild ?? null;
        const actions = shell?.lastElementChild ?? null;

        expectClasses(header, ["min-h-14"]);
        expectClasses(shell, ["min-h-14", "flex-wrap", "md:h-14", "md:flex-nowrap", "py-1.5", "md:py-0"]);
        expectClasses(actions, ["w-full", "justify-end", "md:w-auto"]);
    });
});
