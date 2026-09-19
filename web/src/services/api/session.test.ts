import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSessionState, login, loginWithTotp, sendVerifyCode } from "@/services/api/session";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchSessionState", () => {
    it("reads the flat /api/session/me payload the media BFF returns", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: { auth_source: "password", user_id: 42, email: "u@example.com", username: "阿蒙", role: "user", api_key_id: 7, has_api_key: true },
        });

        expect(await fetchSessionState()).toEqual({
            authSource: "password",
            hasApiKey: true,
            user: { id: 42, email: "u@example.com", username: "阿蒙", role: "user" },
        });
    });

    it("keeps a launch identity without inventing a user when the id is missing", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { auth_source: "launch", user_id: 0 } });

        // 没有 has_api_key 字段时按「无可用 Key」处理，入口据此引导去创建。
        expect(await fetchSessionState()).toEqual({ authSource: "launch", hasApiKey: false, user: null });
    });

    it("treats an unrecognized auth_source as no session", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { auth_source: "cookie" } });

        expect(await fetchSessionState()).toEqual({ authSource: null, hasApiKey: false, user: null });
    });
});

describe("login", () => {
    it("returns null on a completed login so the caller refetches the session", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { auth_source: "password", user_id: 42 } });

        expect(await login({ email: "u@example.com", password: "secret" })).toBeNull();
        expect(axios.post).toHaveBeenCalledWith("/api/session/login", { email: "u@example.com", password: "secret" }, { withCredentials: true });
    });

    it("reports the masked email when the account needs a TOTP code", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { requires_2fa: true, user_email_masked: "u***@example.com" } });

        expect(await login({ email: "u@example.com", password: "secret" })).toEqual({ emailMasked: "u***@example.com" });
    });
});

describe("loginWithTotp", () => {
    it("submits only the code: the pending login stays server-side behind its cookie", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

        await loginWithTotp("123456");

        expect(axios.post).toHaveBeenCalledWith("/api/session/login/2fa", { totp_code: "123456" }, { withCredentials: true });
        expect(JSON.stringify(vi.mocked(axios.post).mock.calls)).not.toContain("pending_login_id");
    });
});

describe("sendVerifyCode", () => {
    it("forwards the email and captcha proof and returns the upstream countdown", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { code: 0, message: "success", data: { message: "Verification code sent successfully", countdown: 45 } } });

        expect(await sendVerifyCode("u@example.com", { turnstile_token: "proof" })).toBe(45);
        expect(axios.post).toHaveBeenCalledWith("/api/session/send-verify-code", { email: "u@example.com", turnstile_token: "proof" }, { withCredentials: true });
    });

    it("falls back to a local countdown when the upstream omits one", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { code: 0, message: "success", data: {} } });

        expect(await sendVerifyCode("u@example.com", {})).toBe(60);
    });
});
