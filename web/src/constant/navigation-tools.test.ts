import { describe, expect, it } from "vitest";

import { navigationTools, visibleNavigationTools } from "@/constant/navigation-tools";
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
});

describe("visibleNavigationTools", () => {
    const slugs = (authSource: Parameters<typeof visibleNavigationTools>[0]) => visibleNavigationTools(authSource).map((tool) => tool.slug);

    it("shows the user center entry for password sessions and for visitors without a session", () => {
        expect(slugs("password")).toContain("account");
        expect(slugs(null)).toContain("account");
    });

    it("hides the user center entry for launch sessions while keeping every other entry", () => {
        expect(slugs("launch")).not.toContain("account");
        expect(slugs("launch")).toEqual(navigationTools.map((tool) => tool.slug).filter((slug) => slug !== "account"));
    });
});
