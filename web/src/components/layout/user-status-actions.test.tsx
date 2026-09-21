import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { UserStatusActions } from "@/components/layout/user-status-actions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = vi.hoisted(() => ({ authSource: null as "launch" | "password" | null }));

// 版本号常量来自构建期 define，测试里给一个可辨识的值即可用于断言「不再渲染版本号」。
const { TEST_VERSION } = vi.hoisted(() => ({ TEST_VERSION: "9.9.9-test" }));

vi.mock("@/constant/env", () => ({ APP_VERSION: TEST_VERSION, DOCS_URL: "https://docs.example.test" }));

vi.mock("@/stores/use-session-store", () => ({
    useSessionStore: (selector: (state: { authSource: "launch" | "password" | null }) => unknown) => selector({ authSource: session.authSource }),
}));

vi.mock("@/stores/use-config-store", () => ({
    useConfigStore: (selector: (state: { openConfigDialog: () => void }) => unknown) => selector({ openConfigDialog: vi.fn() }),
}));

vi.mock("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: "light"; setTheme: () => void }) => unknown) => selector({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/ui/animated-theme-toggler", () => ({ AnimatedThemeToggler: () => null }));

// 版本检查依赖构建期 define（__APP_RELEASES__），这里只关心版本号是否还渲染在顶栏。
vi.mock("@/hooks/use-version-check", () => ({
    useVersionCheck: () => ({ open: false, setOpen: vi.fn(), openReleaseModal: vi.fn(), latestVersion: TEST_VERSION, releases: [], checking: false, hasNewVersion: false, checkLatestRelease: vi.fn() }),
}));

vi.mock("@/lib/canvas-theme", () => ({
    canvasThemes: { light: { node: { text: "#292524" } }, dark: { node: { text: "#f5f5f4" } } },
}));

vi.mock("@/lib/utils", () => ({ cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ") }));

vi.mock("antd", () => ({
    App: { useApp: () => ({ message: { error: vi.fn(), success: vi.fn() } }) },
    Modal: () => null,
    Tag: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
    Timeline: () => null,
    Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-router-dom", () => ({
    Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => createElement("a", { ...props, href: to }, children),
}));

vi.mock("lucide-react", () => ({
    BookOpen: () => createElement("span"),
    Keyboard: () => createElement("span"),
    Puzzle: () => createElement("span"),
    Settings2: () => createElement("span"),
    UserRound: () => createElement("span"),
}));

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
    act(() => root.render(createElement(UserStatusActions)));
}

function links() {
    return Array.from(container.querySelectorAll("a"));
}

function accountLink() {
    return links().find((link) => link.getAttribute("href") === "/account") ?? null;
}

function externalLinks() {
    return links().filter((link) => (link.getAttribute("href") ?? "").startsWith("http"));
}

describe("UserStatusActions user center entry", () => {
    it("links to the user center for a password session", () => {
        session.authSource = "password";
        render();

        expect(accountLink()?.textContent).toContain("用户中心");
    });

    it("links to the user center for a visitor without a session", () => {
        render();

        expect(accountLink()?.textContent).toContain("用户中心");
    });

    it("hides the user center entry for launch sessions coming from Sub2API", () => {
        session.authSource = "launch";
        render();

        expect(accountLink()).toBeNull();
        expect(container.textContent).not.toContain("用户中心");
    });
});

describe("UserStatusActions version and repository entry points", () => {
    it.each([
        ["no session", null],
        ["password session", "password"],
        ["launch session", "launch"],
    ] as const)("does not render the version label or the GitHub link for %s", (_label, authSource) => {
        session.authSource = authSource;
        render();

        expect(container.textContent).not.toContain(TEST_VERSION);
        expect(externalLinks().some((link) => link.getAttribute("href")?.includes("github.com"))).toBe(false);
    });
});
