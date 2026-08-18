import { describe, expect, it } from "vitest";

import { navigationTools } from "@/constant/navigation-tools";
import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

describe("navigation tools translations", () => {
    it("defines every navigation label in both supported locales", () => {
        for (const tool of navigationTools) {
            expect(zhCN.navigation[tool.slug]).toBeTruthy();
            expect(enUS.navigation[tool.slug]).toBeTruthy();
        }
        expect(zhCN.navigation.models).toBe("模型广场");
        expect(enUS.navigation.models).toBe("Model Marketplace");
    });
});
