import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { AppTopNav } from "@/components/layout/app-top-nav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = vi.hoisted(() => ({ authSource: null as "launch" | "password" | null }));

vi.mock("@/stores/use-session-store", () => ({
    useSessionStore: (selector: (state: { authSource: "launch" | "password" | null }) => unknown) => selector({ authSource: session.authSource }),
    ensureSessionLoaded: vi.fn(),
}));

vi.mock("@/stores/use-agent-store", () => ({
    useAgentStore: (selector: (state: { token: string; enabled: boolean; connected: boolean; panelOpen: boolean; connectAgent: () => void; togglePanel: () => void }) => unknown) =>
        selector({ token: "", enabled: false, connected: false, panelOpen: false, connectAgent: vi.fn(), togglePanel: vi.fn() }),
}));

vi.mock("antd", () => ({
    Button: ({ children, icon, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", props, icon, children),
    Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-router-dom", () => ({
    Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => createElement("a", { ...props, href: to }, children),
    useLocation: () => ({ pathname: "/image" }),
}));

vi.mock("@/components/layout/app-config-modal", () => ({ AppConfigModal: () => null }));
vi.mock("@/components/layout/login-prompt-modal", () => ({ LoginPromptModal: () => null }));
vi.mock("@/components/layout/mobile-nav-drawer", () => ({ MobileNavDrawer: () => null }));
vi.mock("@/components/layout/user-status-actions", () => ({ UserStatusActions: () => null }));
vi.mock("@/lib/utils", () => ({ cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ") }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    session.authSource = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render() {
    act(() => root.render(createElement(AppTopNav)));
}

function navLabels() {
    return Array.from(container.querySelectorAll("nav a")).map((link) => link.textContent ?? "");
}

describe("AppTopNav user center entry", () => {
    it("renders the user center entry next to a renamed system settings entry", () => {
        render();

        expect(navLabels()).toContain("用户配置");
        expect(navLabels()).toContain("系统配置");
        expect(navLabels()).not.toContain("配置");
    });

    it("hides the user center entry for launch sessions coming from Sub2API", () => {
        session.authSource = "launch";
        render();

        expect(navLabels()).not.toContain("用户配置");
        expect(navLabels()).toContain("系统配置");
    });
});
