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
        expect(zhCN.navigation.pricing).toBe("模型广场");
        expect(enUS.navigation.pricing).toBe("Model Marketplace");
    });

    it("labels the config entry as system settings now that account owns the user-facing settings", () => {
        expect(zhCN.navigation.config).toBe("系统配置");
        expect(enUS.navigation.config).toBe("System Settings");
    });

    it("keeps the user center out of the left navigation and labels it for the top bar entry", () => {
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("account");
        expect(zhCN.navigation.account).toBe("用户中心");
        expect(enUS.navigation.account).toBe("User Center");
    });
});
