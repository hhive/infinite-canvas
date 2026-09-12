// 俯视机位示意图。
//
// 这张图记录的是空间关系（机位、路径、沿线镜头），视频帧里根本不存在，所以必须程序化绘制：
// 线条清晰、标注准确，且不消耗任何生成次数。
//
// 关键设计：模型只给「位置文本」不给坐标，落点由 planCameraMapPoints 按 order 确定性映射到网格上。
// 因此同一份分析结果永远画出同一张图，重渲染不会漂移。
import type { BoardCameraMove, ProductionBoardAnalysis } from "@/lib/canvas/production-board-schema";
import { BOARD_COLORS, boardFont } from "@/lib/canvas/production-board-style";
import { createCanvasMeasureText, truncateTextToWidth, wrapTextClamped } from "@/lib/canvas/production-board-text";

export type BoardCameraMapRect = { x: number; y: number; width: number; height: number };
export type BoardCameraMapPoint = { x: number; y: number };

/** 首尾机位距绘图区左右边界的比例，防止标记与标签贴边。 */
export const CAMERA_MAP_EDGE_MARGIN_RATIO = 0.12;
/**
 * 上下两条机位带距绘图区上下边界的比例。
 * 取 0.42 而不是更小的值，是因为标记上方/下方还要放两行标注：
 * 带宽必须大于「标记半径 + 间距 + 两行标注」，否则标注会被挤出绘图区。
 */
export const CAMERA_MAP_VERTICAL_INSET_RATIO = 0.42;
/** 机位标记半径，按 1080 宽板面调过，缩到半屏也还能看清编号。 */
export const CAMERA_MAP_MARKER_RADIUS = 18;
/** 底网格竖线条数。 */
export const CAMERA_MAP_GRID_COLUMNS = 6;
/** 底网格横线条数。 */
export const CAMERA_MAP_GRID_ROWS = 4;
/** 绘图区内缩，给标注留边。 */
export const CAMERA_MAP_PLOT_PADDING = 14;
/** 顶部标题（「俯视示意：地点」）占用的高度，绘图区从它下面开始，避免与标注打架。 */
export const CAMERA_MAP_CAPTION_HEIGHT = 24;
/** 机位数量超过这个数时标注改用小一号字体，否则相邻标注会挤在一起。 */
export const CAMERA_MAP_DENSE_MARKER_COUNT = 4;

/** 未提供机位信息时的文案：宁可写明缺什么，也不留一块空白网格。 */
export const CAMERA_MAP_EMPTY_TEXT = "未标注机位信息";
/** 单个字段缺失时的回落文案。 */
export const CAMERA_MAP_UNKNOWN_TEXT = "未标注";

const LABEL_LINE_HEIGHT = 16;
const LABEL_FONT_SIZE = 15;
const LABEL_DETAIL_FONT_SIZE = 14;
const DENSE_LABEL_LINE_HEIGHT = 13;
const DENSE_LABEL_FONT_SIZE = 12;
const TITLE_FONT_SIZE = 15;
const MARKER_FONT_SIZE = 17;
/** 标注块与标记之间的间距。 */
const LABEL_GAP = CAMERA_MAP_MARKER_RADIUS + 6;

/** 绘图区：内缩一圈并让开顶部标题条，机位落点、网格与标注都画在这个范围内。 */
export function cameraMapPlotRect(rect: BoardCameraMapRect): BoardCameraMapRect {
    return {
        x: rect.x + CAMERA_MAP_PLOT_PADDING,
        y: rect.y + CAMERA_MAP_CAPTION_HEIGHT + CAMERA_MAP_PLOT_PADDING,
        width: Math.max(0, rect.width - CAMERA_MAP_PLOT_PADDING * 2),
        height: Math.max(0, rect.height - CAMERA_MAP_CAPTION_HEIGHT - CAMERA_MAP_PLOT_PADDING * 2),
    };
}

/**
 * 把 count 个机位确定性地铺到矩形上：
 * 横向按序号均匀等分并留出首尾边距（顺序即路径顺序），
 * 纵向按序号奇偶在「下带 / 上带」之间交替，形成一条折线路径而不是一条直线。
 * 零机位（含非法数量）返回空数组，单机位落在矩形中心。
 */
export function planCameraMapPoints(count: number, rect: BoardCameraMapRect): BoardCameraMapPoint[] {
    const total = Number.isFinite(count) ? Math.floor(count) : 0;
    if (total < 1) return [];
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    if (total === 1) return [{ x: centerX, y: centerY }];

    const margin = rect.width * CAMERA_MAP_EDGE_MARGIN_RATIO;
    const left = rect.x + margin;
    const right = rect.x + rect.width - margin;
    const inset = rect.height * CAMERA_MAP_VERTICAL_INSET_RATIO;
    const lowerY = rect.y + rect.height - inset;
    const upperY = rect.y + inset;

    const points: BoardCameraMapPoint[] = [];
    for (let index = 0; index < total; index += 1) {
        const ratio = index / (total - 1);
        points.push({ x: left + (right - left) * ratio, y: index % 2 === 0 ? lowerY : upperY });
    }
    return points;
}

export type CameraMapLayout = {
    points: BoardCameraMapPoint[];
    /** 单块标注的最大宽度：不超过相邻机位的间距，保证同带标注首尾相接而不重叠。 */
    labelWidth: number;
    /** 标注标题字号。 */
    titleFontSize: number;
    /** 标注说明字号。 */
    detailFontSize: number;
    lineHeight: number;
};

/**
 * 机位标注的排版计划。标注宽度按「相邻机位间距」封顶是关键：
 * 同一带上的机位相隔两个间距，标注各自占一个间距就不会互相压住；
 * 机位很多时（间距被压窄）改用小一号字体，尽量多留几个字。
 */
export function planCameraMapLayout(count: number, rect: BoardCameraMapRect): CameraMapLayout {
    const points = planCameraMapPoints(count, rect);
    const spacing = points.length >= 2 ? Math.abs(points[1].x - points[0].x) : rect.width;
    const dense = points.length > CAMERA_MAP_DENSE_MARKER_COUNT;
    return {
        points,
        labelWidth: Math.max(40, Math.min(rect.width / 2 - CAMERA_MAP_MARKER_RADIUS - 10, spacing)),
        titleFontSize: dense ? DENSE_LABEL_FONT_SIZE : LABEL_FONT_SIZE,
        detailFontSize: dense ? DENSE_LABEL_FONT_SIZE : LABEL_DETAIL_FONT_SIZE,
        lineHeight: dense ? DENSE_LABEL_LINE_HEIGHT : LABEL_LINE_HEIGHT,
    };
}

/**
 * 一块机位标注的矩形：上带机位标注画在标记上方，下带画在下方；
 * 左半边向右展开、右半边向左展开，保证标注始终留在示意图矩形内。
 */
export function cameraMapLabelBox(rect: BoardCameraMapRect, point: BoardCameraMapPoint, labelWidth: number, lineHeight: number, index: number): BoardCameraMapRect {
    const height = lineHeight * 2;
    return {
        x: cameraMapLabelAlignLeft(rect, point) ? point.x : point.x - labelWidth,
        y: index % 2 === 1 ? point.y - LABEL_GAP - height : point.y + LABEL_GAP,
        width: labelWidth,
        height,
    };
}

/** 标注朝向：左半边的机位向右展开，右半边向左展开。绘制与几何校验共用，避免两者算出不同结果。 */
export function cameraMapLabelAlignLeft(rect: BoardCameraMapRect, point: BoardCameraMapPoint): boolean {
    return point.x <= rect.x + rect.width / 2;
}

/**
 * 按 order 升序排列机位；order 相同时保持原有相对顺序。
 * order 非法（缺失 / NaN）的排到末尾，避免坏数据把整条路径的顺序搅乱。
 */
export function sortCameraMovesByOrder(moves: BoardCameraMove[]): BoardCameraMove[] {
    return moves
        .map((move, index) => ({ move, index }) as const)
        .sort((left, right) => cameraOrderKey(left.move.order) - cameraOrderKey(right.move.order) || left.index - right.index)
        .map((entry) => entry.move);
}

/** 标记上的编号：优先用模型给的 order，非法时回落到在路径中的序号。 */
export function resolveCameraMarkerNumber(move: BoardCameraMove, index: number): number {
    const order = Math.floor(Number(move.order));
    return Number.isFinite(order) && order > 0 ? order : index + 1;
}

/** 标记旁的两行文案：第一行编号与位置，第二行镜头类型与运动方式。 */
export function cameraMapMarkerLabel(move: BoardCameraMove, index: number): { title: string; detail: string } {
    const position = (move.position ?? "").trim() || CAMERA_MAP_UNKNOWN_TEXT;
    const shotType = (move.shotType ?? "").trim() || CAMERA_MAP_UNKNOWN_TEXT;
    const movement = (move.movement ?? "").trim() || CAMERA_MAP_UNKNOWN_TEXT;
    return { title: `#${resolveCameraMarkerNumber(move, index)} ${position}`, detail: `${shotType} · ${movement}` };
}

/** 在给定矩形内绘制俯视示意图：底网格 → 路径 → 机位标记与标注。 */
export function drawCameraMap(ctx: CanvasRenderingContext2D, rect: BoardCameraMapRect, environment: ProductionBoardAnalysis["environment"]): void {
    ctx.save();
    // 裁剪到底座矩形：即使标注数学上算偏了，也绝不会溢到相邻分区。
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    ctx.fillStyle = BOARD_COLORS.panel;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = BOARD_COLORS.panelBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

    const plot = cameraMapPlotRect(rect);
    drawGrid(ctx, plot);

    const moves = sortCameraMovesByOrder(environment?.cameraMoves ?? []);
    const layout = planCameraMapLayout(moves.length, plot);

    if (layout.points.length >= 2) drawPath(ctx, layout.points);
    moves.forEach((move, index) => drawMarker(ctx, rect, layout, index, move));
    if (!moves.length) drawEmptyNote(ctx, plot);

    drawCaption(ctx, rect, environment?.location ?? "", createCanvasMeasureText(ctx));
    ctx.restore();
}

function cameraOrderKey(order: number): number {
    return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

function drawGrid(ctx: CanvasRenderingContext2D, plot: BoardCameraMapRect): void {
    ctx.strokeStyle = BOARD_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let column = 0; column <= CAMERA_MAP_GRID_COLUMNS; column += 1) {
        const x = plot.x + (plot.width * column) / CAMERA_MAP_GRID_COLUMNS;
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
    }
    for (let row = 0; row <= CAMERA_MAP_GRID_ROWS; row += 1) {
        const y = plot.y + (plot.height * row) / CAMERA_MAP_GRID_ROWS;
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
}

function drawPath(ctx: CanvasRenderingContext2D, points: BoardCameraMapPoint[]): void {
    ctx.beginPath();
    points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = BOARD_COLORS.path;
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawMarker(ctx: CanvasRenderingContext2D, rect: BoardCameraMapRect, layout: CameraMapLayout, index: number, move: BoardCameraMove): void {
    const point = layout.points[index];
    if (!point) return;

    ctx.beginPath();
    ctx.arc(point.x, point.y, CAMERA_MAP_MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = BOARD_COLORS.markerFill;
    ctx.fill();
    ctx.strokeStyle = BOARD_COLORS.background;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = BOARD_COLORS.markerText;
    ctx.font = boardFont(MARKER_FONT_SIZE, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(resolveCameraMarkerNumber(move, index)), point.x, point.y);

    drawMarkerLabel(ctx, rect, layout, point, index, move);
}

function drawMarkerLabel(ctx: CanvasRenderingContext2D, rect: BoardCameraMapRect, layout: CameraMapLayout, point: BoardCameraMapPoint, index: number, move: BoardCameraMove): void {
    const measure = createCanvasMeasureText(ctx);
    const label = cameraMapMarkerLabel(move, index);

    // 先设字体再测量：measureText 的结果取决于当前 font，否则会用上一个字号断行。
    ctx.font = boardFont(layout.titleFontSize, "bold");
    const title = wrapTextClamped(label.title, layout.labelWidth, 1, measure)[0] ?? "";
    ctx.font = boardFont(layout.detailFontSize);
    const detail = wrapTextClamped(label.detail, layout.labelWidth, 1, measure)[0] ?? "";

    const box = cameraMapLabelBox(rect, point, layout.labelWidth, layout.lineHeight, index);
    ctx.textBaseline = "top";
    ctx.textAlign = cameraMapLabelAlignLeft(rect, point) ? "left" : "right";

    ctx.font = boardFont(layout.titleFontSize, "bold");
    ctx.fillStyle = BOARD_COLORS.textPrimary;
    if (title) ctx.fillText(title, point.x, box.y);

    ctx.font = boardFont(layout.detailFontSize);
    ctx.fillStyle = BOARD_COLORS.textSecondary;
    if (detail) ctx.fillText(detail, point.x, box.y + layout.lineHeight);
}

function drawEmptyNote(ctx: CanvasRenderingContext2D, plot: BoardCameraMapRect): void {
    ctx.fillStyle = BOARD_COLORS.textMuted;
    ctx.font = boardFont(16);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CAMERA_MAP_EMPTY_TEXT, plot.x + plot.width / 2, plot.y + plot.height / 2);
}

function drawCaption(ctx: CanvasRenderingContext2D, rect: BoardCameraMapRect, location: string, measure: (text: string) => number): void {
    const caption = `俯视示意：${location.trim() || CAMERA_MAP_UNKNOWN_TEXT}`;
    ctx.font = boardFont(15);
    ctx.fillStyle = BOARD_COLORS.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(truncateTextToWidth(caption, Math.max(0, rect.width - 20), measure), rect.x + 10, rect.y + 6);
}
