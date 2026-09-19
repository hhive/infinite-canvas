import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AxiosError, type AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { parsePublicSettings, type PublicSettings } from "@/services/api/public-settings";
import RegisterPage from "@/pages/register";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    settings: null as PublicSettings | null,
    sendVerifyCode: vi.fn(),
    error: vi.fn(),
    navigate: vi.fn(),
    searchParams: new URLSearchParams(),
}));

vi.mock("@/hooks/use-public-settings", () => ({
    usePublicSettings: () => ({ settings: state.settings, error: "", retry: vi.fn() }),
}));

vi.mock("@/services/api/session", () => ({
    register: vi.fn(),
    sendVerifyCode: state.sendVerifyCode,
    login: vi.fn(),
    loginWithTotp: vi.fn(),
    fetchSessionState: vi.fn(),
    logout: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
    Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => createElement("a", { ...props, href: to }, children),
    useNavigate: () => state.navigate,
    useSearchParams: () => [state.searchParams],
}));

vi.mock("antd", () => {
    const Input = ({ value, onChange, ...props }: ComponentProps<"input">) => createElement("input", { ...props, value: value ?? "", onChange });
    Input.Password = ({ value, onChange, ...props }: ComponentProps<"input">) => createElement("input", { ...props, type: "password", value: value ?? "", onChange });
    return {
        App: { useApp: () => ({ message: { success: vi.fn(), error: state.error } }) },
        // 与 antd 一致：htmlType 缺省为 "button"，避免表单里的按钮被当成提交按钮
        Button: ({ children, htmlType, loading, block, ...props }: ComponentProps<"button"> & { htmlType?: "button" | "submit" | "reset"; loading?: boolean; block?: boolean }) => createElement("button", { ...props, type: htmlType ?? "button" }, children),
        Input,
        Result: ({ title, subTitle }: { title?: ReactNode; subTitle?: ReactNode }) => createElement("div", null, title, subTitle),
        Spin: () => createElement("span", null, "loading"),
    };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(overrides: Partial<PublicSettings>, query = "") {
    state.settings = { ...parsePublicSettings({}), ...overrides };
    // 每次渲染都重置 query 与导航记录，避免用例间互相污染。
    state.searchParams = new URLSearchParams(query);
    state.navigate.mockClear();
    act(() => root.render(createElement(RegisterPage)));
}

function fieldLabels() {
    return Array.from(container.querySelectorAll("label > span")).map((element) => element.textContent);
}

function buttonByText(text: string) {
    return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);
}

/** 构造真实的 AxiosError，否则 apiErrorMessage 认不出上游响应体，会退回本地兜底文案。 */
function axiosError(status: number, data: unknown) {
    return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, { status, statusText: "", data, headers: {}, config: {} } as AxiosResponse);
}

/** React 受控 input 需要走原生 setter 才能触发 onChange。 */
function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("RegisterPage fields driven by public settings", () => {
    it("hides the invitation code and email verification steps when they are disabled", () => {
        render({ registrationEnabled: true, invitationCodeEnabled: false, emailVerifyEnabled: false });

        expect(fieldLabels()).toEqual(["邮箱", "密码", "确认密码"]);
        expect(buttonByText("发送验证码")).toBeUndefined();
    });

    it("renders the invitation code field only when invitation codes are enabled", () => {
        render({ registrationEnabled: true, invitationCodeEnabled: true, emailVerifyEnabled: false });

        expect(fieldLabels()).toContain("邀请码");
        expect(fieldLabels()).not.toContain("邮箱验证码");
    });

    it("renders the email verification step only when email verification is enabled", () => {
        render({ registrationEnabled: true, invitationCodeEnabled: false, emailVerifyEnabled: true });

        expect(fieldLabels()).toContain("邮箱验证码");
        expect(fieldLabels()).not.toContain("邀请码");
        expect(buttonByText("发送验证码")).toBeTruthy();
    });

    it("replaces the whole form with a closed notice when registration is disabled", () => {
        render({ registrationEnabled: false, invitationCodeEnabled: true, emailVerifyEnabled: true });

        expect(container.textContent).toContain("注册暂未开放");
        expect(fieldLabels()).toEqual([]);
        expect(container.textContent).not.toContain("确认密码");
    });
});

describe("RegisterPage email verification code", () => {
    it("sends the code to the proxied endpoint and locks the button for the returned countdown", async () => {
        state.sendVerifyCode.mockResolvedValue(30);
        render({ registrationEnabled: true, emailVerifyEnabled: true });
        typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, "user@example.com");

        const button = buttonByText("发送验证码")!;
        await act(async () => {
            button.click();
        });

        expect(state.sendVerifyCode).toHaveBeenCalledWith("user@example.com", {});
        expect(buttonByText("重新发送（30s）")).toBeTruthy();
        expect(buttonByText("重新发送（30s）")?.disabled).toBe(true);
    });

    it("surfaces the upstream message when sending fails and leaves the button usable", async () => {
        state.sendVerifyCode.mockRejectedValue(axiosError(429, { code: 429, message: "请求过于频繁，请稍后再试" }));
        render({ registrationEnabled: true, emailVerifyEnabled: true });
        typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, "user@example.com");

        await act(async () => {
            buttonByText("发送验证码")!.click();
        });

        expect(state.error).toHaveBeenCalledWith("请求过于频繁，请稍后再试");
        expect(buttonByText("发送验证码")?.disabled).toBe(false);
    });

    it("refuses to send without an email address", async () => {
        render({ registrationEnabled: true, emailVerifyEnabled: true });

        await act(async () => {
            buttonByText("发送验证码")!.click();
        });

        expect(state.sendVerifyCode).not.toHaveBeenCalled();
        expect(state.error).toHaveBeenCalledWith("请输入邮箱");
    });
});
