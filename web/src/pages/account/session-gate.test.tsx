import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { AccountSessionGate } from "@/pages/account/components/session-gate";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = vi.hoisted(() => ({ authSource: null as "launch" | "password" | null, loaded: true }));

vi.mock("@/stores/use-session-store", () => ({
    useSessionStore: (selector: (state: { authSource: "launch" | "password" | null; loaded: boolean }) => unknown) => selector({ authSource: session.authSource, loaded: session.loaded }),
    ensureSessionLoaded: vi.fn(),
}));

vi.mock("antd", () => ({
    Button: ({ children, ...props }: ComponentProps<"button">) => createElement("button", props, children),
    Spin: () => createElement("span", { "data-testid": "spin" }),
}));

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
    session.authSource = null;
    session.loaded = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** 用真实路由渲染 /account/keys：如果页面把访客重定向到登录页，这里会直接观察到 URL 变化。 */
function renderAccountRoute() {
    router = createMemoryRouter(
        [
            { path: "/account/keys", element: createElement(AccountSessionGate, null, createElement("div", null, "KEY LIST")) },
            { path: "/login", element: createElement("div", null, "LOGIN PAGE") },
        ],
        { initialEntries: ["/account/keys"] },
    );
    act(() => root.render(createElement(RouterProvider, { router })));
}

describe("AccountSessionGate", () => {
    it("shows an inline login guide for visitors without a session and does not redirect", () => {
        renderAccountRoute();

        expect(container.textContent).toContain("请先登录");
        expect(container.textContent).not.toContain("KEY LIST");
        expect(router.state.location.pathname).toBe("/account/keys");
        expect(container.textContent).not.toContain("LOGIN PAGE");
    });

    it("offers a login link that returns to the current account page", () => {
        renderAccountRoute();

        const loginLink = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "去登录");
        expect(loginLink?.getAttribute("href")).toBe("/login?redirect=%2Faccount%2Fkeys");
    });

    it("offers a register link that returns to the current account page", () => {
        // 注册同样要带回跳：此前只有登录链接带 redirect，注册完会被丢到概览而不是原页。
        renderAccountRoute();

        const registerLink = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "注册账号");
        expect(registerLink?.getAttribute("href")).toBe("/register?redirect=%2Faccount%2Fkeys");
    });

    it("keeps the guide for launch sessions instead of blocking them", () => {
        session.authSource = "launch";
        renderAccountRoute();

        expect(container.textContent).toContain("请先登录");
        expect(container.textContent).not.toContain("KEY LIST");
        expect(router.state.location.pathname).toBe("/account/keys");
    });

    it("renders the page for password sessions", () => {
        session.authSource = "password";
        renderAccountRoute();

        expect(container.textContent).toContain("KEY LIST");
        expect(container.textContent).not.toContain("请先登录");
    });
});
