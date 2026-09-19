import { describe, expect, it } from "vitest";

import { formatDuration, maskAPIKey } from "@/pages/account/format";

describe("maskAPIKey", () => {
    it("masks long keys as first 6 + last 4", () => {
        // 与 Sub2API 面板 utils/maskApiKey.ts 同规则：长 key 露前 6 与后 4。
        const key = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
        expect(maskAPIKey(key)).toBe(`${key.slice(0, 6)}...${key.slice(-4)}`);
        expect(maskAPIKey(key)).not.toContain(key.slice(6, key.length - 4));
    });

    it("masks short keys as first 4 + ***", () => {
        expect(maskAPIKey("sk-shortkey1")).toBe("sk-s***");
        expect(maskAPIKey("abcdefghijkl")).toBe("abcd***");
    });

    it("falls back to a dash for empty input", () => {
        expect(maskAPIKey("")).toBe("-");
        expect(maskAPIKey(null)).toBe("-");
        expect(maskAPIKey(undefined)).toBe("-");
        expect(maskAPIKey("   ")).toBe("-");
    });
});

describe("formatDuration", () => {
    it("renders sub-second values in milliseconds", () => {
        expect(formatDuration(850)).toBe("850ms");
    });

    it("renders second-scale values with one decimal", () => {
        expect(formatDuration(1500)).toBe("1.5s");
    });

    it("falls back to a dash for missing or non-positive values", () => {
        expect(formatDuration(0)).toBe("-");
        expect(formatDuration(null)).toBe("-");
        expect(formatDuration(undefined)).toBe("-");
    });
});
