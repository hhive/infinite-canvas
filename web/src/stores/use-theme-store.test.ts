import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "@/stores/use-theme-store";

describe("useThemeStore", () => {
    beforeEach(() => {
        localStorage.removeItem("infinite-canvas:theme_store");
        useThemeStore.setState({ theme: "light" });
    });

    it("uses light as the default theme", () => {
        expect(useThemeStore.getState().theme).toBe("light");
    });
});
