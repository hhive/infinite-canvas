import { describe, expect, it } from "vitest";

import { usageLogTotalTokens } from "@/services/api/user-center";

describe("usageLogTotalTokens", () => {
    it("sums input, output and both cache dimensions", () => {
        // 口径与 Sub2API 的 total_tokens 一致：不含缓存会让表格与统计卡互相矛盾。
        const log = { input_tokens: 100, output_tokens: 20, cache_creation_tokens: 30, cache_read_tokens: 7 };
        expect(usageLogTotalTokens(log)).toBe(157);
    });

    it("treats missing cache fields as zero", () => {
        // 用户端 DTO 的缓存字段是 omitempty，缺失时不能产生 NaN。
        const log = { input_tokens: 12, output_tokens: 3 };
        expect(usageLogTotalTokens(log)).toBe(15);
    });

    it("returns zero for an all-empty log", () => {
        expect(usageLogTotalTokens({ input_tokens: 0, output_tokens: 0 })).toBe(0);
    });
});
