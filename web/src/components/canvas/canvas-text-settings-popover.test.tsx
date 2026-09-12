import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import { MAX_VIDEO_REVERSE_FRAME_RATE, MIN_VIDEO_REVERSE_FRAME_RATE } from "@/lib/canvas/video-frame-sampling-plan";
import type { AiConfig } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("antd", () => ({
    Button: ({ children, icon, onClick, className }: ComponentProps<"button"> & { icon?: ReactNode }) => createElement("button", { type: "button", onClick, className }, icon, children),
    InputNumber: ({ onChange, value, ...props }: { onChange?: (value: number | null) => void; value?: number } & Record<string, unknown>) =>
        createElement("input", { ...props, value: value ?? "", onChange: (event: Event) => onChange?.(Number((event.target as HTMLInputElement).value)) }),
    Select: ({ options, value, onChange, ...props }: { options: Array<{ label: ReactNode; value: number }>; value?: number; onChange?: (value: number) => void } & Record<string, unknown>) =>
        createElement(
            "select",
            { ...props, value, onChange: (event: Event) => onChange?.(Number((event.target as HTMLSelectElement).value)) },
            options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
        ),
}));

// 弹层里的推理强度面板与主题无关，替换为空以免把整个设置面板拖进测试。
vi.mock("@/components/text-settings-panel", () => ({
    TextSettingsPanel: () => null,
    reasoningEffortLabel: (value: string) => value,
}));

vi.mock("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: string }) => unknown) => selector({ theme: "light" }),
}));

import { CanvasTextSettingsPopover } from "@/components/canvas/canvas-text-settings-popover";
import "@/i18n";
import i18n from "@/i18n";

const config = {
    baseUrl: "https://api.example.com",
    apiKey: "",
    apiFormat: "openai",
    channels: [],
    model: "default::text-model",
    reasoningEffort: "auto",
} as unknown as AiConfig;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function renderPopover(props: Partial<Parameters<typeof CanvasTextSettingsPopover>[0]> = {}) {
    act(() => root.render(createElement(CanvasTextSettingsPopover, { config, onConfigChange: () => undefined, ...props })));
    // 弹层走 portal 且位置依赖按钮矩形，点击后才挂到 body 上。
    const trigger = container.querySelector("button");
    act(() => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function frameRateSelect(): HTMLSelectElement | null {
    return document.body.querySelector("select");
}

function optionLabels(select: HTMLSelectElement) {
    return Array.from(select.options).map((option) => option.textContent);
}

describe("抽帧速率的设置项", () => {
    it("文本设置弹层提供 1~5 帧/秒的速率选择，缺省选中 2", () => {
        renderPopover({ frameRate: 2, onFrameRateChange: () => undefined });

        const select = frameRateSelect();
        expect(select, "弹层里没有找到抽帧速率选择").not.toBeNull();
        expect(optionLabels(select!)).toEqual(["1 帧/秒", "2 帧/秒", "3 帧/秒", "4 帧/秒", "5 帧/秒"]);
        expect(select!.value).toBe("2");
        expect(MIN_VIDEO_REVERSE_FRAME_RATE).toBe(1);
        expect(MAX_VIDEO_REVERSE_FRAME_RATE).toBe(5);
    });

    it("节点上没有速率时默认展示 2 帧/秒", () => {
        renderPopover({ onFrameRateChange: () => undefined });
        expect(frameRateSelect()!.value).toBe("2");
    });

    it("节点上已有的速率会回填到选择项", () => {
        renderPopover({ frameRate: 5, onFrameRateChange: () => undefined });
        expect(frameRateSelect()!.value).toBe("5");
    });

    it("改速率时把数字回调出去，交给上层写入节点 metadata", () => {
        const onFrameRateChange = vi.fn();
        renderPopover({ frameRate: 2, onFrameRateChange });

        act(() => {
            const select = frameRateSelect()!;
            select.value = "4";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(onFrameRateChange).toHaveBeenCalledWith(4);
    });

    it("不提供速率回调时不渲染这一项（文本节点自身的设置面板无需抽帧速率）", () => {
        renderPopover({ count: 1, onCountChange: () => undefined });

        // 先确认弹层确实渲染了（生成次数那一项在），否则这里的 null 是空断言。
        expect(document.body.textContent).toContain("生成次数");
        expect(frameRateSelect()).toBeNull();
    });

    it("中英文都定义了速率相关的文案键", () => {
        expect(zhCN.settingsPanels.text.frameRate).toBe("抽帧速率");
        expect(zhCN.settingsPanels.text.frameRateUnit).toBe("帧/秒");
        expect(enUS.settingsPanels.text.frameRate).toBe("Frame sample rate");
        expect(enUS.settingsPanels.text.frameRateUnit).toBe("fps");
        for (const locale of [zhCN, enUS]) {
            expect(locale.settingsPanels.text.frameRateHint).toBeTruthy();
        }
    });

    it("切换语言后速率项的文案跟着切换", async () => {
        await act(async () => {
            await i18n.changeLanguage("en-US");
        });
        renderPopover({ frameRate: 2, onFrameRateChange: () => undefined });

        expect(optionLabels(frameRateSelect()!)).toEqual(["1 fps", "2 fps", "3 fps", "4 fps", "5 fps"]);
        await act(async () => {
            await i18n.changeLanguage("zh-CN");
        });
    });
});
