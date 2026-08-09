import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeThemeName, useThemeStore } from "@/stores/use-theme-store";

describe("useThemeStore", () => {
    beforeEach(() => {
        localStorage.removeItem("infinite-canvas:theme_store");
        useThemeStore.setState({ theme: "light" });
    });

    it("uses light as the default theme", () => {
        expect(useThemeStore.getState().theme).toBe("light");
    });

    it.each([
        ["light", "light"],
        ["dark", "dark"],
        ["system", "light"],
        ["unknown", "light"],
        [null, "light"],
    ])("normalizes persisted theme %j to %s", (persisted, expected) => {
        expect(normalizeThemeName(persisted)).toBe(expected);
    });

    it("normalizes an unsupported persisted theme during hydration", async () => {
        localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "system" }, version: 0 }));
        vi.resetModules();

        const { useThemeStore: hydratedStore } = await import("@/stores/use-theme-store");

        expect(hydratedStore.getState().theme).toBe("light");
        expect(JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}").state?.theme).toBe("light");
    });

    it("preserves a dark persisted theme during hydration", async () => {
        localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
        vi.resetModules();

        const { useThemeStore: hydratedStore } = await import("@/stores/use-theme-store");

        expect(hydratedStore.getState().theme).toBe("dark");
        expect(JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}").state?.theme).toBe("dark");
    });

    it("repairs malformed persisted JSON during hydration", async () => {
        localStorage.setItem("infinite-canvas:theme_store", "{malformed-json");
        vi.resetModules();

        const { useThemeStore: hydratedStore } = await import("@/stores/use-theme-store");

        expect(hydratedStore.getState().theme).toBe("light");
        expect(JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}").state?.theme).toBe("light");
    });

    it("only applies the dark bootstrap theme for an exact dark value", () => {
        const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

        expect(html).toContain('s.state && s.state.theme === "dark" ? "dark" : "light"');
        expect(html).toContain('localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "light" }, version: 0 }))');
    });
});
