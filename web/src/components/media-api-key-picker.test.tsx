import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { activate, select, state } = vi.hoisted(() => ({
    activate: vi.fn(),
    select: vi.fn(),
    state: {
        config: { apiKey: "", channels: [{ apiKey: "" }] },
        keys: [
            { id: 1, name: "绘图", maskedKey: "sk-****1234", groupName: "图片组", imageModelCount: 6, videoModelCount: 0 },
            { id: 2, name: "视频", maskedKey: "sk-****5678", groupName: "视频组", imageModelCount: 0, videoModelCount: 4 },
        ],
        currentKeyId: 1,
        status: "ready",
        error: "",
    },
}));

vi.mock("@/stores/use-config-store", () => ({ useConfigStore: (selector: (value: unknown) => unknown) => selector(state) }));
vi.mock("@/stores/use-media-api-key-store", () => ({
    useMediaAPIKeyStore: (selector: (value: unknown) => unknown) => selector({ ...state, activate, select }),
}));
vi.mock("antd", () => ({
    Select: ({ options, value, onChange, disabled, ...props }: { options: Array<{ value: number; label: ReactNode; disabled?: boolean }>; value?: number; onChange: (value: number) => void; disabled?: boolean } & Record<string, unknown>) =>
        createElement("select", { ...props, value, disabled, onChange: (event) => onChange(Number((event.currentTarget as HTMLSelectElement).value)) }, options.map((option) => createElement("option", { key: option.value, value: option.value, disabled: option.disabled }, option.label))),
}));

import { MediaAPIKeyPicker } from "@/components/media-api-key-picker";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.clearAllMocks();
    state.config = { apiKey: "", channels: [{ apiKey: "" }] };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(props: Partial<ComponentProps<typeof MediaAPIKeyPicker>> = {}) {
    act(() => root.render(createElement(MediaAPIKeyPicker, { capability: "image", taskActive: false, ...props })));
}

describe("MediaAPIKeyPicker", () => {
    it("shows only masked identities and disables keys without the active capability", () => {
        render();
        expect(container.textContent).toContain("绘图 · 图片组 · sk-****1234 · 图片 6 / 视频 0");
        expect(container.textContent).not.toContain("must-not-leak");
        expect((container.querySelector('option[value="2"]') as HTMLOptionElement).disabled).toBe(true);
        expect(activate).toHaveBeenCalledWith("image", false, true);
    });

    it("is hidden in manual API key mode", () => {
        state.config = { apiKey: "manual-secret", channels: [{ apiKey: "manual-secret" }] };
        render();
        expect(container.querySelector("select")).toBeNull();
        expect(activate).not.toHaveBeenCalled();
    });

    it("does not let pointer gestures bubble into the canvas", () => {
        let pointerDowns = 0;
        act(() => root.render(createElement("div", { onPointerDown: () => { pointerDowns += 1; } }, createElement(MediaAPIKeyPicker, { capability: "image", taskActive: false, compact: true }))));
        act(() => container.querySelector("select")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
        expect(pointerDowns).toBe(0);
    });
});
