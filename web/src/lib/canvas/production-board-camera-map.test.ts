// 俯视机位示意图测试。
//
// 机位坐标不由模型给出，因此「文本描述 → 网格落点」的确定性映射必须被锁死：
// 数量、顺序、边距、边界（零机位 / 单机位）四项都不能随实现改动而漂移。
import { describe, expect, it } from "vitest";

import {
    CAMERA_MAP_CAPTION_HEIGHT,
    CAMERA_MAP_EDGE_MARGIN_RATIO,
    CAMERA_MAP_GRID_COLUMNS,
    CAMERA_MAP_GRID_ROWS,
    CAMERA_MAP_MARKER_RADIUS,
    CAMERA_MAP_VERTICAL_INSET_RATIO,
    cameraMapLabelBox,
    cameraMapMarkerLabel,
    cameraMapPlotRect,
    drawCameraMap,
    planCameraMapLayout,
    planCameraMapPoints,
    resolveCameraMarkerNumber,
    sortCameraMovesByOrder,
} from "@/lib/canvas/production-board-camera-map";
import type { BoardCameraMove, ProductionBoardAnalysis } from "@/lib/canvas/production-board-schema";
import { createRecordingCanvasContext } from "@/lib/canvas/production-board-test-canvas";

const RECT = { x: 100, y: 200, width: 600, height: 300 };

function move(order: number, position: string, shotType = "中景", movement = "横移"): BoardCameraMove {
    return { order, position, shotType, movement };
}

const environment: ProductionBoardAnalysis["environment"] = {
    location: "旧仓库",
    description: "废弃仓库，铁架与高窗",
    cameraMoves: [move(1, "仓库入口左侧", "广角", "推近"), move(2, "铁架正下方", "中景", "横移"), move(3, "高窗对面", "特写", "上摇")],
};

describe("planCameraMapPoints", () => {
    it("零机位返回空数组", () => {
        expect(planCameraMapPoints(0, RECT)).toEqual([]);
    });

    it("非法数量按零机位处理，不产生 NaN 落点", () => {
        expect(planCameraMapPoints(-1, RECT)).toEqual([]);
        expect(planCameraMapPoints(Number.NaN, RECT)).toEqual([]);
        expect(planCameraMapPoints(Number.POSITIVE_INFINITY, RECT)).toEqual([]);
    });

    it("单机位落在矩形中心", () => {
        expect(planCameraMapPoints(1, RECT)).toEqual([{ x: 400, y: 350 }]);
    });

    it("落点数量与顺序索引一一对应", () => {
        for (const count of [1, 2, 3, 5, 8]) {
            expect(planCameraMapPoints(count, RECT)).toHaveLength(count);
        }
    });

    it("沿水平方向按顺序单调递增，路径方向与 order 一致", () => {
        const points = planCameraMapPoints(5, RECT);
        for (let index = 1; index < points.length; index += 1) {
            expect(points[index].x).toBeGreaterThan(points[index - 1].x);
        }
    });

    it("首尾留边距，落点不贴边", () => {
        const points = planCameraMapPoints(4, RECT);
        const margin = RECT.width * CAMERA_MAP_EDGE_MARGIN_RATIO;
        expect(points[0].x).toBeCloseTo(RECT.x + margin, 6);
        expect(points.at(-1)!.x).toBeCloseTo(RECT.x + RECT.width - margin, 6);
    });

    it("纵向按序号奇偶交替，形成折线路径而不是直线", () => {
        const points = planCameraMapPoints(4, RECT);
        expect(points[0].y).toBeCloseTo(points[2].y, 6);
        expect(points[1].y).toBeCloseTo(points[3].y, 6);
        expect(points[0].y).not.toBeCloseTo(points[1].y, 6);
        const inset = RECT.height * CAMERA_MAP_VERTICAL_INSET_RATIO;
        expect(points[1].y).toBeCloseTo(RECT.y + inset, 6);
        expect(points[0].y).toBeCloseTo(RECT.y + RECT.height - inset, 6);
    });

    it("所有落点都在矩形内", () => {
        for (const point of planCameraMapPoints(9, RECT)) {
            expect(point.x).toBeGreaterThanOrEqual(RECT.x);
            expect(point.x).toBeLessThanOrEqual(RECT.x + RECT.width);
            expect(point.y).toBeGreaterThanOrEqual(RECT.y);
            expect(point.y).toBeLessThanOrEqual(RECT.y + RECT.height);
        }
    });

    it("同一输入两次调用结果完全一致（确定性）", () => {
        expect(planCameraMapPoints(6, RECT)).toEqual(planCameraMapPoints(6, RECT));
    });

    it("退化矩形不产生 NaN", () => {
        const degenerate = { x: 10, y: 20, width: 0, height: 0 };
        for (const count of [1, 3]) {
            for (const point of planCameraMapPoints(count, degenerate)) {
                expect(Number.isFinite(point.x)).toBe(true);
                expect(Number.isFinite(point.y)).toBe(true);
            }
        }
    });
});

describe("cameraMapPlotRect", () => {
    it("内缩出绘图区，且仍在原矩形内", () => {
        const plot = cameraMapPlotRect(RECT);
        expect(plot.x).toBeGreaterThan(RECT.x);
        expect(plot.y).toBeGreaterThan(RECT.y);
        expect(plot.x + plot.width).toBeLessThan(RECT.x + RECT.width);
        expect(plot.y + plot.height).toBeLessThan(RECT.y + RECT.height);
    });

    it("退化矩形下宽高不为负", () => {
        const plot = cameraMapPlotRect({ x: 0, y: 0, width: 4, height: 4 });
        expect(plot.width).toBeGreaterThanOrEqual(0);
        expect(plot.height).toBeGreaterThanOrEqual(0);
    });
});

describe("planCameraMapLayout 与标注几何", () => {
    // 真实板面上俯视示意图分到的矩形（1080 宽板面里约 490×185）。
    const REAL = { x: 100, y: 200, width: 490, height: 185 };

    const boxesOf = (count: number, rect = RECT) => {
        const layout = planCameraMapLayout(count, cameraMapPlotRect(rect));
        return layout.points.map((point, index) => cameraMapLabelBox(rect, point, layout.labelWidth, layout.lineHeight, index));
    };

    it("标注宽度不超过相邻机位间距：同带标注首尾相接而不互相压住", () => {
        for (const count of [2, 3, 4, 5, 6, 8]) {
            const layout = planCameraMapLayout(count, cameraMapPlotRect(REAL));
            if (count < 2) continue;
            const spacing = Math.abs(layout.points[1].x - layout.points[0].x);
            expect(layout.labelWidth).toBeLessThanOrEqual(spacing + 1e-6);
        }
    });

    it("同一带上的任意两块标注都不重叠（2~8 机位）", () => {
        for (const count of [2, 3, 4, 5, 6, 8]) {
            const boxes = boxesOf(count, REAL);
            for (let left = 0; left < boxes.length; left += 1) {
                for (let right = left + 1; right < boxes.length; right += 1) {
                    if (Math.abs(boxes[left].y - boxes[right].y) > 1e-6) continue;
                    const overlap = Math.min(boxes[left].x + boxes[left].width, boxes[right].x + boxes[right].width) - Math.max(boxes[left].x, boxes[right].x);
                    expect(overlap).toBeLessThanOrEqual(1e-6);
                }
            }
        }
    });

    it("所有标注都留在示意图矩形内，不会被裁剪（2~8 机位）", () => {
        for (const count of [2, 3, 4, 5, 6, 8]) {
            for (const box of boxesOf(count, REAL)) {
                expect(box.x).toBeGreaterThanOrEqual(REAL.x - 1e-6);
                expect(box.x + box.width).toBeLessThanOrEqual(REAL.x + REAL.width + 1e-6);
                expect(box.y).toBeGreaterThanOrEqual(REAL.y - 1e-6);
                expect(box.y + box.height).toBeLessThanOrEqual(REAL.y + REAL.height + 1e-6);
            }
        }
    });

    it("标注压在标记外侧，不会盖住编号圆点", () => {
        const layout = planCameraMapLayout(4, cameraMapPlotRect(REAL));
        layout.points.forEach((point, index) => {
            const box = cameraMapLabelBox(REAL, point, layout.labelWidth, layout.lineHeight, index);
            const overlapsMarkerY = box.y <= point.y + CAMERA_MAP_MARKER_RADIUS && box.y + box.height >= point.y - CAMERA_MAP_MARKER_RADIUS;
            const overlapsMarkerX = box.x <= point.x + CAMERA_MAP_MARKER_RADIUS && box.x + box.width >= point.x - CAMERA_MAP_MARKER_RADIUS;
            expect(overlapsMarkerY && overlapsMarkerX).toBe(false);
        });
    });

    it("机位多时标注改用小一号字体，尽量多留几个字", () => {
        expect(planCameraMapLayout(3, cameraMapPlotRect(REAL)).titleFontSize).toBeGreaterThan(planCameraMapLayout(8, cameraMapPlotRect(REAL)).titleFontSize);
    });

    it("绘图区让开顶部标题条，机位标记不会压住「俯视示意」标题", () => {
        const plot = cameraMapPlotRect(REAL);
        expect(plot.y).toBeGreaterThanOrEqual(REAL.y + CAMERA_MAP_CAPTION_HEIGHT);
    });
});

describe("sortCameraMovesByOrder", () => {
    it("按 order 升序排列", () => {
        const sorted = sortCameraMovesByOrder([move(3, "丙"), move(1, "甲"), move(2, "乙")]);
        expect(sorted.map((item) => item.position)).toEqual(["甲", "乙", "丙"]);
    });

    it("order 重复时保持原有相对顺序（稳定排序）", () => {
        const sorted = sortCameraMovesByOrder([move(2, "甲"), move(2, "乙"), move(1, "丙")]);
        expect(sorted.map((item) => item.position)).toEqual(["丙", "甲", "乙"]);
    });

    it("order 非法（缺失/NaN）的机位排在末尾，不参与插队", () => {
        const sorted = sortCameraMovesByOrder([move(Number.NaN, "甲"), move(2, "乙"), move(1, "丙")]);
        expect(sorted.map((item) => item.position)).toEqual(["丙", "乙", "甲"]);
    });

    it("不修改入参数组", () => {
        const source = [move(2, "甲"), move(1, "乙")];
        sortCameraMovesByOrder(source);
        expect(source.map((item) => item.position)).toEqual(["甲", "乙"]);
    });
});

describe("resolveCameraMarkerNumber", () => {
    it("合法正 order 取整后作为机位编号", () => {
        expect(resolveCameraMarkerNumber(move(3, "甲"), 0)).toBe(3);
        expect(resolveCameraMarkerNumber(move(2.7, "甲"), 0)).toBe(2);
    });

    it("order 非法时回落到序号（从 1 开始），不会画出「机位 0」", () => {
        expect(resolveCameraMarkerNumber(move(0, "甲"), 0)).toBe(1);
        expect(resolveCameraMarkerNumber(move(-4, "甲"), 2)).toBe(3);
        expect(resolveCameraMarkerNumber(move(Number.NaN, "甲"), 4)).toBe(5);
    });
});

describe("cameraMapMarkerLabel", () => {
    it("标题含机位编号与位置文本", () => {
        const label = cameraMapMarkerLabel(move(2, "铁架正下方"), 1);
        expect(label.title).toContain("#2");
        expect(label.title).toContain("铁架正下方");
    });

    it("副标题含镜头类型与运动方式", () => {
        const label = cameraMapMarkerLabel(move(1, "入口", "广角", "推近"), 0);
        expect(label.detail).toContain("广角");
        expect(label.detail).toContain("推近");
    });

    it("位置或镜头信息为空时回落到未标注，不画出空标签", () => {
        const label = cameraMapMarkerLabel(move(1, "   ", "", ""), 0);
        expect(label.title).toContain("未标注");
        expect(label.detail).toContain("未标注");
    });
});

describe("drawCameraMap", () => {
    it("画出底网格与连接各机位的路径", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, environment);

        const gridSegments = CAMERA_MAP_GRID_COLUMNS + 1 + (CAMERA_MAP_GRID_ROWS + 1);
        const markers = environment.cameraMoves.length;
        expect(recorder.countOf("lineTo")).toBe(gridSegments + (markers - 1));
        expect(recorder.countOf("moveTo")).toBe(gridSegments + 1);
    });

    it("每个机位画出圆形标记、编号、位置文本与镜头信息", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, environment);

        expect(recorder.countOf("arc")).toBe(environment.cameraMoves.length);
        const text = recorder.allText();
        expect(text).toContain("#1");
        expect(text).toContain("仓库入口左侧");
        expect(text).toContain("推近");
        expect(text).toContain("铁架正下方");
        expect(text).toContain("上摇");
    });

    it("零机位时不画路径，但画出未标注机位文案与网格，不留空白", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, { ...environment, cameraMoves: [] });

        expect(recorder.countOf("arc")).toBe(0);
        const gridSegments = CAMERA_MAP_GRID_COLUMNS + 1 + (CAMERA_MAP_GRID_ROWS + 1);
        expect(recorder.countOf("lineTo")).toBe(gridSegments);
        expect(recorder.allText()).toContain("未标注机位");
    });

    it("单机位时只画标记与文案，不画连接线", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, { ...environment, cameraMoves: [move(1, "唯一机位")] });

        const gridSegments = CAMERA_MAP_GRID_COLUMNS + 1 + (CAMERA_MAP_GRID_ROWS + 1);
        expect(recorder.countOf("lineTo")).toBe(gridSegments);
        expect(recorder.countOf("arc")).toBe(1);
        expect(recorder.allText()).toContain("唯一机位");
    });

    it("机位顺序按 order 决定，与数组中出现的先后无关", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, { ...environment, cameraMoves: [move(3, "丙机位"), move(1, "甲机位")] });

        const numbered = recorder.fillTexts().filter((text) => text === "1" || text === "3");
        expect(numbered).toEqual(["1", "3"]);
    });

    it("绘制前保存并裁剪到给定矩形，内容不会溢出分区", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, environment);

        expect(recorder.methodNames()[0]).toBe("save");
        expect(recorder.countOf("clip")).toBe(1);
        expect(recorder.methodNames().at(-1)).toBe("restore");
    });

    it("标题带出场地点，说明这张俯视图画的是哪里", () => {
        const recorder = createRecordingCanvasContext();
        drawCameraMap(recorder.ctx, RECT, environment);
        expect(recorder.allText()).toContain("旧仓库");
    });

    it("机位数量很多时仍然只画在矩形内（落点有边距，不会叠到边界上）", () => {
        const recorder = createRecordingCanvasContext();
        const many = Array.from({ length: 8 }, (_, index) => move(index + 1, `机位${index + 1}`));
        drawCameraMap(recorder.ctx, RECT, { ...environment, cameraMoves: many });

        expect(recorder.countOf("arc")).toBe(8);
        expect(recorder.countOf("lineTo")).toBe(CAMERA_MAP_GRID_COLUMNS + 1 + CAMERA_MAP_GRID_ROWS + 1 + 7);
    });

    it("标记半径为正，保证编号在缩略图尺寸下仍可见", () => {
        expect(CAMERA_MAP_MARKER_RADIUS).toBeGreaterThanOrEqual(12);
    });
});
