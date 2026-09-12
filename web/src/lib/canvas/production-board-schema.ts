// 制作规划板的分析结果数据结构。
//
// 这是「分析层」「渲染层」「入口编排」三方共用的契约，类型由本文件单独承载，
// 避免并行开发时出现接口漂移。解析与校验在 production-board-analysis.ts。
//
// 设计意图：故事板每格带 timeSec，渲染时据此从抽帧里挑时间最接近的真实帧——
// 图用真实帧而非生成，是这块功能成本与成色的关键前提。

/** 调色板色块；hex 必须是 #RRGGBB。 */
export type BoardPalette = { name: string; hex: string };

/** 俯视示意图里的一个机位：编号、位置描述、镜头类型、运动方式。 */
export type BoardCameraMove = { order: number; position: string; shotType: string; movement: string };

/** 故事板的一格。 */
export type BoardShot = {
    /** 编号，从 1 开始。 */
    index: number;
    /** 该镜头在视频中的代表时间点（秒），用于挑选最接近的抽帧。 */
    timeSec: number;
    /** 镜头类型与感觉。 */
    cameraType: string;
    /** 镜头大小：广角 / 中景 / 特写 / 微距 等。 */
    shotSize: string;
    /** 运动方式：静态 / 跟踪 / 手持 等。 */
    movement: string;
    /** 动作与情绪进展的简要描述。 */
    action: string;
};

/** 灯光/情绪/风格条目。 */
export type BoardLighting = { name: string; timeOfDay: string; quality: string; note: string };

/** 一次制作规划板分析的结构化结果。 */
export type ProductionBoardAnalysis = {
    title: string;
    logline: string;
    shared: {
        shotCount: number;
        palette: BoardPalette[];
        environment: string;
        notes: string;
    };
    characters: { name: string; appearance: string; costume: string; consistency: string }[];
    environment: {
        location: string;
        description: string;
        cameraMoves: BoardCameraMove[];
    };
    storyboard: BoardShot[];
    lighting: BoardLighting[];
    moodKeywords: string[];
    audio: { ambient: string; music: string; tone: string };
    /** 电影摄影笔记：镜头特性、运动风格、后期处理感觉的总体视觉哲学。 */
    cinematography: string;
};

/** 合法色值：三位或六位十六进制。 */
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isBoardHexColor(value: unknown): value is string {
    return typeof value === "string" && HEX_PATTERN.test(value.trim());
}

/** 把模型给出的色值归一到大写 #RRGGBB；非法值返回空串（调用方据此丢弃该色块）。 */
export function normalizeBoardHexColor(value: unknown): string {
    if (!isBoardHexColor(value)) return "";
    const raw = value.trim().toUpperCase();
    if (raw.length === 4) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    return raw;
}
