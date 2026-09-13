import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 制作规划表链路的阶段标识。
 *
 * 这条链路要点两次模型（反推提示词、制作规划表分析）再渲染板面，全程只有节点上的 loading 状态，
 * 用户看不出现在跑到哪一步。这里把阶段显式暴露成顶部的一条常驻步骤条。
 */
export type CanvasStage = "reversePrompt" | "board";

/** 步骤顺序即执行顺序；索引用来判定「已完成 / 进行中 / 未开始」。 */
const STAGE_ORDER: CanvasStage[] = ["reversePrompt", "board"];

const STAGE_LABEL_KEYS: Record<CanvasStage, string> = {
    reversePrompt: "canvas.stageProgress.reversePrompt",
    board: "canvas.stageProgress.board",
};

export type CanvasStageProgressProps = {
    /** 当前阶段；null 表示没有进行中的链路，整体不渲染。 */
    stage: CanvasStage | null;
};

export function CanvasStageProgress({ stage }: CanvasStageProgressProps) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];

    // 挂钩子必须在提前返回之前，所以这里才判空。
    if (!stage) return null;

    const activeIndex = STAGE_ORDER.indexOf(stage);
    return (
        <div className="pointer-events-none absolute left-1/2 top-5 z-50 -translate-x-1/2">
            <div
                className="flex items-center gap-3 rounded-xl border px-4 py-2 shadow-lg backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" }}
                role="status"
                aria-live="polite"
            >
                {STAGE_ORDER.map((item, index) => {
                    const done = index < activeIndex;
                    const active = index === activeIndex;
                    return (
                        <div key={item} className="flex items-center gap-3">
                            {index > 0 ? <span className="h-px w-6" style={{ background: theme.toolbar.border }} /> : null}
                            <div className="flex items-center gap-1.5 text-xs" style={{ opacity: done || active ? 1 : 0.45 }}>
                                {done ? <Check className="size-3.5" style={{ color: theme.node.activeStroke }} /> : null}
                                {active ? <Loader2 className="size-3.5 animate-spin" /> : null}
                                <span className={active ? "font-medium" : undefined}>{t(STAGE_LABEL_KEYS[item])}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
