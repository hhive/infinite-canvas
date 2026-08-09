import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export function normalizeThemeName(theme: unknown): ThemeName {
    return theme === "dark" ? "dark" : "light";
}

const themeStateStorage: StateStorage = {
    getItem: (name) => {
        const value = localStorage.getItem(name);
        if (!value) return null;
        try {
            const parsed = JSON.parse(value) as unknown;
            const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
            const persistedState = root.state && typeof root.state === "object" && !Array.isArray(root.state) ? (root.state as Record<string, unknown>) : {};
            const normalized = JSON.stringify({ ...root, state: { ...persistedState, theme: normalizeThemeName(persistedState.theme) }, version: typeof root.version === "number" ? root.version : 0 });
            if (normalized !== value) localStorage.setItem(name, normalized);
            return normalized;
        } catch {
            const normalized = JSON.stringify({ state: { theme: "light" }, version: 0 });
            localStorage.setItem(name, normalized);
            return normalized;
        }
    },
    setItem: (name, value) => localStorage.setItem(name, value),
    removeItem: (name) => localStorage.removeItem(name),
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "light",
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: "infinite-canvas:theme_store",
            storage: createJSONStorage(() => themeStateStorage),
            merge: (persisted, current) => ({
                ...current,
                theme: normalizeThemeName((persisted as Partial<ThemeStore> | undefined)?.theme),
            }),
        },
    ),
);
