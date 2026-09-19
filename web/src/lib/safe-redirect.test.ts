import { describe, expect, it } from "vitest";

import { safeRedirect } from "@/lib/safe-redirect";

describe("safeRedirect", () => {
    it("accepts in-app absolute paths", () => {
        expect(safeRedirect("/account/keys")).toBe("/account/keys");
        expect(safeRedirect("/")).toBe("/");
        expect(safeRedirect("  /account/usage  ")).toBe("/account/usage");
    });

    it("falls back to the account overview for missing input", () => {
        expect(safeRedirect(null)).toBe("/account");
        expect(safeRedirect("")).toBe("/account");
        expect(safeRedirect("   ")).toBe("/account");
    });

    it("rejects anything that could leave the app", () => {
        // 协议相对与绝对 URL 都会跳到站外，必须一律拒绝。
        expect(safeRedirect("//evil.example")).toBe("/account");
        expect(safeRedirect("https://evil.example/steal")).toBe("/account");
        expect(safeRedirect("javascript:alert(1)")).toBe("/account");
    });
});
