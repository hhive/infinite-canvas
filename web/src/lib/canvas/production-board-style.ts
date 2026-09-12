// 制作规划板的视觉常量：配色与字体栈。
//
// 单独成文件是为了让版面渲染与俯视示意图共用同一套视觉语言，同时避免两者互相 import 形成环。
// 深色底的理由：板面主体是真实视频帧，深底能让帧与调色板色块都跳出来，也更接近影视制作板的观感。

export const BOARD_COLORS = {
    background: "#0E1116",
    panel: "#171C24",
    panelBorder: "#2A323E",
    grid: "#232B36",
    textPrimary: "#F2F5F8",
    textSecondary: "#A9B4C2",
    textMuted: "#6F7B8B",
    accent: "#FFB347",
    accentSoft: "#33280F",
    placeholder: "#1F2630",
    placeholderBorder: "#39424F",
    markerFill: "#FFB347",
    markerText: "#1A1204",
    path: "#4CC9F0",
} as const;

/** 字体栈必须带中日韩字体，否则中文会退化成方框或衬线体。 */
export const BOARD_FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Hiragino Sans GB", sans-serif';

/** 组装 canvas font 字符串：字号 + 字重 + 中日韩字体栈。 */
export function boardFont(size: number, weight: "normal" | "bold" = "normal"): string {
    return `${weight} ${Math.round(size)}px ${BOARD_FONT_FAMILY}`;
}
