// 制作规划板版式渲染：把结构化分析 + 真实抽帧合成一张 9:16 的规划板 PNG。
//
// 为什么是手写 Canvas 而不是「一句提示词生成整张板」：板面有大量标签（镜头类型、景别、运动、
// 情绪关键词），图像模型渲染文字必然是伪文字；而故事板本身就该用真实帧，重绘只会带来形变。
// 所以这里用 Canvas 2D 直接排版：文字真实、帧真实、俯视示意图程序化绘制，生成次数为 0。
//
// 版面策略：九个分区按固定比例自上而下铺满，每个分区的绘制都裁剪到自身矩形，
// 因此「文字过长 / 缺帧 / 素材未覆盖」只会导致裁断或占位，绝不会溢出到相邻分区。
//
// 该文件与 schema 之外的分析层、抽帧层、入口层解耦：只依赖 production-board-schema.ts 的类型。
import { drawCameraMap } from "@/lib/canvas/production-board-camera-map";
import { normalizeBoardHexColor, type BoardLighting, type BoardPalette, type BoardShot, type ProductionBoardAnalysis } from "@/lib/canvas/production-board-schema";
import { BOARD_COLORS, boardFont } from "@/lib/canvas/production-board-style";
import { createCanvasMeasureText, truncateTextToWidth, wrapTextClamped, type MeasureTextFn } from "@/lib/canvas/production-board-text";
import type { SampledVideoFrame } from "@/lib/canvas/video-frame-sampling-plan";

export const PRODUCTION_BOARD_DEFAULT_WIDTH = 1080;
export const PRODUCTION_BOARD_DEFAULT_HEIGHT = 1920;

/** 尺寸下限：再小的话分区放不下一行完整标注。 */
export const PRODUCTION_BOARD_MIN_WIDTH = 360;
export const PRODUCTION_BOARD_MIN_HEIGHT = 640;
/** 尺寸上限：避免画出浏览器存不下的画布。 */
export const PRODUCTION_BOARD_MAX_DIMENSION = 4096;

/** 故事板最多画 8 格（4 列 × 2 行）；超出部分如实标注未展示数量。 */
export const PRODUCTION_BOARD_MAX_STORYBOARD_CELLS = 8;
export const PRODUCTION_BOARD_MAX_CHARACTER_COLUMNS = 4;
export const PRODUCTION_BOARD_MAX_LIGHTING_COLUMNS = 3;
export const PRODUCTION_BOARD_MAX_PALETTE_SWATCHES = 6;
export const PRODUCTION_BOARD_MAX_SCENE_FRAMES = 2;

/** 结构化字段缺失时的回落文案。 */
export const PRODUCTION_BOARD_EMPTY_TEXT = "未标注";
/** 某一格缺对应抽帧时的文案：如实说明，不拿别的帧顶替。 */
export const PRODUCTION_BOARD_NO_FRAME_TEXT = "无对应帧";
/** 某个子区根本没有素材时的文案：不留空白。 */
export const PRODUCTION_BOARD_NO_MATERIAL_TEXT = "素材未覆盖";

/** 单张帧图的解码超时：超时按解码失败处理，不让整块板卡住。 */
export const PRODUCTION_BOARD_IMAGE_TIMEOUT_MS = 15_000;

const BOARD_PADDING = 34;
const SECTION_GAP = 14;
const SECTION_TITLE_HEIGHT = 30;
const PANEL_PADDING = 12;

export type BoardRect = { x: number; y: number; width: number; height: number };
export type BoardImage = CanvasImageSource;
export type BoardImageMap = ReadonlyMap<string, BoardImage>;

export type ProductionBoardSectionId = "header" | "shared" | "characters" | "environment" | "storyboard" | "lighting" | "mood" | "audio" | "cinematography";

export type ProductionBoardSectionLayout = { id: ProductionBoardSectionId; title: string; rect: BoardRect };

// 分区比例用「基点」表示（合计 1000），避免浮点比例相加不等于 1 而留出空白带或压叠。
// 这些数值是按各分区的真实内容需求（标题行高、色块块高、格子标签行数……）反推出来的，
// 故事板拿走剩余的全部：它是板面主体。改动前先看配套的「分区最低正文高度」测试。
const SECTION_SPECS: { id: ProductionBoardSectionId; title: string; basisPoints: number }[] = [
    { id: "header", title: "制作规划板", basisPoints: 82 },
    { id: "shared", title: "共享创意指导", basisPoints: 92 },
    { id: "characters", title: "角色与风格参考", basisPoints: 130 },
    { id: "environment", title: "环境与场景设计", basisPoints: 134 },
    { id: "storyboard", title: "故事板", basisPoints: 280 },
    { id: "lighting", title: "灯光 / 情绪 / 风格", basisPoints: 93 },
    { id: "mood", title: "情绪关键词", basisPoints: 63 },
    { id: "audio", title: "音频与音调", basisPoints: 57 },
    { id: "cinematography", title: "电影摄影笔记", basisPoints: 69 },
];

export const PRODUCTION_BOARD_SECTION_ORDER: ProductionBoardSectionId[] = SECTION_SPECS.map((spec) => spec.id);

export const PRODUCTION_BOARD_SECTION_TITLES = SECTION_SPECS.reduce(
    (accumulator, spec) => {
        accumulator[spec.id] = spec.title;
        return accumulator;
    },
    {} as Record<ProductionBoardSectionId, string>,
);

export const PRODUCTION_BOARD_SECTION_BASIS_POINTS = SECTION_SPECS.reduce(
    (accumulator, spec) => {
        accumulator[spec.id] = spec.basisPoints;
        return accumulator;
    },
    {} as Record<ProductionBoardSectionId, number>,
);

/**
 * 每个分区正文区（去掉标题条与上下留白）的最低高度，单位像素。
 * 数值等于该分区画完必备内容所需的高度；1080×1920 下必须全部满足，
 * 否则会出现「末行标注被裁掉」或「第 3 条灯光被挤掉」这类只能靠肉眼发现的问题。
 *
 * 注意：字号与行高是固定的像素值，不随画布缩放，因此这套最低高度是按 1080 宽标定的。
 * 画布尺寸更小时分区放不下这么多行，内容会被截断（有降级、不会溢出）；若将来要正式支持
 * 更小的出图尺寸，应当整体按 width / 1080 缩放字号，而不是继续调比例。
 */
export const PRODUCTION_BOARD_SECTION_MIN_BODY_HEIGHT: Record<ProductionBoardSectionId, number> = {
    header: 94, // 片名一行 46 + 4 + logline 两行 44
    shared: 111, // 镜头数 22 + 4 + 调色板 43 + 6 + 环境 17 + 2 + 备注 17
    characters: 124, // 参考帧 48 + 6 + 角色名 22 + 三类说明各一行 48
    environment: 184, // 地点 22 + 4 + 场景帧 120 + 6 + 描述两行 32
    storyboard: 300, // 横屏源两行格子：每格图像 80 + 标注块 64，再加行间距（竖屏源单行只需 199，取更严的两行）
    lighting: 114, // 三条光源，每条标题 18 + 说明 16 + 间距 4
    mood: 58, // 关键词标签两行 26 + 6 + 26
    audio: 51, // 环境声 / 音乐 / 音调各一行 17
    cinematography: 72, // 电影摄影笔记四行 18
};

/** 分区正文区：去掉标题条与上下留白。绘制与几何校验共用同一个算法。 */
export function computeSectionBodyRect(rect: BoardRect): BoardRect {
    return {
        x: rect.x + PANEL_PADDING,
        y: rect.y + SECTION_TITLE_HEIGHT + 8,
        width: Math.max(0, rect.width - PANEL_PADDING * 2),
        height: Math.max(0, rect.height - SECTION_TITLE_HEIGHT - 16),
    };
}

/** 解析画布尺寸：非法值回落缺省，过小/过大收敛到区间内。 */
export function resolveProductionBoardSize(width?: number, height?: number): { width: number; height: number } {
    return {
        width: resolveDimension(width, PRODUCTION_BOARD_DEFAULT_WIDTH, PRODUCTION_BOARD_MIN_WIDTH),
        height: resolveDimension(height, PRODUCTION_BOARD_DEFAULT_HEIGHT, PRODUCTION_BOARD_MIN_HEIGHT),
    };
}

function resolveDimension(value: number | undefined, fallback: number, minimum: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(PRODUCTION_BOARD_MAX_DIMENSION, Math.max(minimum, Math.floor(value)));
}

/** 按固定基点把版面切成九块，返回的分区互不重叠且恰好铺满可用高度。 */
export function computeBoardLayout(width: number, height: number): { board: BoardRect; availableHeight: number; sections: ProductionBoardSectionLayout[] } {
    const innerWidth = Math.max(0, width - BOARD_PADDING * 2);
    const availableHeight = Math.max(0, height - BOARD_PADDING * 2 - SECTION_GAP * (SECTION_SPECS.length - 1));
    const cumulative: number[] = [0];
    for (const spec of SECTION_SPECS) cumulative.push(cumulative[cumulative.length - 1] + spec.basisPoints);

    const topOf = (index: number) => BOARD_PADDING + Math.round((availableHeight * cumulative[index]) / 1000) + SECTION_GAP * index;

    const sections = SECTION_SPECS.map((spec, index) => {
        const y = topOf(index);
        const height = Math.max(0, topOf(index + 1) - SECTION_GAP - y);
        return { id: spec.id, title: spec.title, rect: { x: BOARD_PADDING, y, width: innerWidth, height } };
    });

    return { board: { x: 0, y: 0, width, height }, availableHeight, sections };
}

// ---------------------------------------------------------------------------
// 槽位对齐与降级判定（纯函数，全部可测）
// ---------------------------------------------------------------------------

export type StoryboardSlot = { shot: BoardShot; frame: SampledVideoFrame | null };
export type CharacterSlot = { name: string; lines: string[]; frame: SampledVideoFrame | null };
export type LightingSlot = { title: string; detail: string; frame: SampledVideoFrame | null };

/** 故事板槽位：帧按下标与镜头一一对应，缺失就是 null，绝不借用其它帧。 */
export function resolveStoryboardSlots(shots: BoardShot[], frames: (SampledVideoFrame | null)[]): { slots: StoryboardSlot[]; hiddenCount: number } {
    const list = shots ?? [];
    const visible = list.slice(0, PRODUCTION_BOARD_MAX_STORYBOARD_CELLS);
    return {
        slots: visible.map((shot, index) => ({ shot, frame: frames?.[index] ?? null })),
        hiddenCount: Math.max(0, list.length - visible.length),
    };
}

/** 故事板每格的四项标注：镜头类型、景别、运动方式、动作与情绪。 */
export function buildStoryboardAnnotations(shot: BoardShot): string[] {
    return [`镜头：${fieldText(shot.cameraType)}`, `景别：${fieldText(shot.shotSize)} · ${fieldText(shot.movement)}`, `动作：${fieldText(shot.action)}`];
}

/** 角色三类说明：外观、服装、一致性。 */
export function buildCharacterLines(character: { appearance: string; costume: string; consistency: string }): string[] {
    return [`外观：${fieldText(character.appearance)}`, `服装：${fieldText(character.costume)}`, `一致性：${fieldText(character.consistency)}`];
}

/** 角色槽位：列数取角色数与帧数的较大者（都不为空时），并受列数上限约束。 */
export function resolveCharacterSlots(characters: ProductionBoardAnalysis["characters"], frames: SampledVideoFrame[]): CharacterSlot[] {
    const list = characters ?? [];
    const media = frames ?? [];
    const count = Math.min(Math.max(list.length, media.length), PRODUCTION_BOARD_MAX_CHARACTER_COLUMNS);
    return Array.from({ length: count }, (_, index) => ({
        name: (list[index]?.name ?? "").trim(),
        lines: list[index] ? buildCharacterLines(list[index]) : [],
        frame: media[index] ?? null,
    }));
}

/** 灯光槽位：条目与参考帧按列对齐，缺失侧补空。 */
export function resolveLightingSlots(lighting: BoardLighting[], frames: SampledVideoFrame[]): LightingSlot[] {
    const list = lighting ?? [];
    const media = frames ?? [];
    const count = Math.min(Math.max(list.length, media.length), PRODUCTION_BOARD_MAX_LIGHTING_COLUMNS);
    return Array.from({ length: count }, (_, index) => {
        const entry = list[index];
        return {
            title: entry ? `${fieldText(entry.name)} · ${fieldText(entry.timeOfDay)}` : PRODUCTION_BOARD_EMPTY_TEXT,
            detail: entry ? `${fieldText(entry.quality)} · ${fieldText(entry.note)}` : "",
            frame: media[index] ?? null,
        };
    });
}

/**
 * 环境分区的场景帧：调用方显式给就用它，没给就回落到故事板里真实存在的帧，
 * 保证环境分区不会因为入口没传场景帧而空着。两者都没有时返回空数组，由绘制层写明未覆盖。
 */
export function resolveSceneFrames(storyboardFrames: (SampledVideoFrame | null)[], sceneFrames: SampledVideoFrame[]): SampledVideoFrame[] {
    const explicit = (sceneFrames ?? []).filter((item): item is SampledVideoFrame => Boolean(item?.dataUrl));
    if (explicit.length) return explicit.slice(0, PRODUCTION_BOARD_MAX_SCENE_FRAMES);
    return (storyboardFrames ?? []).filter((item): item is SampledVideoFrame => Boolean(item?.dataUrl)).slice(0, PRODUCTION_BOARD_MAX_SCENE_FRAMES);
}

/** 调色板色块：非法色值直接丢弃，超过上限截断并如实给出未展示数量。 */
export function planPaletteSwatches(palette: BoardPalette[]): { swatches: BoardPalette[]; hiddenCount: number } {
    const normalized = (palette ?? []).map((item) => ({ name: (item?.name ?? "").trim() || PRODUCTION_BOARD_EMPTY_TEXT, hex: normalizeBoardHexColor(item?.hex) })).filter((item) => Boolean(item.hex));
    const swatches = normalized.slice(0, PRODUCTION_BOARD_MAX_PALETTE_SWATCHES);
    return { swatches, hiddenCount: Math.max(0, normalized.length - swatches.length) };
}

export const LIGHTING_TITLE_LINE_HEIGHT = 18;
export const LIGHTING_DETAIL_LINE_HEIGHT = 16;

export const MOOD_TAG_FONT_SIZE = 15;
export const MOOD_TAG_HEIGHT = 26;
export const MOOD_TAG_PADDING_X = 12;
export const MOOD_TAG_GAP = 8;
export const MOOD_TAG_ROW_GAP = 6;

export type MoodTag = { text: string; x: number; y: number; width: number; height: number };

/** 关键词标签的排布：从左到右铺，放不下换行；超出矩形高度的如实计入 hiddenCount。 */
export function planMoodTagRows(keywords: string[], rect: BoardRect, measure: MeasureTextFn, fontSize = MOOD_TAG_FONT_SIZE): { tags: MoodTag[]; hiddenCount: number } {
    const texts = (keywords ?? []).map((keyword) => String(keyword ?? "").trim()).filter(Boolean);
    if (!texts.length) return { tags: [], hiddenCount: 0 };
    if (rect.width <= 0 || rect.height <= 0) return { tags: [], hiddenCount: texts.length };

    const tags: MoodTag[] = [];
    let x = 0;
    let y = 0;
    let hiddenCount = 0;
    for (const text of texts) {
        const label = truncateTextToWidth(text, Math.max(fontSize, rect.width - MOOD_TAG_PADDING_X * 2), measure);
        const width = Math.min(rect.width, measure(label) + MOOD_TAG_PADDING_X * 2);
        if (x > 0 && x + width > rect.width) {
            x = 0;
            y += MOOD_TAG_HEIGHT + MOOD_TAG_ROW_GAP;
        }
        if (y + MOOD_TAG_HEIGHT > rect.height) {
            hiddenCount += 1;
            continue;
        }
        tags.push({ text: label, x, y, width, height: MOOD_TAG_HEIGHT });
        x += width + MOOD_TAG_GAP;
    }
    return { tags, hiddenCount };
}

// ---------------------------------------------------------------------------
// 帧图：解码、等比裁剪、按 dataUrl 复用
// ---------------------------------------------------------------------------

/**
 * 解码一张帧图。dataUrl 为空或解码失败（含超时）返回 null——
 * 单张帧坏掉只能降级成占位，绝不能让整块板渲染失败。
 */
export function loadImage(dataUrl: string, timeoutMs = PRODUCTION_BOARD_IMAGE_TIMEOUT_MS): Promise<BoardImage | null> {
    return new Promise((resolve) => {
        if (!dataUrl?.trim()) {
            resolve(null);
            return;
        }
        const image = new Image();
        let settled = false;
        const finish = (result: BoardImage | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        image.onload = () => finish(image);
        image.onerror = () => finish(null);
        image.src = dataUrl;
    });
}

/** 取出图片的原始像素尺寸；取不到（未解码完成/非图片）返回 null。 */
export function imageSize(image: BoardImage): { width: number; height: number } | null {
    const candidate = image as unknown as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    const width = Number(candidate.naturalWidth ?? candidate.width ?? 0);
    const height = Number(candidate.naturalHeight ?? candidate.height ?? 0);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * 等比裁剪（cover）的源矩形：把原图按目标框的长宽比居中裁一块，
 * 保证帧不被拉伸变形。尺寸不可用时返回 null，由调用方退化成直接缩放。
 */
export function computeCoverSource(size: { width: number; height: number }, box: { width: number; height: number }): { sx: number; sy: number; sw: number; sh: number } | null {
    const { width: imageWidth, height: imageHeight } = size;
    const { width: boxWidth, height: boxHeight } = box;
    if (!(imageWidth > 0) || !(imageHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return null;
    const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    const sw = Math.min(imageWidth, boxWidth / scale);
    const sh = Math.min(imageHeight, boxHeight / scale);
    return { sx: (imageWidth - sw) / 2, sy: (imageHeight - sh) / 2, sw, sh };
}

/** 按 dataUrl 取出已解码的帧图；帧为空或该帧解码失败时返回 null。 */
export function frameImage(images: BoardImageMap, frame: SampledVideoFrame | null | undefined): BoardImage | null {
    if (!frame?.dataUrl) return null;
    return images.get(frame.dataUrl) ?? null;
}

/** 帧图框对源图的保留比例（cover 裁剪的量化结果）。 */
export type CoverRetention = { widthRatio: number; heightRatio: number };

/**
 * cover 裁剪后源图还剩多少：总有一维完整保留（100%），另一维按长宽比被裁掉。
 * 这是「竖屏源在故事板里被裁掉多少」的唯一度量，故事板版式是否合格由它判定。
 */
export function computeCoverRetention(size: { width: number; height: number }, box: { width: number; height: number }): CoverRetention | null {
    const source = computeCoverSource(size, box);
    if (!source || !(size.width > 0) || !(size.height > 0)) return null;
    return { widthRatio: source.sw / size.width, heightRatio: source.sh / size.height };
}

export type FrameOrientation = "portrait" | "landscape";

/**
 * 竖屏源帧框的宽高比上限。0.9375 = 0.5625 / 0.6，正好对应「纵向内容至少保留 60%」。
 * 帧框比这更宽，cover 裁剪就开始把画面腰斩成横带。
 */
export const PORTRAIT_FRAME_MAX_ASPECT = 0.9375;
/** 帧框纵向保留比例下限；竖屏源版式的合格线。 */
export const MIN_PORTRAIT_FRAME_RETENTION = 0.6;
/**
 * 任何朝向的帧框宽高比上限。超过 2:1 的框，横屏源也会退化成长条横带
 * （角色区单个角色曾经画到 988×100 = 9.9:1，等于画面中间一条线）。
 */
export const LANDSCAPE_FRAME_MAX_ASPECT = 2;

/** 帧框允许的最大宽高比：竖屏源按 60% 保留反推，横屏源按 2:1 封顶。 */
export function frameMaxAspect(orientation: FrameOrientation | null | undefined): number {
    return orientation === "portrait" ? PORTRAIT_FRAME_MAX_ASPECT : LANDSCAPE_FRAME_MAX_ASPECT;
}

/**
 * 帧框的落定尺寸：在可用空间内取「不超宽」的最大框。
 * 高度由版式决定（它被文字区的预算锁死，不能动），所以只能收窄宽度——
 * 宁可两侧留白，也不画一个裁到只剩横带的框。
 */
export function fitFrameBox(available: { width: number; height: number }, orientation: FrameOrientation | null | undefined): { width: number; height: number } {
    const height = Math.max(0, available.height);
    const width = Math.max(0, Math.min(Math.max(0, available.width), height * frameMaxAspect(orientation)));
    return { width, height };
}

/**
 * 在一行里排布 count 个帧框：每个框按可读性上限收窄，整行在容器内水平居中。
 * 环境场景帧与灯光参考帧共用这一套，避免两处各写一份、只修一处。
 */
export function planFrameRow(container: BoardRect, count: number, gap: number, orientation: FrameOrientation | null | undefined): BoardRect[] {
    const total = Number.isFinite(count) ? Math.floor(count) : 0;
    if (total < 1 || container.width <= 0 || container.height <= 0) return [];
    const availableWidth = (container.width - gap * (total - 1)) / total;
    const box = fitFrameBox({ width: availableWidth, height: container.height }, orientation);
    const rowWidth = box.width * total + gap * (total - 1);
    const startX = container.x + Math.max(0, (container.width - rowWidth) / 2);
    return Array.from({ length: total }, (_, index) => ({ x: startX + index * (box.width + gap), y: container.y, width: box.width, height: box.height }));
}

/** 判断抽帧的整体朝向：整段视频的帧朝向基本一致，少数异向帧（旋转镜头）按多数派处理。 */
export function resolveFramesOrientation(frames: readonly (SampledVideoFrame | null)[], images: BoardImageMap): FrameOrientation {
    let portrait = 0;
    let landscape = 0;
    for (const frame of frames) {
        const image = frameImage(images, frame);
        const size = image ? imageSize(image) : null;
        if (!size) continue;
        if (size.height > size.width) portrait += 1;
        else landscape += 1;
    }
    // 一帧都解不出来时回落到横屏：此时版式只影响占位框排布，取更宽松的既有版式。
    return portrait > landscape ? "portrait" : "landscape";
}

/** 槽位版本的朝向判定，供故事板与角色区使用。 */
export function resolveFrameOrientation(slots: readonly { frame: SampledVideoFrame | null }[], images: BoardImageMap): FrameOrientation {
    return resolveFramesOrientation(
        slots.map((slot) => slot.frame),
        images,
    );
}

// ---------------------------------------------------------------------------
// 绘制层
// ---------------------------------------------------------------------------

type TextBlockOptions = {
    size?: number;
    weight?: "normal" | "bold";
    color?: string;
    lineHeight?: number;
    maxLines?: number;
    align?: CanvasTextAlign;
};

/** 画面板底、标题条、分隔线，并裁剪到分区矩形；返回内容区矩形。 */
function beginSection(ctx: CanvasRenderingContext2D, rect: BoardRect, title: string, note?: string): BoardRect {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    ctx.fillStyle = BOARD_COLORS.panel;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = BOARD_COLORS.panelBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));

    ctx.fillStyle = BOARD_COLORS.accent;
    ctx.fillRect(rect.x, rect.y, 4, SECTION_TITLE_HEIGHT);

    ctx.font = boardFont(19, "bold");
    ctx.fillStyle = BOARD_COLORS.textPrimary;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, rect.x + PANEL_PADDING, rect.y + SECTION_TITLE_HEIGHT / 2);

    if (note) {
        const measure = createCanvasMeasureText(ctx);
        ctx.font = boardFont(14);
        ctx.fillStyle = BOARD_COLORS.accent;
        ctx.textAlign = "right";
        ctx.fillText(truncateTextToWidth(note, Math.max(0, rect.width - PANEL_PADDING * 2 - 160), measure), rect.x + rect.width - PANEL_PADDING, rect.y + SECTION_TITLE_HEIGHT / 2);
    }

    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + SECTION_TITLE_HEIGHT);
    ctx.lineTo(rect.x + rect.width, rect.y + SECTION_TITLE_HEIGHT);
    ctx.strokeStyle = BOARD_COLORS.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    return computeSectionBodyRect(rect);
}

function endSection(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
}

/** 画一段自动换行并限行的文字，返回占用的高度（放不下时不画）。 */
function drawTextBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, options: TextBlockOptions = {}): number {
    const size = options.size ?? 16;
    const lineHeight = options.lineHeight ?? Math.round(size * 1.35);
    const maxLines = options.maxLines ?? 1;
    if (maxWidth <= 0 || maxLines <= 0 || y > Number.MAX_SAFE_INTEGER) return 0;

    // 必须先设字体再测量：measureText 的结果取决于当前 font。
    ctx.font = boardFont(size, options.weight ?? "normal");
    ctx.fillStyle = options.color ?? BOARD_COLORS.textSecondary;
    ctx.textAlign = options.align ?? "left";
    ctx.textBaseline = "top";

    const lines = wrapTextClamped(text ?? "", maxWidth, maxLines, createCanvasMeasureText(ctx));
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return lines.length * lineHeight;
}

/** 按剩余高度能放下几行；放不下就返回 0，调用方据此跳过。 */
function fitLines(availableHeight: number, lineHeight: number): number {
    if (!Number.isFinite(availableHeight) || availableHeight <= 0 || lineHeight <= 0) return 0;
    return Math.floor(availableHeight / lineHeight);
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: BoardImage, box: BoardRect): boolean {
    if (box.width < 2 || box.height < 2) return false;
    const size = imageSize(image);
    const source = size ? computeCoverSource(size, box) : null;
    if (!source) {
        ctx.drawImage(image, box.x, box.y, box.width, box.height);
        return true;
    }
    ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, box.x, box.y, box.width, box.height);
    return true;
}

/** 缺帧占位框：写明缺什么，而不是留一块空白。 */
function drawFramePlaceholder(ctx: CanvasRenderingContext2D, box: BoardRect, label: string): void {
    if (box.width < 8 || box.height < 8) return;
    ctx.fillStyle = BOARD_COLORS.placeholder;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeStyle = BOARD_COLORS.placeholderBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.width - 1), Math.max(0, box.height - 1));

    ctx.font = boardFont(15);
    ctx.fillStyle = BOARD_COLORS.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateTextToWidth(label, Math.max(0, box.width - 10), createCanvasMeasureText(ctx)), box.x + box.width / 2, box.y + box.height / 2);
}

/** 帧格：有图就等比裁剪画，没图（含解码失败）就画占位。 */
function drawFrameBox(ctx: CanvasRenderingContext2D, box: BoardRect, image: BoardImage | null, placeholder: string): void {
    if (image && drawImageCover(ctx, image, box)) return;
    drawFramePlaceholder(ctx, box, placeholder);
}

/** 画一格帧图或占位；返回是否真的画了图（供调用方统计）。 */
function drawFrameSlot(ctx: CanvasRenderingContext2D, images: BoardImageMap, frame: SampledVideoFrame | null, box: BoardRect, placeholder: string): boolean {
    const image = frameImage(images, frame);
    if (image) {
        drawFrameBox(ctx, box, image, placeholder);
        return true;
    }
    drawFrameBox(ctx, box, null, placeholder);
    return false;
}

/** 版底网格：让整块板读起来是「网格化分区的规划板」而不是一张拼贴。 */
export function drawBoardGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = BOARD_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 60) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += 60) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
}

/** 一、标题与 logline。 */
export function drawBoardHeader(ctx: CanvasRenderingContext2D, rect: BoardRect, analysis: ProductionBoardAnalysis): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.header);
    let y = body.y;
    y += drawTextBlock(ctx, fieldText(analysis.title), body.x, y, body.width, { size: 38, weight: "bold", color: BOARD_COLORS.textPrimary, lineHeight: 46, maxLines: 1 }) + 4;
    // logline 的行数按剩余高度算，绝不让后半行被分区下边缘裁掉半截字。
    const loglineLines = Math.min(2, fitLines(body.y + body.height - y, 22));
    if (loglineLines > 0) {
        drawTextBlock(ctx, fieldText(analysis.logline), body.x, y, body.width, { size: 17, color: BOARD_COLORS.textSecondary, lineHeight: 22, maxLines: loglineLines });
    }
    endSection(ctx);
}

/** 二、共享创意指导：镜头数、调色板、环境、备注。 */
export function drawSharedDirection(ctx: CanvasRenderingContext2D, rect: BoardRect, analysis: ProductionBoardAnalysis): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.shared);
    let y = body.y;

    const shotCount = Number.isFinite(analysis.shared?.shotCount) ? String(analysis.shared.shotCount) : PRODUCTION_BOARD_EMPTY_TEXT;
    y += drawTextBlock(ctx, `镜头数：${shotCount}`, body.x, y, body.width, { size: 18, weight: "bold", color: BOARD_COLORS.textPrimary, lineHeight: 22, maxLines: 1 }) + 4;

    y += drawPalette(ctx, body, y, analysis.shared?.palette ?? []) + 6;
    y += drawTextBlock(ctx, `环境：${fieldText(analysis.shared?.environment)}`, body.x, y, body.width, { size: 15, color: BOARD_COLORS.textSecondary, lineHeight: 17, maxLines: 1 }) + 2;
    drawTextBlock(ctx, `备注：${fieldText(analysis.shared?.notes)}`, body.x, y, body.width, { size: 15, color: BOARD_COLORS.textMuted, lineHeight: 17, maxLines: 1 });

    endSection(ctx);
}

function drawPalette(ctx: CanvasRenderingContext2D, body: BoardRect, y: number, palette: BoardPalette[]): number {
    const { swatches, hiddenCount } = planPaletteSwatches(palette);
    if (!swatches.length) {
        return drawTextBlock(ctx, `调色板：${PRODUCTION_BOARD_EMPTY_TEXT}`, body.x, y, body.width, { size: 15, color: BOARD_COLORS.textMuted, lineHeight: 17, maxLines: 1 });
    }

    const gap = 10;
    const noteWidth = hiddenCount ? 64 : 0;
    const columnWidth = Math.max(1, (body.width - noteWidth - gap * (swatches.length - 1)) / swatches.length);
    const swatchHeight = 22;

    swatches.forEach((swatch, index) => {
        const x = body.x + index * (columnWidth + gap);
        ctx.fillStyle = swatch.hex;
        ctx.fillRect(x, y, columnWidth, swatchHeight);
        ctx.strokeStyle = BOARD_COLORS.panelBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, columnWidth - 1), swatchHeight - 1);

        ctx.font = boardFont(14);
        ctx.fillStyle = BOARD_COLORS.textSecondary;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(truncateTextToWidth(`${swatch.name} ${swatch.hex}`, columnWidth, createCanvasMeasureText(ctx)), x, y + swatchHeight + 4);
    });

    if (hiddenCount) {
        ctx.font = boardFont(14);
        ctx.fillStyle = BOARD_COLORS.textMuted;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(`+${hiddenCount}`, body.x + body.width - noteWidth + 8, y + swatchHeight / 2 - 7);
    }

    return swatchHeight + 4 + 17;
}

export type CharacterTextLayout = "sideBySide" | "stacked";
export type CharacterCellLayout = { layout: CharacterTextLayout; imageBox: BoardRect; textRect: BoardRect };

/** 角色名与三类说明占用的高度（6 间距 + 角色名 22 + 三条说明各一行 48，留 4px 余量）。 */
export const CHARACTER_TEXT_RESERVE = 80;
/** 角色说明的字号与行高：与绘制层严格一致，容量判据才算数。 */
export const CHARACTER_TEXT_FONT_SIZE = 14;
export const CHARACTER_TEXT_LINE_HEIGHT = 16;
/** 角色名的行高。 */
export const CHARACTER_NAME_LINE_HEIGHT = 22;
/** 单条说明最多允许几行：并排后文字区更高，窄列里 30 字说明需要 3 行。 */
export const CHARACTER_ITEM_MAX_LINES = 3;
/** 分析层对单条角色说明的限长（字）与条数，用于校验并排后仍放得下最坏情况。 */
export const CHARACTER_ITEM_CHAR_LIMIT = 30;
export const CHARACTER_ITEM_COUNT = 3;
/**
 * 角色文字列的最小宽度：14px 字号下一行放得下约 30 个汉字。
 * 单角色并排时仍满足；这是分析层 30 字限长在一行内成立的宽度。
 */
export const CHARACTER_TEXT_MIN_WIDTH = 420;

/** 文字区容量：一行放得下多少字 × 能放多少行。用于判断并排是否牺牲了文字容量。 */
export function characterTextCapacity(rect: BoardRect): number {
    const charsPerLine = Math.max(0, Math.floor(rect.width / CHARACTER_TEXT_FONT_SIZE));
    const lines = Math.max(0, Math.floor(rect.height / CHARACTER_TEXT_LINE_HEIGHT));
    return charsPerLine * lines;
}

/**
 * 最坏情况下文字区需要的高度：角色名一行 + 每条说明都写满分析层限长。
 * 这是「并排会不会把说明挤掉」的判据——比单看面积更贴近真实排版。
 */
export function characterWorstCaseHeight(rect: BoardRect): number {
    const charsPerLine = Math.max(1, Math.floor(rect.width / CHARACTER_TEXT_FONT_SIZE));
    return CHARACTER_NAME_LINE_HEIGHT + CHARACTER_ITEM_COUNT * Math.ceil(CHARACTER_ITEM_CHAR_LIMIT / charsPerLine) * CHARACTER_TEXT_LINE_HEIGHT;
}

/**
 * 角色单元格：图框按可读性上限收窄，文字区容量不因收窄而下降。
 *
 * 并排（图左文右）能让图吃满整段正文高度，图比上下排布大一倍多——角色区存在的意义
 * 就是让人看清角色，所以只要容量不下降就优先并排：
 *   条件一：并排后文字区容量（每行字数 × 行数）不低于上下排布；
 *   条件二：并排后文字区放得下最坏情况（三条说明都写满限长）。
 * 两个条件任一不满足就退回上下排布，此时文字区与收窄前逐像素一致。
 */
export function planCharacterCellLayout(column: BoardRect, orientation: FrameOrientation | null | undefined): CharacterCellLayout {
    const gap = 12;
    const textGap = 6;
    const imageHeight = Math.max(0, column.height - CHARACTER_TEXT_RESERVE);
    const stackedText: BoardRect = { x: column.x, y: column.y + imageHeight + textGap, width: column.width, height: Math.max(0, column.height - imageHeight - textGap) };
    const stackedImageBox = fitFrameBox({ width: column.width, height: imageHeight }, orientation);

    const fullHeightWidth = Math.max(0, Math.min(column.width, column.height * frameMaxAspect(orientation)));
    const sideTextWidth = column.width - fullHeightWidth - gap;
    if (sideTextWidth > 0) {
        const sideText: BoardRect = { x: column.x + fullHeightWidth + gap, y: column.y, width: sideTextWidth, height: Math.max(0, column.height) };
        if (characterTextCapacity(sideText) >= characterTextCapacity(stackedText) && characterWorstCaseHeight(sideText) <= sideText.height) {
            return { layout: "sideBySide", imageBox: { x: column.x, y: column.y, width: fullHeightWidth, height: Math.max(0, column.height) }, textRect: sideText };
        }
    }

    return {
        layout: "stacked",
        imageBox: { x: column.x + Math.max(0, (column.width - stackedImageBox.width) / 2), y: column.y, width: stackedImageBox.width, height: stackedImageBox.height },
        textRect: stackedText,
    };
}

/** 三、角色与风格参考：帧 + 外观/服装/一致性。 */
export function drawCharacterSection(ctx: CanvasRenderingContext2D, rect: BoardRect, slots: CharacterSlot[], images: BoardImageMap): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.characters);
    if (!slots.length) {
        drawTextBlock(ctx, PRODUCTION_BOARD_NO_MATERIAL_TEXT, body.x, body.y + 18, body.width, { size: 16, color: BOARD_COLORS.textMuted, lineHeight: 20, maxLines: 1 });
        endSection(ctx);
        return;
    }

    const gap = 12;
    const columnWidth = Math.max(1, (body.width - gap * (slots.length - 1)) / slots.length);
    const orientation = resolveFrameOrientation(slots, images);

    slots.forEach((slot, index) => {
        const column = { x: body.x + index * (columnWidth + gap), y: body.y, width: columnWidth, height: body.height };
        const cell = planCharacterCellLayout(column, orientation);
        drawFrameSlot(ctx, images, slot.frame, cell.imageBox, PRODUCTION_BOARD_NO_MATERIAL_TEXT);

        let y = cell.textRect.y;
        y += drawTextBlock(ctx, slot.name || PRODUCTION_BOARD_EMPTY_TEXT, cell.textRect.x, y, cell.textRect.width, { size: 18, weight: "bold", color: BOARD_COLORS.textPrimary, lineHeight: CHARACTER_NAME_LINE_HEIGHT, maxLines: 1 });

        // 行数上限与 CHARACTER_* 常量保持一致，容量判据才对得上真实排版。
        let remaining = cell.textRect.y + cell.textRect.height - y;
        for (const line of slot.lines) {
            const maxLines = Math.min(fitLines(remaining, CHARACTER_TEXT_LINE_HEIGHT), CHARACTER_ITEM_MAX_LINES);
            if (maxLines <= 0) break;
            const used = drawTextBlock(ctx, line, cell.textRect.x, y, cell.textRect.width, { size: CHARACTER_TEXT_FONT_SIZE, color: BOARD_COLORS.textSecondary, lineHeight: CHARACTER_TEXT_LINE_HEIGHT, maxLines });
            y += used;
            remaining -= used;
        }
    });

    endSection(ctx);
}

/** 四、环境与场景设计：场景帧 + 俯视机位示意图。 */
export function drawEnvironmentSection(ctx: CanvasRenderingContext2D, rect: BoardRect, analysis: ProductionBoardAnalysis, sceneFrames: SampledVideoFrame[], images: BoardImageMap): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.environment);
    const gap = 12;
    const leftWidth = Math.round((body.width - gap) * 0.5);
    const rightWidth = Math.max(1, body.width - gap - leftWidth);

    let y = body.y;
    y += drawTextBlock(ctx, `地点：${fieldText(analysis.environment?.location)}`, body.x, y, leftWidth, { size: 18, weight: "bold", color: BOARD_COLORS.textPrimary, lineHeight: 22, maxLines: 1 }) + 4;

    const frames = sceneFrames.slice(0, PRODUCTION_BOARD_MAX_SCENE_FRAMES);
    const frameGap = 8;
    const frameHeight = Math.max(32, Math.min(120, body.y + body.height - y - 24));
    const frameRow = planFrameRow({ x: body.x, y, width: leftWidth, height: frameHeight }, frames.length, frameGap, resolveFramesOrientation(frames, images));
    if (frameRow.length) {
        frames.forEach((frame, index) => drawFrameSlot(ctx, images, frame, frameRow[index], PRODUCTION_BOARD_NO_MATERIAL_TEXT));
    } else {
        // 没有场景帧时按同一套上限画占位框，避免占位框自己又变成一条横带。
        const placeholder = fitFrameBox({ width: leftWidth, height: frameHeight }, resolveFramesOrientation(frames, images));
        drawFrameSlot(ctx, images, null, { x: body.x, y, ...placeholder }, PRODUCTION_BOARD_NO_MATERIAL_TEXT);
    }
    y += frameHeight + 6;

    const descriptionLines = fitLines(body.y + body.height - y, 16);
    if (descriptionLines > 0) {
        drawTextBlock(ctx, `描述：${fieldText(analysis.environment?.description)}`, body.x, y, leftWidth, { size: 14, color: BOARD_COLORS.textSecondary, lineHeight: 16, maxLines: descriptionLines });
    }

    drawCameraMap(ctx, { x: body.x + leftWidth + gap, y: body.y, width: rightWidth, height: body.height }, analysis.environment);
    endSection(ctx);
}

/** 五、故事板：编号帧网格，每格四项标注。 */
export function drawStoryboardSection(ctx: CanvasRenderingContext2D, rect: BoardRect, slots: StoryboardSlot[], hiddenCount: number, images: BoardImageMap): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.storyboard, hiddenCount > 0 ? `${hiddenCount} 个镜头未展示` : undefined);
    if (!slots.length) {
        drawTextBlock(ctx, PRODUCTION_BOARD_NO_MATERIAL_TEXT, body.x, body.y + 18, body.width, { size: 16, color: BOARD_COLORS.textMuted, lineHeight: 20, maxLines: 1 });
        endSection(ctx);
        return;
    }

    // 由抽帧自身的朝向决定网格形状：竖屏源走单行影片条，帧图纵向内容才不被裁掉。
    const layout = computeStoryboardCellLayout(body, slots.length, resolveFrameOrientation(slots, images));
    const { columns, cellWidth, cellHeight, imageHeight, gap, actionMaxLines } = layout;

    slots.forEach((slot, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = body.x + column * (cellWidth + gap);
        const y = body.y + row * (cellHeight + gap);

        const image = frameImage(images, slot.frame);
        drawFrameBox(ctx, { x, y, width: cellWidth, height: imageHeight }, image, PRODUCTION_BOARD_NO_FRAME_TEXT);
        drawOrderBadge(ctx, x + 6, y + 6, slot.shot.index);

        // 标注块高度固定为 labelBlockHeight，画满即正好贴到格子底边，不再往下一行渗。
        const [cameraLine, sizeLine, actionLine] = buildStoryboardAnnotations(slot.shot);
        let lineY = y + imageHeight + STORYBOARD_LABEL_GAP;
        lineY += drawTextBlock(ctx, cameraLine, x, lineY, cellWidth, { size: STORYBOARD_LABEL_FONT_SIZE, color: BOARD_COLORS.textPrimary, lineHeight: STORYBOARD_LABEL_LINE_HEIGHT, maxLines: 1 });
        lineY += drawTextBlock(ctx, sizeLine, x, lineY, cellWidth, { size: STORYBOARD_LABEL_FONT_SIZE, color: BOARD_COLORS.textSecondary, lineHeight: STORYBOARD_LABEL_LINE_HEIGHT, maxLines: 1 });
        drawTextBlock(ctx, actionLine, x, lineY, cellWidth, { size: STORYBOARD_LABEL_FONT_SIZE, color: BOARD_COLORS.textMuted, lineHeight: STORYBOARD_LABEL_LINE_HEIGHT, maxLines: actionMaxLines });
    });

    endSection(ctx);
}

export const STORYBOARD_LABEL_FONT_SIZE = 13;
export const STORYBOARD_LABEL_LINE_HEIGHT = 15;
/** 标注块与帧图之间的间距。 */
export const STORYBOARD_LABEL_GAP = 4;
/** 标注块里固定两行（镜头、景别 · 运动），动作占的额外行数由版式决定。 */
export const STORYBOARD_FIXED_LABEL_LINES = 2;
/** 横屏源用四列两行；动作标注最多两行。 */
export const PRODUCTION_BOARD_STORYBOARD_GRID_COLUMNS = 4;
/** 竖屏源用单行影片条，最多八格。 */
export const PRODUCTION_BOARD_STORYBOARD_STRIP_COLUMNS = 8;
const STORYBOARD_GRID_GAP = 10;
const STORYBOARD_STRIP_GAP = 8;
/** 单行时帧图更高，省下的高度还给动作标注。 */
const STORYBOARD_ACTION_LINES_STRIP = 3;
const STORYBOARD_ACTION_LINES_GRID = 2;

export type StoryboardCellLayout = {
    columns: number;
    rows: number;
    gap: number;
    cellWidth: number;
    cellHeight: number;
    imageHeight: number;
    labelBlockHeight: number;
    /** 动作标注允许的行数；其余三项各一行。 */
    actionMaxLines: number;
};

/**
 * 故事板格子的几何：先定格高，再把标注块从格高里扣掉，剩下的才是帧图高度。
 * 这样「图 + 标注」的总高恒等于格高，既不会少画一行，也不会把末行挤到相邻格。
 *
 * 网格形状由源视频朝向决定，这是保住竖屏画面纵向内容的关键：
 * 帧图框越窄越高，cover 裁剪才越接近竖版源图的长宽比。
 * 横屏源用四列两行（框接近 16:9，横向保留约 89%）；
 * 竖屏源改成单行影片条——格子变得又窄又高，框比源图更瘦长，纵向内容 100% 保留。
 * 反面例子：占位 240×151 的框装 1080×1920 的竖屏源，纵向只剩约 36%，画面等于被腰斩。
 */
export function computeStoryboardCellLayout(body: BoardRect, count: number, orientation: FrameOrientation = "landscape"): StoryboardCellLayout {
    const total = Math.max(0, count);
    const isStrip = orientation === "portrait";
    const maxColumns = isStrip ? PRODUCTION_BOARD_STORYBOARD_STRIP_COLUMNS : PRODUCTION_BOARD_STORYBOARD_GRID_COLUMNS;
    const columns = Math.max(1, Math.min(total, maxColumns));
    const rows = Math.max(1, Math.ceil(total / columns));
    const gap = isStrip ? STORYBOARD_STRIP_GAP : STORYBOARD_GRID_GAP;
    const cellWidth = Math.max(1, (body.width - gap * (columns - 1)) / columns);
    const cellHeight = Math.max(1, (body.height - gap * (rows - 1)) / rows);
    const actionMaxLines = rows === 1 ? STORYBOARD_ACTION_LINES_STRIP : STORYBOARD_ACTION_LINES_GRID;
    const labelBlockHeight = STORYBOARD_LABEL_LINE_HEIGHT * (STORYBOARD_FIXED_LABEL_LINES + actionMaxLines) + STORYBOARD_LABEL_GAP;
    return { columns, rows, gap, cellWidth, cellHeight, imageHeight: Math.max(0, cellHeight - labelBlockHeight), labelBlockHeight, actionMaxLines };
}

/** 帧格上的编号徽标：让「编号帧网格」一眼看出顺序。 */
function drawOrderBadge(ctx: CanvasRenderingContext2D, x: number, y: number, index: number): void {
    const size = 22;
    ctx.fillStyle = BOARD_COLORS.accent;
    ctx.fillRect(x, y, size, size);
    ctx.font = boardFont(14, "bold");
    ctx.fillStyle = BOARD_COLORS.markerText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Number.isFinite(index) ? index : ""), x + size / 2, y + size / 2);
}

/** 六、灯光 / 情绪 / 风格：条目文字 + 参考帧。 */
export function drawLightingSection(ctx: CanvasRenderingContext2D, rect: BoardRect, slots: LightingSlot[], images: BoardImageMap): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.lighting);
    if (!slots.length) {
        drawTextBlock(ctx, `未标注灯光信息`, body.x, body.y + 18, body.width, { size: 16, color: BOARD_COLORS.textMuted, lineHeight: 20, maxLines: 1 });
        endSection(ctx);
        return;
    }

    const gap = 12;
    const textWidth = Math.round((body.width - gap) * 0.62);
    const mediaWidth = Math.max(1, body.width - gap - textWidth);

    // 每条光源固定占「标题一行 + 说明一行 + 间距」，剩下的放不下就整条不画，不画半条。
    const entryHeight = LIGHTING_TITLE_LINE_HEIGHT + LIGHTING_DETAIL_LINE_HEIGHT + 4;
    let y = body.y;
    for (const slot of slots) {
        if (fitLines(body.y + body.height - y, entryHeight) <= 0) break;
        y += drawTextBlock(ctx, slot.title, body.x, y, textWidth, { size: 15, weight: "bold", color: BOARD_COLORS.textPrimary, lineHeight: LIGHTING_TITLE_LINE_HEIGHT, maxLines: 1 });
        y += drawTextBlock(ctx, slot.detail, body.x, y, textWidth, { size: 13, color: BOARD_COLORS.textSecondary, lineHeight: LIGHTING_DETAIL_LINE_HEIGHT, maxLines: 1 }) + 4;
    }

    const frameGap = 8;
    const mediaX = body.x + textWidth + gap;
    const frameRow = planFrameRow({ x: mediaX, y: body.y, width: mediaWidth, height: body.height }, slots.length, frameGap, resolveFrameOrientation(slots, images));
    slots.forEach((slot, index) => {
        drawFrameSlot(ctx, images, slot.frame, frameRow[index] ?? { x: mediaX, y: body.y, width: 0, height: 0 }, PRODUCTION_BOARD_NO_MATERIAL_TEXT);
    });

    endSection(ctx);
}

/** 七、情绪关键词：标签块。 */
export function drawMoodSection(ctx: CanvasRenderingContext2D, rect: BoardRect, keywords: string[]): void {
    const list = (keywords ?? []).map((keyword) => String(keyword ?? "").trim()).filter(Boolean);
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.mood);
    if (!list.length) {
        drawTextBlock(ctx, "未标注情绪关键词", body.x, body.y + 6, body.width, { size: 16, color: BOARD_COLORS.textMuted, lineHeight: 20, maxLines: 1 });
        endSection(ctx);
        return;
    }

    const { tags, hiddenCount } = planMoodTagRows(list, body, createCanvasMeasureText(ctx));
    for (const tag of tags) {
        const x = body.x + tag.x;
        const y = body.y + tag.y;
        ctx.fillStyle = BOARD_COLORS.accentSoft;
        ctx.fillRect(x, y, tag.width, tag.height);
        ctx.strokeStyle = BOARD_COLORS.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, tag.width - 1), Math.max(0, tag.height - 1));

        ctx.font = boardFont(MOOD_TAG_FONT_SIZE);
        ctx.fillStyle = BOARD_COLORS.textPrimary;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tag.text, x + tag.width / 2, y + tag.height / 2);
    }

    if (hiddenCount > 0) {
        ctx.font = boardFont(13);
        ctx.fillStyle = BOARD_COLORS.textMuted;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`另有 ${hiddenCount} 个关键词未展示`, body.x + body.width, body.y + body.height);
    }

    endSection(ctx);
}

/** 八、音频与音调。 */
export function drawAudioSection(ctx: CanvasRenderingContext2D, rect: BoardRect, analysis: ProductionBoardAnalysis): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.audio);
    const items: [string, string][] = [
        ["环境声", analysis.audio?.ambient ?? ""],
        ["音乐", analysis.audio?.music ?? ""],
        ["音调", analysis.audio?.tone ?? ""],
    ];
    items.forEach(([label, value], index) => {
        drawTextBlock(ctx, `${label}：${fieldText(value)}`, body.x, body.y + index * 17, body.width, { size: 16, color: BOARD_COLORS.textSecondary, lineHeight: 17, maxLines: 1 });
    });
    endSection(ctx);
}

/** 九、电影摄影笔记。 */
export function drawCinematographySection(ctx: CanvasRenderingContext2D, rect: BoardRect, text: string): void {
    const body = beginSection(ctx, rect, PRODUCTION_BOARD_SECTION_TITLES.cinematography);
    drawTextBlock(ctx, fieldText(text), body.x, body.y, body.width, { size: 16, color: BOARD_COLORS.textSecondary, lineHeight: 18, maxLines: fitLines(body.height, 18) });
    endSection(ctx);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export type ProductionBoardRenderInput = {
    analysis: ProductionBoardAnalysis;
    /** 与 storyboard 逐格对齐的抽帧；缺格为 null。 */
    storyboardFrames: (SampledVideoFrame | null)[];
    characterFrames: SampledVideoFrame[];
    lightingFrames: SampledVideoFrame[];
    /** 场景参考帧；不传时回落到故事板里真实存在的帧。 */
    sceneFrames?: SampledVideoFrame[];
    width?: number;
    height?: number;
    /** 测试/自绘场景注入用：替换 canvas 与图片解码。 */
    createCanvas?: (width: number, height: number) => HTMLCanvasElement;
    imageLoader?: (dataUrl: string) => Promise<BoardImage | null>;
};

/** 渲染 9:16 制作规划板并导出 PNG。 */
export async function renderProductionBoard(input: ProductionBoardRenderInput): Promise<Blob> {
    const { width, height } = resolveProductionBoardSize(input.width, input.height);

    // 必须先定尺寸再取上下文：改 canvas.width 会重置上下文状态。
    const canvas = input.createCanvas ? input.createCanvas(width, height) : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持 Canvas 2D，无法渲染制作规划板");

    const analysis = input.analysis;
    const storyboardFrames = input.storyboardFrames ?? [];
    const characterFrames = input.characterFrames ?? [];
    const lightingFrames = input.lightingFrames ?? [];
    const sceneFrames = resolveSceneFrames(storyboardFrames, input.sceneFrames ?? []);
    const images = await loadFrameImages([...storyboardFrames, ...characterFrames, ...lightingFrames, ...sceneFrames], input.imageLoader ?? loadImage);

    ctx.fillStyle = BOARD_COLORS.background;
    ctx.fillRect(0, 0, width, height);
    drawBoardGrid(ctx, width, height);

    const { sections } = computeBoardLayout(width, height);
    const rectOf = (id: ProductionBoardSectionId) => sections.find((section) => section.id === id)!.rect;

    const storyboard = resolveStoryboardSlots(analysis.storyboard ?? [], storyboardFrames);
    drawBoardHeader(ctx, rectOf("header"), analysis);
    drawSharedDirection(ctx, rectOf("shared"), analysis);
    drawCharacterSection(ctx, rectOf("characters"), resolveCharacterSlots(analysis.characters ?? [], characterFrames), images);
    drawEnvironmentSection(ctx, rectOf("environment"), analysis, sceneFrames, images);
    drawStoryboardSection(ctx, rectOf("storyboard"), storyboard.slots, storyboard.hiddenCount, images);
    drawLightingSection(ctx, rectOf("lighting"), resolveLightingSlots(analysis.lighting ?? [], lightingFrames), images);
    drawMoodSection(ctx, rectOf("mood"), analysis.moodKeywords ?? []);
    drawAudioSection(ctx, rectOf("audio"), analysis);
    drawCinematographySection(ctx, rectOf("cinematography"), analysis.cinematography ?? "");

    return exportCanvasPng(canvas);
}

/** 并行解码所有帧图，按 dataUrl 去重；单张失败只是不入表，不影响其余帧。 */
async function loadFrameImages(frames: (SampledVideoFrame | null)[], loader: (dataUrl: string) => Promise<BoardImage | null>): Promise<BoardImageMap> {
    const urls = [...new Set(frames.filter((frame): frame is SampledVideoFrame => Boolean(frame?.dataUrl)).map((frame) => frame.dataUrl))];
    const images = new Map<string, BoardImage>();
    const loaded = await Promise.all(urls.map(async (url) => ({ url, image: await loader(url).catch(() => null) })));
    for (const entry of loaded) {
        if (entry.image) images.set(entry.url, entry.image);
    }
    return images;
}

function exportCanvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("制作规划板导出 PNG 失败"))), "image/png");
    });
}

/** 结构化字段的回落文案：空串与纯空白都算缺失。 */
function fieldText(value: string | undefined | null): string {
    const text = String(value ?? "").trim();
    return text || PRODUCTION_BOARD_EMPTY_TEXT;
}
