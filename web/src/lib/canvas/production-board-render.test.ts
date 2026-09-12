// 制作规划板版面渲染测试。
//
// jsdom 没有真实 canvas，因此把「可测的部分」全部抽成纯函数（分区矩形、槽位对齐、
// 降级判定、标签排布、等比裁剪），再用记录式 ctx 断言绘制层「画了什么、顺序、关键文案」。
// 绘制层唯一不可测的是最终观感，那部分只能人工看渲染结果。
import { describe, expect, it } from "vitest";

import type { BoardLighting, BoardShot, ProductionBoardAnalysis } from "@/lib/canvas/production-board-schema";
import {
    buildCharacterLines,
    buildStoryboardAnnotations,
    characterTextCapacity,
    characterWorstCaseHeight,
    computeBoardLayout,
    computeCoverRetention,
    computeCoverSource,
    computeSectionBodyRect,
    computeStoryboardCellLayout,
    PRODUCTION_BOARD_DEFAULT_HEIGHT,
    PRODUCTION_BOARD_DEFAULT_WIDTH,
    PRODUCTION_BOARD_EMPTY_TEXT,
    PRODUCTION_BOARD_MAX_CHARACTER_COLUMNS,
    PRODUCTION_BOARD_MAX_LIGHTING_COLUMNS,
    PRODUCTION_BOARD_MAX_PALETTE_SWATCHES,
    PRODUCTION_BOARD_MAX_STORYBOARD_CELLS,
    PRODUCTION_BOARD_NO_FRAME_TEXT,
    PRODUCTION_BOARD_NO_MATERIAL_TEXT,
    PRODUCTION_BOARD_SECTION_BASIS_POINTS,
    PRODUCTION_BOARD_SECTION_MIN_BODY_HEIGHT,
    PRODUCTION_BOARD_SECTION_ORDER,
    PRODUCTION_BOARD_SECTION_TITLES,
    drawAudioSection,
    drawBoardHeader,
    drawCharacterSection,
    drawCinematographySection,
    drawEnvironmentSection,
    drawLightingSection,
    drawMoodSection,
    drawSharedDirection,
    drawStoryboardSection,
    fitFrameBox,
    frameImage,
    LANDSCAPE_FRAME_MAX_ASPECT,
    MIN_PORTRAIT_FRAME_RETENTION,
    planCharacterCellLayout,
    planFrameRow,
    planMoodTagRows,
    planPaletteSwatches,
    PORTRAIT_FRAME_MAX_ASPECT,
    renderProductionBoard,
    resolveCharacterSlots,
    resolveFrameOrientation,
    resolveLightingSlots,
    resolveProductionBoardSize,
    resolveSceneFrames,
    resolveStoryboardSlots,
} from "@/lib/canvas/production-board-render";
import { createRecordingCanvasContext } from "@/lib/canvas/production-board-test-canvas";
import type { SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";

type Rect = { x: number; y: number; width: number; height: number };

function frame(id: string, timestampMs = 0): SampledVideoFrame {
    return { dataUrl: `data:image/jpeg;base64,${id}`, timestampMs };
}

function shot(index: number): BoardShot {
    return { index, timeSec: index, cameraType: "手持", shotSize: "中景", movement: "跟拍", action: `第 ${index} 段动作与情绪` };
}

const SHOTS: BoardShot[] = Array.from({ length: 8 }, (_, index) => shot(index + 1));

const CHARACTER = { name: "送货员", appearance: "三十岁男性，神情疲惫", costume: "湿透的冲锋衣", consistency: "始终戴着头灯" };
const LIGHTING: BoardLighting = { name: "雨夜主光", timeOfDay: "夜", quality: "冷硬", note: "高窗侧逆光" };

const ANALYSIS: ProductionBoardAnalysis = {
    title: "雨夜归人",
    logline: "一个送货员在暴雨的旧仓库里等到了不该出现的人。",
    shared: {
        shotCount: 8,
        palette: [
            { name: "冷蓝", hex: "#1b2a41" },
            { name: "霓虹橙", hex: "#FF7A3D" },
            { name: "非法色", hex: "rgb(0,0,0)" },
        ],
        environment: "雨夜旧仓库，铁架与高窗",
        notes: "手持为主，高对比暗部保留",
    },
    characters: [CHARACTER],
    environment: {
        location: "旧仓库",
        description: "铁架与高窗，地面积水反射霓虹",
        cameraMoves: [
            { order: 1, position: "仓库入口左侧", shotType: "广角", movement: "推近" },
            { order: 2, position: "铁架正下方", shotType: "中景", movement: "横移" },
        ],
    },
    storyboard: SHOTS,
    lighting: [LIGHTING],
    moodKeywords: ["潮湿", "孤独", "紧张", "冷调"],
    audio: { ambient: "暴雨与远处车流", music: "低频弦乐", tone: "压抑" },
    cinematography: "手持跟拍为主，长焦压缩空间，暗部保留细节。",
};

function imageMap(frames: (SampledVideoFrame | null)[]): Map<string, CanvasImageSource> {
    const map = new Map<string, CanvasImageSource>();
    for (const item of frames) {
        if (item && !map.has(item.dataUrl)) map.set(item.dataUrl, { width: 1920, height: 1080 } as unknown as CanvasImageSource);
    }
    return map;
}

const RECT: Rect = { x: 34, y: 100, width: 1016, height: 244 };

describe("resolveProductionBoardSize", () => {
    it("缺省为 1080×1920 的 9:16", () => {
        expect(resolveProductionBoardSize()).toEqual({ width: 1080, height: 1920 });
    });

    it("非法尺寸回落缺省，不产生 NaN 画布", () => {
        expect(resolveProductionBoardSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ width: 1080, height: 1920 });
        expect(resolveProductionBoardSize(-100, 0)).toEqual({ width: 360, height: 640 });
    });

    it("过小的尺寸收敛到下限，保证分区还能放下文字", () => {
        const size = resolveProductionBoardSize(120, 200);
        expect(size.width).toBeGreaterThanOrEqual(360);
        expect(size.height).toBeGreaterThanOrEqual(640);
    });

    it("超大尺寸收敛到上限，避免画出浏览器存不下的画布", () => {
        expect(resolveProductionBoardSize(99999, 99999)).toEqual({ width: 4096, height: 4096 });
    });

    it("小数尺寸取整", () => {
        expect(resolveProductionBoardSize(1080.6, 1920.4)).toEqual({ width: 1080, height: 1920 });
    });
});

describe("computeBoardLayout", () => {
    it("九个分区自上而下排列，顺序固定", () => {
        const { sections } = computeBoardLayout(1080, 1920);
        expect(sections.map((section) => section.id)).toEqual([...PRODUCTION_BOARD_SECTION_ORDER]);
        expect(sections).toHaveLength(9);
    });

    it("每个分区都带中文标题，板面不会出现无题分区", () => {
        for (const section of computeBoardLayout(1080, 1920).sections) {
            expect(section.title).toBe(PRODUCTION_BOARD_SECTION_TITLES[section.id]);
            expect(section.title.trim().length).toBeGreaterThan(0);
        }
    });

    it("分区之间互不重叠，且都在板面之内", () => {
        const { sections } = computeBoardLayout(1080, 1920);
        for (const section of sections) {
            expect(section.rect.x).toBeGreaterThanOrEqual(0);
            expect(section.rect.y).toBeGreaterThanOrEqual(0);
            expect(section.rect.x + section.rect.width).toBeLessThanOrEqual(1080);
            expect(section.rect.y + section.rect.height).toBeLessThanOrEqual(1920);
            expect(section.rect.height).toBeGreaterThan(0);
        }
        for (let index = 1; index < sections.length; index += 1) {
            expect(sections[index].rect.y).toBeGreaterThanOrEqual(sections[index - 1].rect.y + sections[index - 1].rect.height);
        }
    });

    it("分区高度之和等于可用版面高度，不留意外的空白带", () => {
        const { sections, availableHeight } = computeBoardLayout(1080, 1920);
        const total = sections.reduce((sum, section) => sum + section.rect.height, 0);
        expect(total).toBe(availableHeight);
    });

    it("分区比例恰好铺满整版（基点为 1000），改比例时不会偶然留下空白或压叠", () => {
        const total = Object.values(PRODUCTION_BOARD_SECTION_BASIS_POINTS).reduce((sum, value) => sum + value, 0);
        expect(total).toBe(1000);
    });

    it("故事板分到最高的比例，它是板面主体", () => {
        const { sections } = computeBoardLayout(1080, 1920);
        const storyboard = sections.find((section) => section.id === "storyboard")!;
        for (const section of sections) {
            if (section.id !== "storyboard") expect(storyboard.rect.height).toBeGreaterThan(section.rect.height);
        }
    });

    it("换一个尺寸（720×1280）仍然合法", () => {
        const { sections, availableHeight } = computeBoardLayout(720, 1280);
        const total = sections.reduce((sum, section) => sum + section.rect.height, 0);
        expect(total).toBe(availableHeight);
        for (const section of sections) {
            expect(section.rect.height).toBeGreaterThan(0);
            expect(section.rect.x + section.rect.width).toBeLessThanOrEqual(720);
        }
    });

    it("极小尺寸下不产生 NaN 或负数矩形", () => {
        for (const section of computeBoardLayout(60, 40).sections) {
            expect(Number.isFinite(section.rect.x)).toBe(true);
            expect(Number.isFinite(section.rect.height)).toBe(true);
            expect(section.rect.width).toBeGreaterThanOrEqual(0);
            expect(section.rect.height).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("版面几何自检：1080×1920 下不会挤爆", () => {
    // 这组测试针对的是「肉眼才能发现的排版事故」：末行标注被裁掉、第 3 条灯光被挤掉、
    // 帧图被压成一条缝。它们全部由分区高度与格高预算决定，因此可以在这里锁死。
    const { sections } = computeBoardLayout(PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_DEFAULT_HEIGHT);
    const bodyOf = (id: string) => computeSectionBodyRect(sections.find((section) => section.id === id)!.rect);

    it("每个分区的正文区都放得下它的必备内容", () => {
        for (const section of sections) {
            expect(bodyOf(section.id).height).toBeGreaterThanOrEqual(PRODUCTION_BOARD_SECTION_MIN_BODY_HEIGHT[section.id]);
        }
    });

    it("故事板每格的帧图高度足够看清画面（不少于 120px）", () => {
        const layout = computeStoryboardCellLayout(bodyOf("storyboard"), 8);
        expect(layout.columns).toBe(4);
        expect(layout.rows).toBe(2);
        expect(layout.imageHeight).toBeGreaterThanOrEqual(120);
        expect(layout.cellWidth).toBeGreaterThanOrEqual(200);
    });

    it("帧图加标注的总高恰好等于格高，标注不会渗到下一行格子", () => {
        const layout = computeStoryboardCellLayout(bodyOf("storyboard"), 8);
        expect(layout.imageHeight + layout.labelBlockHeight).toBeCloseTo(layout.cellHeight, 6);
    });

    it("两行格子连同行间距纵向铺满正文区，不留空白带也不越界", () => {
        const body = bodyOf("storyboard");
        const layout = computeStoryboardCellLayout(body, 8);
        const used = layout.rows * layout.cellHeight + (layout.rows - 1) * layout.gap;
        expect(used).toBeCloseTo(body.height, 6);
        const horizontal = layout.columns * layout.cellWidth + (layout.columns - 1) * layout.gap;
        expect(horizontal).toBeLessThanOrEqual(body.width + 1e-6);
    });
});

describe("computeStoryboardCellLayout", () => {
    const body = { x: 0, y: 0, width: 992, height: 445 };

    it("横屏源：八格排成四列两行", () => {
        const layout = computeStoryboardCellLayout(body, 8, "landscape");
        expect(layout.columns).toBe(4);
        expect(layout.rows).toBe(2);
    });

    it("竖屏源：八格排成单行影片条", () => {
        const layout = computeStoryboardCellLayout(body, 8, "portrait");
        expect(layout.columns).toBe(8);
        expect(layout.rows).toBe(1);
    });

    it("横屏源列数不超过 4，格数再多也只是行数增加", () => {
        expect(computeStoryboardCellLayout(body, 12, "landscape").columns).toBe(4);
        expect(computeStoryboardCellLayout(body, 12, "landscape").rows).toBe(3);
    });

    it("不足上限时按实际格数分列，不留下空列", () => {
        expect(computeStoryboardCellLayout(body, 3, "landscape").columns).toBe(3);
        expect(computeStoryboardCellLayout(body, 3, "landscape").rows).toBe(1);
        expect(computeStoryboardCellLayout(body, 1, "landscape").columns).toBe(1);
        expect(computeStoryboardCellLayout(body, 2, "portrait").columns).toBe(2);
    });

    it("单行时动作标注多给一行（竖屏影片条把省下的高度还给文字）", () => {
        expect(computeStoryboardCellLayout(body, 8, "portrait").actionMaxLines).toBe(3);
        expect(computeStoryboardCellLayout(body, 8, "landscape").actionMaxLines).toBe(2);
    });

    it("正文区太矮时帧图高度归零，不会算出负值", () => {
        const layout = computeStoryboardCellLayout({ x: 0, y: 0, width: 400, height: 40 }, 4, "landscape");
        expect(layout.imageHeight).toBe(0);
        expect(layout.cellHeight).toBeGreaterThan(0);
    });

    it("零格时退化为 1×1，不产生除零", () => {
        const layout = computeStoryboardCellLayout(body, 0, "landscape");
        expect(layout.columns).toBe(1);
        expect(layout.rows).toBe(1);
        expect(Number.isFinite(layout.cellWidth)).toBe(true);
    });
});

describe("帧图裁剪保留比例（竖屏源问题的量化指标）", () => {
    const PORTRAIT_SOURCE = { width: 1080, height: 1920 };
    const LANDSCAPE_SOURCE = { width: 1920, height: 1080 };
    const body = { x: 0, y: 0, width: 992, height: 441 };
    const REAL_BODY = { x: 34, y: 700, width: 992, height: 441 };
    const boxOf = (orientation: "portrait" | "landscape", count = 8) => {
        const layout = computeStoryboardCellLayout(REAL_BODY, count, orientation);
        return { width: layout.cellWidth, height: layout.imageHeight };
    };

    it("竖屏源单行影片条：纵向内容 100% 保留", () => {
        const retention = computeCoverRetention(PORTRAIT_SOURCE, boxOf("portrait"))!;
        expect(retention.heightRatio).toBeCloseTo(1, 6);
    });

    it("横屏源四列两行：横向内容保留 85% 以上", () => {
        const retention = computeCoverRetention(LANDSCAPE_SOURCE, boxOf("landscape"))!;
        expect(retention.widthRatio).toBeGreaterThanOrEqual(0.85);
        expect(retention.heightRatio).toBeCloseTo(1, 6);
    });

    it("改前方案（八格四列两行 + 竖屏源）只有约 36% 纵向内容，这正是要修的问题", () => {
        // 保留旧几何做对照：240 宽的格子、两行格高对应的帧图高度。
        const legacy = computeCoverRetention(PORTRAIT_SOURCE, { width: 240, height: 151 })!;
        expect(legacy.heightRatio).toBeLessThan(0.4);
        expect(computeCoverRetention(PORTRAIT_SOURCE, boxOf("portrait"))!.heightRatio).toBeGreaterThan(legacy.heightRatio * 2.5);
    });

    it("影片条每格宽度仍在可读下限之上", () => {
        expect(boxOf("portrait").width).toBeGreaterThanOrEqual(110);
        expect(boxOf("landscape").width).toBeGreaterThanOrEqual(110);
    });

    it("两种朝向的帧图高度都够看清画面", () => {
        expect(boxOf("portrait").height).toBeGreaterThanOrEqual(120);
        expect(boxOf("landscape").height).toBeGreaterThanOrEqual(120);
    });

    it("cover 裁剪总有一维完整保留：框比源瘦长则保住整高、裁宽度", () => {
        const slim = computeCoverRetention(PORTRAIT_SOURCE, { width: 200, height: 500 })!;
        expect(slim.heightRatio).toBeCloseTo(1, 6);
        expect(slim.widthRatio).toBeLessThan(1);
    });

    it("cover 裁剪：框比源宽扁则保住整宽、裁高度", () => {
        const flat = computeCoverRetention(PORTRAIT_SOURCE, { width: 500, height: 200 })!;
        expect(flat.widthRatio).toBeCloseTo(1, 6);
        expect(flat.heightRatio).toBeLessThan(1);
        expect(computeCoverRetention(LANDSCAPE_SOURCE, { width: 1080, height: 1920 })!.heightRatio).toBeCloseTo(1, 6);
    });

    it("尺寸不可用时返回 null，不伪造保留比例", () => {
        expect(computeCoverRetention({ width: 0, height: 0 }, { width: 100, height: 100 })).toBeNull();
    });

    it("正文区尺寸取自真实版面，确保这组比例不是纸面数字", () => {
        const sections = computeBoardLayout(PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_DEFAULT_HEIGHT).sections;
        const storyboardBody = computeSectionBodyRect(sections.find((section) => section.id === "storyboard")!.rect);
        expect(storyboardBody.height).toBe(body.height);
    });
});

describe("fitFrameBox / planFrameRow：帧框可读性下限", () => {
    const REAL_BODY = computeSectionBodyRect(computeBoardLayout(PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_DEFAULT_HEIGHT).sections.find((section) => section.id === "characters")!.rect);

    it("竖屏源的框宽高比上限恰好对应 60% 纵向保留", () => {
        const box = fitFrameBox({ width: 1000, height: 100 }, "portrait");
        expect(box.width / box.height).toBeCloseTo(PORTRAIT_FRAME_MAX_ASPECT, 6);
        expect(computeCoverRetention({ width: 1080, height: 1920 }, box)!.heightRatio).toBeCloseTo(MIN_PORTRAIT_FRAME_RETENTION, 6);
    });

    it("横屏源的框宽高比上限是 2:1，不再出现横带", () => {
        expect(fitFrameBox({ width: 1000, height: 100 }, "landscape").width / 100).toBeCloseTo(LANDSCAPE_FRAME_MAX_ASPECT, 6);
        expect(fitFrameBox({ width: 1000, height: 100 }, null).width / 100).toBeCloseTo(LANDSCAPE_FRAME_MAX_ASPECT, 6);
    });

    it("可用空间本来就够窄时原样使用，不放大也不缩小", () => {
        expect(fitFrameBox({ width: 80, height: 200 }, "portrait")).toEqual({ width: 80, height: 200 });
    });

    it("高度为 0 时不产生畸形框", () => {
        expect(fitFrameBox({ width: 100, height: 0 }, "portrait")).toEqual({ width: 0, height: 0 });
    });

    it("整行居中：左右留白相等", () => {
        const container = { x: 100, y: 50, width: 488, height: 120 };
        const boxes = planFrameRow(container, 2, 8, "portrait");
        const left = boxes[0].x - container.x;
        const right = container.x + container.width - (boxes[1].x + boxes[1].width);
        expect(left).toBeCloseTo(right, 6);
    });

    it("零帧返回空数组，不画出空框", () => {
        expect(planFrameRow({ x: 0, y: 0, width: 400, height: 100 }, 0, 8, "portrait")).toEqual([]);
    });

    it("任意帧数下都不出现超宽扁的框，且全部留在容器内", () => {
        const container = { x: 10, y: 20, width: 488, height: 120 };
        for (const count of [1, 2, 3, 4, 5, 6]) {
            for (const orientation of ["portrait", "landscape"] as const) {
                for (const box of planFrameRow(container, count, 8, orientation)) {
                    expect(box.width / box.height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT);
                    expect(box.x).toBeGreaterThanOrEqual(container.x - 1e-6);
                    expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width + 1e-6);
                    expect(box.height).toBeLessThanOrEqual(container.height);
                }
            }
        }
    });

    it("横屏源下整行铺满容器宽度，不产生无谓空白", () => {
        const container = { x: 0, y: 0, width: 488, height: 120 };
        const boxes = planFrameRow(container, 2, 8, "landscape");
        expect(boxes[0].width).toBeCloseTo(240, 6);
        expect(boxes[1].x + boxes[1].width).toBeCloseTo(488, 6);
    });

    it("角色区正文区尺寸取自真实版面，比例断言不是纸面数字", () => {
        expect(REAL_BODY.width).toBeCloseTo(988, 6);
        expect(REAL_BODY.height).toBeCloseTo(180, 6);
    });
});

describe("帧框保留比例：环境 / 角色 / 灯光（竖屏源）", () => {
    const PORTRAIT = { width: 1080, height: 1920 };
    const LANDSCAPE = { width: 1920, height: 1080 };
    const sections = computeBoardLayout(PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_DEFAULT_HEIGHT).sections;
    const bodyOf = (id: string) => computeSectionBodyRect(sections.find((section) => section.id === id)!.rect);

    /** 环境分区左列：场景帧排成一行，下方留出描述文字。 */
    const environmentFrameRow = (count: number, orientation: "portrait" | "landscape") => {
        const body = bodyOf("environment");
        const leftWidth = Math.round((body.width - 12) * 0.5);
        const frameHeight = Math.min(120, body.height - 26 - 24);
        return planFrameRow({ x: body.x, y: body.y + 26, width: leftWidth, height: frameHeight }, count, 8, orientation);
    };

    /** 灯光分区右列：参考帧排成一行，占满正文高度。 */
    const lightingFrameRow = (count: number, orientation: "portrait" | "landscape") => {
        const body = bodyOf("lighting");
        const textWidth = Math.round((body.width - 12) * 0.62);
        const mediaWidth = body.width - 12 - textWidth;
        return planFrameRow({ x: body.x + textWidth + 12, y: body.y, width: mediaWidth, height: body.height }, count, 8, orientation);
    };

    const characterBox = (count: number, orientation: "portrait" | "landscape") => {
        const body = bodyOf("characters");
        const gap = 12;
        const columnWidth = (body.width - gap * (count - 1)) / count;
        return planCharacterCellLayout({ x: body.x, y: body.y, width: columnWidth, height: body.height }, orientation).imageBox;
    };

    it("环境场景帧：两帧也不低于 60%（改前 28.1%）", () => {
        const boxes = environmentFrameRow(2, "portrait");
        expect(boxes).toHaveLength(2);
        for (const box of boxes) {
            const retention = computeCoverRetention(PORTRAIT, box)!;
            expect(retention.heightRatio).toBeGreaterThanOrEqual(MIN_PORTRAIT_FRAME_RETENTION - 1e-6);
            expect(retention.heightRatio).toBeGreaterThan(0.281 * 2);
        }
    });

    it("角色帧：1 / 2 / 3 / 4 个角色都不低于 60%（改前 5.7% / 11.5% / 17.5% / 23.6%）", () => {
        const legacy = [0.057, 0.115, 0.175, 0.236];
        for (const count of [1, 2, 3, 4]) {
            const box = characterBox(count, "portrait");
            const retention = computeCoverRetention(PORTRAIT, box)!;
            expect(retention.heightRatio).toBeGreaterThanOrEqual(MIN_PORTRAIT_FRAME_RETENTION - 1e-6);
            expect(retention.heightRatio).toBeGreaterThan(legacy[count - 1] * 2);
        }
    });

    it("灯光参考帧：1 / 2 / 3 帧都不低于 60%（改前 17.6% / 36.0% / 55.3%）", () => {
        const legacy = [0.176, 0.36, 0.553];
        for (const count of [1, 2, 3]) {
            const boxes = lightingFrameRow(count, "portrait");
            expect(boxes).toHaveLength(count);
            for (const box of boxes) {
                const retention = computeCoverRetention(PORTRAIT, box)!;
                expect(retention.heightRatio).toBeGreaterThanOrEqual(MIN_PORTRAIT_FRAME_RETENTION - 1e-6);
            }
            expect(computeCoverRetention(PORTRAIT, boxes[0])!.heightRatio).toBeGreaterThan(legacy[count - 1] * 1.05);
        }
    });

    it("横屏源不受影响：环境两帧仍铺满、灯光横向保留不降", () => {
        const environment = environmentFrameRow(2, "landscape");
        expect(environment[1].x + environment[1].width).toBeCloseTo(environment[0].x + 488, 6);
        for (const box of environment) expect(computeCoverRetention(LANDSCAPE, box)!.widthRatio).toBeCloseTo(1, 6);

        const boxes = lightingFrameRow(1, "landscape");
        expect(computeCoverRetention(LANDSCAPE, boxes[0])!.widthRatio).toBeGreaterThanOrEqual(0.85);
    });

    it("结构断言：改后所有帧框的宽高比都不超过 2:1", () => {
        const boxes = [...environmentFrameRow(2, "portrait"), ...environmentFrameRow(2, "landscape"), ...lightingFrameRow(3, "portrait"), ...lightingFrameRow(3, "landscape")];
        for (const count of [1, 2, 3, 4]) {
            boxes.push(characterBox(count, "portrait"), characterBox(count, "landscape"));
        }
        expect(boxes.length).toBeGreaterThan(0);
        for (const box of boxes) expect(box.width / box.height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT + 1e-6);
    });
});

describe("planCharacterCellLayout", () => {
    const PORTRAIT_BODY = { x: 34, y: 700, width: 988, height: 180 };

    it("单角色：图与文字并排，图用满正文高度", () => {
        const cell = planCharacterCellLayout(PORTRAIT_BODY, "portrait");
        expect(cell.imageBox.height).toBeCloseTo(180, 6);
        expect(cell.imageBox.width).toBeCloseTo(180 * PORTRAIT_FRAME_MAX_ASPECT, 6);
        expect(cell.textRect.y).toBeCloseTo(PORTRAIT_BODY.y, 6);
        expect(cell.textRect.height).toBeCloseTo(180, 6);
    });

    it("单角色的文字区仍能一行放下 30 字（分析层限长不被打破）", () => {
        const cell = planCharacterCellLayout(PORTRAIT_BODY, "portrait");
        expect(cell.textRect.width).toBeGreaterThanOrEqual(420);
    });

    it("文字区高度不小于改前（不牺牲文字换图）", () => {
        const cell = planCharacterCellLayout(PORTRAIT_BODY, "portrait");
        expect(cell.textRect.height).toBeGreaterThanOrEqual(74);
    });

    it("上下排布分支：文字区与改前完全一致（宽度=列宽、高度=74）", () => {
        const columnWidth = (PORTRAIT_BODY.width - 12 * 3) / 4;
        const cell = planCharacterCellLayout({ ...PORTRAIT_BODY, width: columnWidth }, "portrait");
        expect(cell.layout).toBe("stacked");
        expect(cell.textRect.width).toBeCloseTo(columnWidth, 6);
        expect(cell.textRect.height).toBeCloseTo(74, 6);
        expect(cell.imageBox.x).toBeGreaterThanOrEqual(PORTRAIT_BODY.x - 1e-6);
        expect(cell.imageBox.x + cell.imageBox.width).toBeLessThanOrEqual(PORTRAIT_BODY.x + columnWidth + 1e-6);
    });

    it("图框在列内水平居中，不贴着左边缘", () => {
        const columnWidth = (PORTRAIT_BODY.width - 36) / 4;
        const column = { ...PORTRAIT_BODY, width: columnWidth };
        const cell = planCharacterCellLayout(column, "portrait");
        expect(cell.imageBox.x - column.x).toBeCloseTo(columnWidth - cell.imageBox.width - (cell.imageBox.x - column.x), 6);
    });

    it("任意列数下都不出现超宽扁框", () => {
        for (const count of [1, 2, 3, 4]) {
            for (const orientation of ["portrait", "landscape"] as const) {
                const columnWidth = (PORTRAIT_BODY.width - 12 * (count - 1)) / count;
                const cell = planCharacterCellLayout({ ...PORTRAIT_BODY, width: columnWidth }, orientation);
                expect(cell.imageBox.width / cell.imageBox.height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT + 1e-6);
            }
        }
    });

    it("正文区高度为 0 时不产生负值", () => {
        const cell = planCharacterCellLayout({ x: 0, y: 0, width: 100, height: 0 }, "portrait");
        expect(cell.imageBox.height).toBeGreaterThanOrEqual(0);
        expect(cell.textRect.height).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(cell.imageBox.width)).toBe(true);
    });
});

describe("角色并排判据：并排后文字容量不下降", () => {
    const BODY = { x: 34, y: 700, width: 988, height: 180 };
    const columnOf = (count: number) => {
        const gap = 12;
        return { ...BODY, width: (BODY.width - gap * (count - 1)) / count };
    };
    const cellOf = (count: number) => planCharacterCellLayout(columnOf(count), "portrait");
    /** 上下排布下的文字区，用来做容量对照。 */
    const stackedTextOf = (count: number) => {
        const column = columnOf(count);
        const imageHeight = Math.max(0, column.height - 80);
        return { x: column.x, y: column.y + imageHeight + 6, width: column.width, height: Math.max(0, column.height - imageHeight - 6) };
    };

    it("凡是采用并排的列数，文字区容量都不低于上下排布", () => {
        let sideBySideCount = 0;
        for (const count of [1, 2, 3, 4]) {
            const cell = cellOf(count);
            if (cell.layout !== "sideBySide") continue;
            sideBySideCount += 1;
            expect(characterTextCapacity(cell.textRect)).toBeGreaterThanOrEqual(characterTextCapacity(stackedTextOf(count)));
        }
        expect(sideBySideCount).toBeGreaterThan(0);
    });

    it("凡是采用并排的列数，文字区都放得下最坏情况（三条说明都写满 30 字）", () => {
        for (const count of [1, 2, 3, 4]) {
            const cell = cellOf(count);
            if (cell.layout !== "sideBySide") continue;
            expect(characterWorstCaseHeight(cell.textRect)).toBeLessThanOrEqual(cell.textRect.height);
        }
    });

    it("单角色与两角色采用并排（93.75×100 的图太小，看不清角色）", () => {
        expect(cellOf(1).layout).toBe("sideBySide");
        expect(cellOf(2).layout).toBe("sideBySide");
        expect(cellOf(2).imageBox.width).toBeCloseTo(168.75, 2);
        expect(cellOf(2).imageBox.height).toBeCloseTo(180, 6);
    });

    it("四角色并排会让文字区容量下降（68→44），因此保持上下排布", () => {
        const cell = cellOf(4);
        expect(cell.layout).toBe("stacked");
        expect(characterTextCapacity(cell.textRect)).toBeGreaterThanOrEqual(characterTextCapacity(stackedTextOf(4)));
        expect(cell.textRect.width).toBeCloseTo(columnOf(4).width, 6);
        expect(cell.textRect.height).toBeCloseTo(74, 6);
    });

    it("采用并排的分支，图框仍满足竖屏可读性下限", () => {
        for (const count of [1, 2, 3, 4]) {
            const cell = cellOf(count);
            const retention = computeCoverRetention({ width: 1080, height: 1920 }, cell.imageBox)!;
            expect(retention.heightRatio).toBeGreaterThanOrEqual(MIN_PORTRAIT_FRAME_RETENTION - 1e-6);
        }
    });

    it("两种排布都没有超宽扁框", () => {
        for (const count of [1, 2, 3, 4]) {
            for (const orientation of ["portrait", "landscape"] as const) {
                const cell = planCharacterCellLayout(columnOf(count), orientation);
                expect(cell.imageBox.width / cell.imageBox.height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT + 1e-6);
            }
        }
    });

    it("最坏情况高度随文字区变窄而增加，判据本身是有效的（不是恒真）", () => {
        expect(characterWorstCaseHeight({ x: 0, y: 0, width: 807, height: 180 })).toBeLessThan(characterWorstCaseHeight({ x: 0, y: 0, width: 141, height: 180 }));
        expect(characterWorstCaseHeight({ x: 0, y: 0, width: 57, height: 180 })).toBeGreaterThan(180);
    });
});

describe("resolveFrameOrientation", () => {
    const portraitImages = (count: number) => {
        const frames = Array.from({ length: count }, (_, index) => frame(`p${index}`));
        const images = new Map<string, CanvasImageSource>();
        for (const item of frames) images.set(item.dataUrl, { width: 1080, height: 1920 } as unknown as CanvasImageSource);
        return { frames, images };
    };
    const landscapeImages = (count: number) => {
        const frames = Array.from({ length: count }, (_, index) => frame(`l${index}`));
        const images = new Map<string, CanvasImageSource>();
        for (const item of frames) images.set(item.dataUrl, { width: 1920, height: 1080 } as unknown as CanvasImageSource);
        return { frames, images };
    };

    it("多数帧为竖屏时判定为竖屏", () => {
        const { frames, images } = portraitImages(6);
        expect(
            resolveFrameOrientation(
                frames.map((item) => ({ shot: SHOTS[0], frame: item })),
                images,
            ),
        ).toBe("portrait");
    });

    it("多数帧为横屏时判定为横屏", () => {
        const { frames, images } = landscapeImages(6);
        expect(
            resolveFrameOrientation(
                frames.map((item) => ({ shot: SHOTS[0], frame: item })),
                images,
            ),
        ).toBe("landscape");
    });

    it("同一段视频里混入少量异向帧时按多数派处理", () => {
        const { frames, images } = landscapeImages(4);
        const odd = frame("odd");
        images.set(odd.dataUrl, { width: 1080, height: 1920 } as unknown as CanvasImageSource);
        const slots = [...frames.map((item) => ({ shot: SHOTS[0], frame: item })), { shot: SHOTS[0], frame: odd }];
        expect(resolveFrameOrientation(slots, images)).toBe("landscape");
    });

    it("一帧都解不出来时回落到横屏网格（此时布局只影响占位框，取保守的既有版式）", () => {
        const slots = [{ shot: SHOTS[0], frame: frame("missing") }];
        expect(resolveFrameOrientation(slots, new Map())).toBe("landscape");
    });

    it("缺帧的格子不参与投票", () => {
        const { frames, images } = portraitImages(3);
        const slots = [{ shot: SHOTS[0], frame: null }, { shot: SHOTS[0], frame: null }, ...frames.map((item) => ({ shot: SHOTS[0], frame: item }))];
        expect(resolveFrameOrientation(slots, images)).toBe("portrait");
    });
});

describe("resolveStoryboardSlots", () => {
    it("帧按序号与镜头一一对齐", () => {
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const { slots } = resolveStoryboardSlots(SHOTS, frames);
        expect(slots).toHaveLength(SHOTS.length);
        expect(slots[0].frame?.dataUrl).toBe(frames[0].dataUrl);
        expect(slots[7].frame?.dataUrl).toBe(frames[7].dataUrl);
    });

    it("缺少对应帧时保持为 null，绝不拿别的帧顶替", () => {
        const frames = [frame("f1"), null, frame("f3")];
        const { slots } = resolveStoryboardSlots(SHOTS.slice(0, 3), frames);
        expect(slots[1].frame).toBeNull();
        expect(slots[0].frame).not.toBeNull();
    });

    it("抽帧数量少于镜头时，多出的镜头帧为 null", () => {
        const { slots } = resolveStoryboardSlots(SHOTS, [frame("f1")]);
        expect(slots).toHaveLength(SHOTS.length);
        expect(slots[1].frame).toBeNull();
    });

    it("抽帧数量多于镜头时按镜头数量截断，不会多画格子", () => {
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const { slots } = resolveStoryboardSlots(SHOTS.slice(0, 2), frames);
        expect(slots).toHaveLength(2);
    });

    it("镜头超过 8 个时只保留 8 格，并给出未展示数量", () => {
        const many = Array.from({ length: 11 }, (_, index) => shot(index + 1));
        const { slots, hiddenCount } = resolveStoryboardSlots(many, []);
        expect(slots).toHaveLength(PRODUCTION_BOARD_MAX_STORYBOARD_CELLS);
        expect(hiddenCount).toBe(11 - PRODUCTION_BOARD_MAX_STORYBOARD_CELLS);
    });

    it("空镜头列表返回空槽位，由上层画未覆盖文案", () => {
        expect(resolveStoryboardSlots([], []).slots).toEqual([]);
    });
});

describe("buildStoryboardAnnotations", () => {
    it("四项标注齐全：镜头类型、景别、运动方式、动作与情绪", () => {
        const lines = buildStoryboardAnnotations({ index: 1, timeSec: 0, cameraType: "手持", shotSize: "特写", movement: "跟拍", action: "回头" });
        const text = lines.join("\n");
        expect(text).toContain("手持");
        expect(text).toContain("特写");
        expect(text).toContain("跟拍");
        expect(text).toContain("回头");
    });

    it("字段为空时回落到未标注，不画出空标签", () => {
        const lines = buildStoryboardAnnotations({ index: 1, timeSec: 0, cameraType: "", shotSize: "  ", movement: "", action: "" });
        expect(lines.join("\n")).toContain(PRODUCTION_BOARD_EMPTY_TEXT);
    });
});

describe("resolveCharacterSlots", () => {
    it("角色与帧按列对齐", () => {
        const slots = resolveCharacterSlots([CHARACTER], [frame("c1")]);
        expect(slots).toHaveLength(1);
        expect(slots[0].name).toBe("送货员");
        expect(slots[0].frame?.dataUrl).toBe(frame("c1").dataUrl);
    });

    it("没有角色帧时帧为 null，交给绘制层画素材未覆盖", () => {
        const slots = resolveCharacterSlots([CHARACTER], []);
        expect(slots[0].frame).toBeNull();
        expect(slots[0].lines.join("")).toContain("冲锋衣");
    });

    it("没有角色也没有帧时返回空数组", () => {
        expect(resolveCharacterSlots([], [])).toEqual([]);
    });

    it("角色数量超过上限时截断列数，避免文字挤成一团", () => {
        const many = Array.from({ length: 6 }, (_, index) => ({ ...CHARACTER, name: `角色${index}` }));
        expect(resolveCharacterSlots(many, [])).toHaveLength(PRODUCTION_BOARD_MAX_CHARACTER_COLUMNS);
    });
});

describe("resolveLightingSlots", () => {
    it("条目与帧按列对齐", () => {
        const slots = resolveLightingSlots([LIGHTING], [frame("l1")]);
        expect(slots[0].title).toContain("雨夜主光");
        expect(slots[0].title).toContain("夜");
        expect(slots[0].detail).toContain("冷硬");
        expect(slots[0].detail).toContain("高窗侧逆光");
        expect(slots[0].frame).not.toBeNull();
    });

    it("没有灯光帧时帧为 null，条目标题仍然保留", () => {
        const slots = resolveLightingSlots([LIGHTING], []);
        expect(slots[0].frame).toBeNull();
        expect(slots[0].title).toContain("雨夜主光");
    });

    it("超过上限时截断列数", () => {
        const many = Array.from({ length: 5 }, (_, index) => ({ ...LIGHTING, name: `光源${index}` }));
        expect(resolveLightingSlots(many, [])).toHaveLength(PRODUCTION_BOARD_MAX_LIGHTING_COLUMNS);
    });

    it("空条目返回空数组", () => {
        expect(resolveLightingSlots([], [])).toEqual([]);
    });
});

describe("resolveSceneFrames", () => {
    it("显式给出场景帧时优先使用", () => {
        const scene = [frame("s1"), frame("s2"), frame("s3")];
        expect(resolveSceneFrames([frame("f1")], scene).map((item) => item?.dataUrl)).toEqual([scene[0].dataUrl, scene[1].dataUrl]);
    });

    it("未给场景帧时回落到故事板里真实存在的帧，避免环境分区空着", () => {
        const storyboard = [null, frame("f2"), frame("f3")];
        expect(resolveSceneFrames(storyboard, []).map((item) => item?.dataUrl)).toEqual([frame("f2").dataUrl, frame("f3").dataUrl]);
    });

    it("确实没有任何帧时返回空数组，由绘制层画素材未覆盖", () => {
        expect(resolveSceneFrames([null, null], [])).toEqual([]);
        expect(resolveSceneFrames([], [])).toEqual([]);
    });
});

describe("planPaletteSwatches", () => {
    it("丢弃非法色值，只保留合法色块", () => {
        const { swatches } = planPaletteSwatches(ANALYSIS.shared.palette);
        expect(swatches.map((item) => item.hex)).toEqual(["#1B2A41", "#FF7A3D"]);
    });

    it("色值归一化为大写 #RRGGBB", () => {
        const { swatches } = planPaletteSwatches([
            { name: "冷蓝", hex: "#1b2a41" },
            { name: "短写", hex: "#abc" },
        ]);
        expect(swatches[0].hex).toBe("#1B2A41");
        expect(swatches[1].hex).toBe("#AABBCC");
    });

    it("超过上限时截断并给出未展示数量，不静默丢弃", () => {
        const palette = Array.from({ length: PRODUCTION_BOARD_MAX_PALETTE_SWATCHES + 3 }, (_, index) => ({ name: `色${index}`, hex: "#112233" }));
        const { swatches, hiddenCount } = planPaletteSwatches(palette);
        expect(swatches).toHaveLength(PRODUCTION_BOARD_MAX_PALETTE_SWATCHES);
        expect(hiddenCount).toBe(3);
    });

    it("全部非法时返回空色块，由绘制层写明未标注", () => {
        expect(planPaletteSwatches([{ name: "坏", hex: "nope" }])).toEqual({ swatches: [], hiddenCount: 0 });
    });
});

describe("planMoodTagRows", () => {
    const tagRect = { x: 0, y: 0, width: 100, height: 60 };
    const measure = (text: string) => text.length * 10;

    it("标签宽度不超出所在矩形，放不下就换行", () => {
        const { tags, hiddenCount } = planMoodTagRows(["潮湿", "孤独", "紧张", "冷调"], tagRect, measure, 10);
        expect(hiddenCount).toBe(0);
        expect(tags).toHaveLength(4);
        for (const tag of tags) expect(tag.x + tag.width).toBeLessThanOrEqual(tagRect.width);
        expect(new Set(tags.map((tag) => tag.y)).size).toBeGreaterThan(1);
    });

    it("高度放不下时给出未展示数量，而不是画到分区外面", () => {
        const keywords = Array.from({ length: 40 }, (_, index) => `关键词${index}`);
        const { tags, hiddenCount } = planMoodTagRows(keywords, tagRect, measure, 10);
        expect(tags.length + hiddenCount).toBe(keywords.length);
        for (const tag of tags) expect(tag.y + tag.height).toBeLessThanOrEqual(tagRect.height);
    });

    it("单个关键词超长时按矩形宽度截断，不撑破分区", () => {
        const { tags } = planMoodTagRows(["这是一个非常非常长的情绪关键词"], tagRect, measure, 10);
        expect(tags[0].width).toBeLessThanOrEqual(tagRect.width);
    });

    it("空关键词列表返回空结果", () => {
        expect(planMoodTagRows([], tagRect, measure, 10)).toEqual({ tags: [], hiddenCount: 0 });
    });
});

describe("computeCoverSource", () => {
    const box = { width: 246, height: 152 };

    it("宽图裁掉左右，保留完整高度", () => {
        const source = computeCoverSource({ width: 1920, height: 1080 }, box)!;
        expect(source.sw / source.sh).toBeCloseTo(box.width / box.height, 5);
        expect(source.sx).toBeCloseTo((1920 - source.sw) / 2, 5);
        expect(source.sy).toBeCloseTo((1080 - source.sh) / 2, 5);
    });

    it("高图裁掉上下，保留完整宽度", () => {
        const source = computeCoverSource({ width: 1080, height: 1920 }, box)!;
        expect(source.sw).toBeCloseTo(1080, 5);
        expect(source.sy).toBeGreaterThan(0);
    });

    it("裁剪区不会超出原图", () => {
        for (const size of [
            { width: 1920, height: 1080 },
            { width: 1080, height: 1920 },
            { width: 300, height: 300 },
        ]) {
            const source = computeCoverSource(size, box)!;
            expect(source.sx).toBeGreaterThanOrEqual(0);
            expect(source.sy).toBeGreaterThanOrEqual(0);
            expect(source.sx + source.sw).toBeLessThanOrEqual(size.width + 1e-6);
            expect(source.sy + source.sh).toBeLessThanOrEqual(size.height + 1e-6);
        }
    });

    it("图片尺寸未知时返回 null，由调用方退化为直接拉伸", () => {
        expect(computeCoverSource({ width: 0, height: 0 }, box)).toBeNull();
    });
});

describe("frameImage", () => {
    it("按 dataUrl 取出已解码的图片", () => {
        const frames = [frame("a")];
        expect(frameImage(imageMap(frames), frames[0])).toBeDefined();
    });

    it("帧为 null 或解码失败时返回 null", () => {
        expect(frameImage(imageMap([frame("a")]), null)).toBeNull();
        expect(frameImage(imageMap([frame("a")]), frame("missing"))).toBeNull();
    });
});

describe("绘制层：标题与共享创意指导", () => {
    it("标题区画出片名与 logline", () => {
        const recorder = createRecordingCanvasContext();
        drawBoardHeader(recorder.ctx, RECT, ANALYSIS);
        const text = recorder.allText();
        expect(text).toContain("雨夜归人");
        expect(text).toContain("一个送货员在暴雨的旧仓库里等到了不该出现的人");
        expect(text).toContain(PRODUCTION_BOARD_SECTION_TITLES.header);
    });

    it("共享创意指导画出镜头数、调色板色块与备注", () => {
        const recorder = createRecordingCanvasContext();
        drawSharedDirection(recorder.ctx, RECT, ANALYSIS);
        const text = recorder.allText();
        expect(text).toContain("镜头数");
        expect(text).toContain("8");
        expect(text).toContain("冷蓝");
        expect(text).toContain("#1B2A41");
        expect(text).toContain("备注");
        expect(recorder.usedStyle("#1B2A41")).toBe(true);
        expect(recorder.usedStyle("#FF7A3D")).toBe(true);
    });

    it("调色板全是非法色值时写明未标注，不留空行", () => {
        const recorder = createRecordingCanvasContext();
        drawSharedDirection(recorder.ctx, RECT, { ...ANALYSIS, shared: { ...ANALYSIS.shared, palette: [{ name: "坏", hex: "nope" }] } });
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_EMPTY_TEXT);
    });
});

describe("绘制层：角色与风格参考", () => {
    it("有帧时画出角色帧与三类说明文字", () => {
        const frames = [frame("c1")];
        const recorder = createRecordingCanvasContext();
        drawCharacterSection(recorder.ctx, RECT, resolveCharacterSlots([CHARACTER], frames), imageMap(frames));
        const text = recorder.allText();
        expect(text).toContain("送货员");
        expect(text).toContain("外观");
        expect(text).toContain("服装");
        expect(text).toContain("一致性");
        expect(recorder.countOf("drawImage")).toBe(1);
    });

    it("角色帧为空时画素材未覆盖，但不丢角色文字", () => {
        const recorder = createRecordingCanvasContext();
        drawCharacterSection(recorder.ctx, RECT, resolveCharacterSlots([CHARACTER], []), new Map());
        expect(recorder.countOf("drawImage")).toBe(0);
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
        expect(recorder.allText()).toContain("送货员");
    });

    it("既没有角色也没有帧时整区写明素材未覆盖，不留空白", () => {
        const recorder = createRecordingCanvasContext();
        drawCharacterSection(recorder.ctx, RECT, [], new Map());
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
    });

    it("图片解码失败时该列退化为占位，其余列照常绘制", () => {
        const frames = [frame("c1"), frame("broken")];
        const slots = resolveCharacterSlots(
            [
                { ...CHARACTER, name: "甲" },
                { ...CHARACTER, name: "乙" },
            ],
            frames,
        );
        const recorder = createRecordingCanvasContext();
        drawCharacterSection(recorder.ctx, RECT, slots, imageMap([frames[0]]));
        expect(recorder.countOf("drawImage")).toBe(1);
        expect(recorder.allText()).toContain("乙");
    });
});

describe("绘制层：环境与场景设计", () => {
    it("画出场景帧并调用俯视示意图", () => {
        const frames = [frame("s1"), frame("s2")];
        const recorder = createRecordingCanvasContext();
        drawEnvironmentSection(recorder.ctx, RECT, ANALYSIS, frames, imageMap(frames));
        const text = recorder.allText();
        expect(text).toContain("俯视示意");
        expect(text).toContain("旧仓库");
        expect(recorder.countOf("drawImage")).toBe(2);
        // 俯视示意图的机位标记
        expect(recorder.countOf("arc")).toBe(ANALYSIS.environment.cameraMoves.length);
    });

    it("没有场景帧时画素材未覆盖，俯视示意图仍然照画", () => {
        const recorder = createRecordingCanvasContext();
        drawEnvironmentSection(recorder.ctx, RECT, ANALYSIS, [], new Map());
        expect(recorder.countOf("drawImage")).toBe(0);
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
        expect(recorder.allText()).toContain("俯视示意");
    });
});

describe("绘制层：故事板", () => {
    it("每格画出编号与四项标注", () => {
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const { slots } = resolveStoryboardSlots(SHOTS.slice(0, 2), frames);
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, slots, 0, imageMap(frames));
        const text = recorder.allText();
        expect(text).toContain("镜头");
        expect(text).toContain("景别");
        expect(text).toContain("动作");
        expect(recorder.countOf("drawImage")).toBe(2);
    });

    it("缺少对应帧的格子画占位与无对应帧文案，不拿别的帧顶替", () => {
        const frames = [frame("f1"), null, frame("f3")];
        const { slots } = resolveStoryboardSlots(SHOTS.slice(0, 3), frames);
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, slots, 0, imageMap(frames));
        expect(recorder.countOf("drawImage")).toBe(2);
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_FRAME_TEXT);
    });

    it("图片解码失败时同样走占位，整块板仍然渲染成功", () => {
        const frames = [frame("f1"), frame("broken")];
        const { slots } = resolveStoryboardSlots(SHOTS.slice(0, 2), frames);
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, slots, 0, imageMap([frames[0]]));
        expect(recorder.countOf("drawImage")).toBe(1);
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_FRAME_TEXT);
    });

    it("镜头数超过 8 格时写明还有多少未展示", () => {
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const { slots, hiddenCount } = resolveStoryboardSlots(SHOTS, frames);
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, slots, hiddenCount + 3, imageMap(frames));
        expect(recorder.allText()).toContain("3");
        expect(recorder.allText()).toContain("未展示");
    });

    it("空故事板写明未覆盖，不留空白网格", () => {
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, [], 0, new Map());
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
    });

    it("竖屏抽帧自动改用单行影片条，八格仍然全部画上", () => {
        const frames = SHOTS.map((item) => frame(`p${item.index}`));
        const images = new Map<string, CanvasImageSource>();
        for (const item of frames) images.set(item.dataUrl, { width: 1080, height: 1920 } as unknown as CanvasImageSource);
        const { slots } = resolveStoryboardSlots(SHOTS, frames);
        const recorder = createRecordingCanvasContext();
        drawStoryboardSection(recorder.ctx, RECT, slots, 0, images);

        expect(recorder.countOf("drawImage")).toBe(8);
        // 单行的判定：所有帧图框的 y 相同，且宽度明显窄于两行网格时的格宽。
        // 已知尺寸的帧图走 9 参 drawImage：dx / dy / dw 在下标 5 / 6 / 7。
        const boxes = recorder.calls.filter((call) => call.method === "drawImage").map((call) => ({ x: Number(call.args[5]), y: Number(call.args[6]), width: Number(call.args[7]) }));
        expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
        expect(boxes[0].width).toBeLessThan(130);
        expect(recorder.allText()).toContain("动作");
    });
});

describe("绘制层：灯光、情绪、音频与电影摄影", () => {
    it("灯光区画出条目文字与参考帧", () => {
        const frames = [frame("l1")];
        const recorder = createRecordingCanvasContext();
        drawLightingSection(recorder.ctx, RECT, resolveLightingSlots([LIGHTING], frames), imageMap(frames));
        const text = recorder.allText();
        expect(text).toContain("雨夜主光");
        expect(text).toContain("冷硬");
        expect(recorder.countOf("drawImage")).toBe(1);
    });

    it("没有灯光帧时画素材未覆盖，条目文字保留", () => {
        const recorder = createRecordingCanvasContext();
        drawLightingSection(recorder.ctx, RECT, resolveLightingSlots([LIGHTING], []), new Map());
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
        expect(recorder.allText()).toContain("雨夜主光");
    });

    it("灯光条目为空时整区写明未标注", () => {
        const recorder = createRecordingCanvasContext();
        drawLightingSection(recorder.ctx, RECT, [], new Map());
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_EMPTY_TEXT);
    });

    it("情绪关键词画成标签块", () => {
        const recorder = createRecordingCanvasContext();
        drawMoodSection(recorder.ctx, RECT, ANALYSIS.moodKeywords);
        const text = recorder.allText();
        for (const keyword of ANALYSIS.moodKeywords) expect(text).toContain(keyword);
    });

    it("没有情绪关键词时写明未标注", () => {
        const recorder = createRecordingCanvasContext();
        drawMoodSection(recorder.ctx, RECT, []);
        expect(recorder.allText()).toContain(PRODUCTION_BOARD_EMPTY_TEXT);
    });

    it("音频区画环境声、音乐与音调三项", () => {
        const recorder = createRecordingCanvasContext();
        drawAudioSection(recorder.ctx, RECT, ANALYSIS);
        const text = recorder.allText();
        expect(text).toContain("暴雨与远处车流");
        expect(text).toContain("低频弦乐");
        expect(text).toContain("压抑");
    });

    it("电影摄影笔记画在末区并支持换行", () => {
        const recorder = createRecordingCanvasContext();
        drawCinematographySection(recorder.ctx, RECT, ANALYSIS.cinematography);
        const text = recorder.allText();
        expect(text).toContain("手持跟拍");
        expect(recorder.methodNames().filter((name) => name === "fillText").length).toBeGreaterThan(0);
    });
});

describe("绘制层：分区裁剪", () => {
    it("每个分区都先保存并裁剪到自身矩形，文字绝不会溢到相邻分区", () => {
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const { slots } = resolveStoryboardSlots(SHOTS, frames);
        const recorder = createRecordingCanvasContext();
        drawBoardHeader(recorder.ctx, RECT, ANALYSIS);
        drawSharedDirection(recorder.ctx, RECT, ANALYSIS);
        drawCharacterSection(recorder.ctx, RECT, resolveCharacterSlots([CHARACTER], frames), imageMap(frames));
        drawEnvironmentSection(recorder.ctx, RECT, ANALYSIS, frames, imageMap(frames));
        drawStoryboardSection(recorder.ctx, RECT, slots, 0, imageMap(frames));
        drawLightingSection(recorder.ctx, RECT, resolveLightingSlots([LIGHTING], frames), imageMap(frames));
        drawMoodSection(recorder.ctx, RECT, ANALYSIS.moodKeywords);
        drawAudioSection(recorder.ctx, RECT, ANALYSIS);
        drawCinematographySection(recorder.ctx, RECT, ANALYSIS.cinematography);

        // 环境分区内部还会再嵌一层（俯视示意图自带裁剪），因此只断言配对与下限。
        expect(recorder.countOf("save")).toBe(recorder.countOf("restore"));
        expect(recorder.countOf("clip")).toBeGreaterThanOrEqual(9);
        expect(recorder.countOf("clip")).toBe(recorder.countOf("save"));
    });
});

describe("绘制层：帧框几何（断言真实 drawImage 落点，不是只信计划）", () => {
    const sections = computeBoardLayout(PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_DEFAULT_HEIGHT).sections;
    const rectOf = (id: string) => sections.find((section) => section.id === id)!.rect;
    const bodyOf = (id: string) => computeSectionBodyRect(rectOf(id));

    /** 已知尺寸的帧图走 9 参 drawImage，目标框在下标 5/6/7/8。 */
    const drawnBoxes = (recorder: ReturnType<typeof createRecordingCanvasContext>) =>
        recorder.calls.filter((call) => call.method === "drawImage").map((call) => ({ x: Number(call.args[5]), y: Number(call.args[6]), width: Number(call.args[7]), height: Number(call.args[8]) }));

    const portraitImages = (frames: SampledVideoFrame[]) => {
        const map = new Map<string, CanvasImageSource>();
        for (const item of frames) map.set(item.dataUrl, { width: 1080, height: 1920 } as unknown as CanvasImageSource);
        return map;
    };

    it("环境分区：竖屏场景帧画出的是收窄后的框，与 planFrameRow 计划完全一致", () => {
        const sceneFrames = [frame("s1"), frame("s2")];
        const body = bodyOf("environment");
        const expected = planFrameRow({ x: body.x, y: body.y + 26, width: Math.round((body.width - 12) * 0.5), height: Math.min(120, body.height - 26 - 24) }, 2, 8, "portrait");

        const recorder = createRecordingCanvasContext();
        drawEnvironmentSection(recorder.ctx, rectOf("environment"), ANALYSIS, sceneFrames, portraitImages(sceneFrames));

        const drawn = drawnBoxes(recorder).filter((box) => box.height === expected[0].height);
        expect(drawn).toHaveLength(2);
        for (let index = 0; index < 2; index += 1) {
            expect(drawn[index].x).toBeCloseTo(expected[index].x, 6);
            expect(drawn[index].width).toBeCloseTo(expected[index].width, 6);
            expect(drawn[index].width / drawn[index].height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT);
        }
    });

    it("灯光分区：竖屏参考帧不再画成横向横幅", () => {
        const frames = [frame("l1")];
        const recorder = createRecordingCanvasContext();
        drawLightingSection(recorder.ctx, rectOf("lighting"), resolveLightingSlots([LIGHTING], frames), portraitImages(frames));

        const drawn = drawnBoxes(recorder);
        expect(drawn).toHaveLength(1);
        expect(drawn[0].width / drawn[0].height).toBeLessThanOrEqual(PORTRAIT_FRAME_MAX_ASPECT);
    });

    it("角色分区：单角色并排绘制，图框占满正文高度", () => {
        const frames = [frame("c1")];
        const recorder = createRecordingCanvasContext();
        drawCharacterSection(recorder.ctx, rectOf("characters"), resolveCharacterSlots([CHARACTER], frames), portraitImages(frames));

        const drawn = drawnBoxes(recorder);
        expect(drawn).toHaveLength(1);
        expect(drawn[0].height).toBeCloseTo(bodyOf("characters").height, 6);
        expect(drawn[0].width).toBeCloseTo(bodyOf("characters").height * PORTRAIT_FRAME_MAX_ASPECT, 6);
    });

    it("角色分区：1~4 个角色画出的框与计划逐像素一致，且都不超宽", () => {
        const characters = Array.from({ length: 4 }, (_, index) => ({ ...CHARACTER, name: `角色${index}` }));
        const body = bodyOf("characters");
        for (const count of [1, 2, 3, 4]) {
            const frames = Array.from({ length: count }, (_, index) => frame(`c${count}-${index}`));
            const slots = resolveCharacterSlots(characters.slice(0, count), frames);
            const recorder = createRecordingCanvasContext();
            drawCharacterSection(recorder.ctx, rectOf("characters"), slots, portraitImages(frames));

            const drawn = drawnBoxes(recorder);
            expect(drawn).toHaveLength(count);
            const columnWidth = (body.width - 12 * (count - 1)) / count;
            let sawSideBySide = false;
            for (let index = 0; index < count; index += 1) {
                const expected = planCharacterCellLayout({ x: body.x + index * (columnWidth + 12), y: body.y, width: columnWidth, height: body.height }, "portrait");
                if (expected.layout === "sideBySide") sawSideBySide = true;
                expect(drawn[index].width).toBeCloseTo(expected.imageBox.width, 6);
                // 并排时图吃满整段正文高度，上下排布时图只占正文高度减去文字预留。
                expect(drawn[index].height).toBeCloseTo(expected.layout === "sideBySide" ? body.height : body.height - 80, 6);
                expect(drawn[index].x).toBeCloseTo(expected.imageBox.x, 6);
                expect(drawn[index].width / drawn[index].height).toBeLessThanOrEqual(LANDSCAPE_FRAME_MAX_ASPECT);
                expect(drawn[index].x).toBeGreaterThanOrEqual(body.x - 1e-6);
            }
            if (count === 1) expect(sawSideBySide).toBe(true);
        }
    });
});

describe("renderProductionBoard", () => {
    function createFakeCanvasFactory() {
        const recorders: ReturnType<typeof createRecordingCanvasContext>[] = [];
        const sizes: { width: number; height: number }[] = [];
        const createCanvas = (width: number, height: number) => {
            const recorder = createRecordingCanvasContext();
            recorders.push(recorder);
            sizes.push({ width, height });
            return {
                width,
                height,
                getContext: () => recorder.ctx,
                toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(["png"], { type: "image/png" })),
            } as unknown as HTMLCanvasElement;
        };
        return { createCanvas, recorders, sizes };
    }

    const fakeLoader = async (dataUrl: string) => (dataUrl.includes("broken") ? null : ({ width: 1920, height: 1080 } as unknown as CanvasImageSource));

    it("渲染出 9:16 的 PNG，并画出全部九个分区标题", async () => {
        const { createCanvas, recorders, sizes } = createFakeCanvasFactory();
        const frames = SHOTS.map((item) => frame(`f${item.index}`));
        const blob = await renderProductionBoard({
            analysis: ANALYSIS,
            storyboardFrames: frames,
            characterFrames: [frame("c1")],
            lightingFrames: [frame("l1")],
            sceneFrames: [frame("s1"), frame("s2")],
            createCanvas,
            imageLoader: fakeLoader,
        });

        expect(blob.type).toBe("image/png");
        expect(sizes).toEqual([{ width: 1080, height: 1920 }]);
        const text = recorders[0].allText();
        for (const title of Object.values(PRODUCTION_BOARD_SECTION_TITLES)) expect(text).toContain(title);
        expect(text).toContain("雨夜归人");
    });

    it("帧里有 null 时只画占位，且不拿别的帧顶替", async () => {
        const { createCanvas, recorders } = createFakeCanvasFactory();
        const frames: (SampledVideoFrame | null)[] = SHOTS.map((item) => frame(`f${item.index}`));
        frames[2] = null;
        await renderProductionBoard({
            analysis: ANALYSIS,
            storyboardFrames: frames,
            characterFrames: [],
            lightingFrames: [],
            sceneFrames: [frame("s1")],
            createCanvas,
            imageLoader: fakeLoader,
        });

        expect(recorders[0].allText()).toContain(PRODUCTION_BOARD_NO_FRAME_TEXT);
        expect(recorders[0].allText()).toContain(PRODUCTION_BOARD_NO_MATERIAL_TEXT);
    });

    it("图片全部解码失败时整块板仍然渲染成功，只降级为占位", async () => {
        const { createCanvas, recorders } = createFakeCanvasFactory();
        const blob = await renderProductionBoard({
            analysis: ANALYSIS,
            storyboardFrames: SHOTS.map((item) => frame(`broken${item.index}`)),
            characterFrames: [frame("broken-c")],
            lightingFrames: [],
            sceneFrames: [],
            createCanvas,
            imageLoader: fakeLoader,
        });

        expect(blob).toBeInstanceOf(Blob);
        expect(recorders[0].countOf("drawImage")).toBe(0);
        expect(recorders[0].allText()).toContain(PRODUCTION_BOARD_NO_FRAME_TEXT);
    });

    it("自选尺寸按传入值出图", async () => {
        const { createCanvas, sizes } = createFakeCanvasFactory();
        await renderProductionBoard({
            analysis: ANALYSIS,
            storyboardFrames: [],
            characterFrames: [],
            lightingFrames: [],
            width: 720,
            height: 1280,
            createCanvas,
            imageLoader: fakeLoader,
        });
        expect(sizes).toEqual([{ width: 720, height: 1280 }]);
    });

    it("导出失败（toBlob 返回空）时抛出明确错误，不返回空文件", async () => {
        const createCanvas = () =>
            ({
                width: 0,
                height: 0,
                getContext: () => createRecordingCanvasContext().ctx,
                toBlob: (callback: (blob: Blob | null) => void) => callback(null),
            }) as unknown as HTMLCanvasElement;

        await expect(renderProductionBoard({ analysis: ANALYSIS, storyboardFrames: [], characterFrames: [], lightingFrames: [], createCanvas, imageLoader: fakeLoader })).rejects.toThrow("导出");
    });

    it("浏览器不支持 Canvas 2D 时抛出明确错误，而不是画出空白板", async () => {
        await expect(renderProductionBoard({ analysis: ANALYSIS, storyboardFrames: [], characterFrames: [], lightingFrames: [] })).rejects.toThrow("Canvas 2D");
    });
});
