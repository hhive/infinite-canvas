import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";

import { apiErrorMessage, apiErrorStatus } from "@/services/api/request";

function axiosError(status: number, data: unknown) {
    return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, { status, statusText: "", data, headers: {}, config: {} } as AxiosResponse);
}

describe("apiErrorMessage", () => {
    it("prefers the upstream message that the media proxy passes through", () => {
        expect(apiErrorMessage(axiosError(401, { code: 401, message: "邮箱或密码错误" }), "登录失败", "网络异常")).toBe("邮箱或密码错误");
    });

    it("uses the caller's localized network text when the server is unreachable", () => {
        expect(apiErrorMessage(new AxiosError("Network Error", "ERR_NETWORK"), "Login failed", "Network error")).toBe("Network error");
    });

    it("falls back to the caller's text plus the status when the upstream has no message", () => {
        expect(apiErrorMessage(axiosError(500, "<html>"), "登录失败", "网络异常")).toBe("登录失败（HTTP 500）");
    });

    it("keeps a plain Error message", () => {
        expect(apiErrorMessage(new Error("boom"), "登录失败", "网络异常")).toBe("boom");
    });

    it("never hard-codes UI copy: with no network text it reuses the fallback", () => {
        expect(apiErrorMessage(new AxiosError("Network Error", "ERR_NETWORK"), "Login failed")).toBe("Login failed");
    });
});

describe("apiErrorStatus", () => {
    it("treats a request that never reached the server as status 0", () => {
        expect(apiErrorStatus(new AxiosError("Network Error", "ERR_NETWORK"))).toBe(0);
        expect(apiErrorStatus(axiosError(503, {}))).toBe(503);
        expect(apiErrorStatus(new Error("boom"))).toBe(0);
    });
});
