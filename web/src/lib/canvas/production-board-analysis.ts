// 制作规划板的分析层：提示词构造与模型输出解析。
//
// 解析策略是「宽容定位、严格校验」：模型习惯把 JSON 包在说明文字或 ```json 围栏里，
// 所以先宽容地切出第一个顶层 JSON 对象；一旦进入校验就从严——必需节缺失、类型不符、
// 内容性字段为空一律抛错，并把模型原文挂在错误对象上。
//
// 取舍很明确：宁可让上层看见真实的失败并保留原文，也不要静默兜底出一张内容被编造的规划板。
// 只有三类东西允许补：编号（index/order 属于位置信息而非内容）、非法色块（丢弃该色块）、
// moodKeywords 非数组（降级为空数组）。描述、动作、镜头类型等内容性字段缺失即失败。

import {
    normalizeBoardHexColor,
    type BoardCameraMove,
    type BoardLighting,
    type BoardPalette,
    type BoardShot,
    type ProductionBoardAnalysis,
} from "@/lib/canvas/production-board-schema";

/** 解析失败错误：message 说明失败原因，raw 原样保留模型输出，供上层展示而不是丢弃。 */
export class ProductionBoardAnalysisError extends Error {
    /** 模型原始输出，含 JSON 前后的说明文字与围栏。 */
    readonly raw: string;

    constructor(message: string, raw: string) {
        super(message);
        this.name = "ProductionBoardAnalysisError";
        this.raw = raw;
    }
}

/**
 * 构造制作规划板的文本链路提示词。
 *
 * 不带参数：输入帧与时间标注由上层按既有文本链路组织，这里只描述「收到带时间标注的抽帧后该产出什么」，
 * 保证同一份契约可以被入口编排层复用。
 */
export function buildProductionBoardPrompt(): string {
    return [
        "你是一位资深电影摄影指导兼分镜师。用户会提供一段视频的多张抽帧，每张帧图上都标有该帧在视频中的时间（单位：秒）。",
        "请基于这些帧，输出这段视频的「制作规划板」结构化分析结果。",
        "",
        "输出要求：",
        "1. 只输出一个 JSON 对象。不要输出任何解释、前言、后记，也不要 Markdown 代码围栏。",
        "2. 字段名与层级必须与下面的结构完全一致，不要增删字段名、不要改大小写。",
        "3. 所有文本用简体中文。",
        "",
        "结构：",
        "{",
        '    "title": "规划板标题，简短、有片名感",',
        '    "logline": "一句话故事概括",',
        '    "shared": {',
        '        "shotCount": 8,',
        '        "palette": [{ "name": "色块名，如 主色/高光/阴影", "hex": "#RRGGBB" }],',
        '        "environment": "共享的环境与场景基调",',
        '        "notes": "共享创意指导与备注"',
        "    },",
        '    "characters": [',
        '        { "name": "角色名", "appearance": "外形特征", "costume": "服装与配饰", "consistency": "跨镜头的一致性说明" }',
        "    ],",
        '    "environment": {',
        '        "location": "场景地点",',
        '        "description": "场景描述",',
        '        "cameraMoves": [',
        '            { "order": 1, "position": "机位在场景中的位置（文字描述，如 场景左后角、主角正前方）", "shotType": "该机位的镜头类型", "movement": "该机位的运动方式" }',
        "        ]",
        "    },",
        '    "storyboard": [',
        "        {",
        '            "index": 1,',
        '            "timeSec": 0.5,',
        '            "cameraType": "镜头类型与感觉，如 低角度手持、过肩",',
        '            "shotSize": "广角 / 中景 / 特写 / 微距 之一",',
        '            "movement": "静态 / 跟踪 / 手持 之一",',
        '            "action": "该镜头的动作与情绪进展"',
        "        }",
        "    ],",
        '    "lighting": [',
        '        { "name": "灯光条目名", "timeOfDay": "时间，如 清晨/正午/夜景", "quality": "光质，如 硬光/柔光/逆光", "note": "补充说明" }',
        "    ],",
        '    "moodKeywords": ["情绪关键词"],',
        '    "audio": { "ambient": "环境声", "music": "配乐", "tone": "整体音调" },',
        '    "cinematography": "电影摄影笔记：镜头特性、运动风格与后期处理感觉的总体视觉哲学"',
        "}",
        "",
        "关键规则：",
        "- storyboard 给 8 个镜头：板面按 8 格布局，数量与 8 相差过大时会留出空占位。画面信息确实很少时不少于 6 个，场景复杂时最多 10 个。",
        "  镜头按视频时间顺序排列，index 从 1 起连续递增。",
        "- storyboard 每格必须给 timeSec：该镜头在视频中的代表时间点，单位为秒。",
        "  渲染层会用这个数值去挑时间上最接近的真实帧，所以它必须来自帧图上标注的时间。",
        "  请结合帧图上的时间标注选择一个真实落在该镜头时间范围内的秒数，不要凭空编造，也不要填成 0 或其他占位值。",
        "- shotSize 只能从 广角、中景、特写、微距 里选；movement 从 静态、跟踪、手持 里选，必要时可用 摇摄、升降、推拉 等同类词。",
        "- shared.palette 给 4 到 6 个色块，hex 必须是 #RRGGBB 形式的六位十六进制（如 #1A2B3C），不要写颜色名、不要写 rgb()，也不要省略 #。",
        "- environment.cameraMoves 描述俯视示意图要画的机位序列：给 3 到 4 个机位（超过 4 个时相邻机位会挤在一起，位置文本会被截断）。",
        "  order 从 1 起连续递增，position 用文字描述机位在场景中的位置（不需要坐标，尽量简短），shotType 与 movement 描述该机位的取景与运镜。",
        "- 板面空间是固定的，超长文本会被截断成省略号，请从源头写短：storyboard 每格的 action 不超过 30 个汉字，lighting 每条 note 不超过 30 个汉字。",
        "- moodKeywords 是字符串数组，给 4 到 8 个。",
        "- 所有字段都必须存在且非空，不要用 null，不要用占位符。帧里看不到的角色或场景不要编造；素材未覆盖的内容用文字如实说明（例如「素材未覆盖」）。",
        "- 再次强调：只输出 JSON 本体，不要任何解释文字，不要代码围栏。",
    ].join("\n");
}

/** 校验失败的统一出口：抛出带模型原文的中文错误。 */
function fail(raw: string, message: string): never {
    throw new ProductionBoardAnalysisError(message, raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, raw: string, path: string): Record<string, unknown> {
    if (!isRecord(value)) fail(raw, `制作规划板分析缺少必需节或类型不符：${path} 应为对象`);
    return value;
}

function requireArray(value: unknown, raw: string, path: string): unknown[] {
    if (!Array.isArray(value)) fail(raw, `制作规划板分析缺少必需节或类型不符：${path} 应为数组`);
    return value;
}

/** 内容性字符串：必须存在、必须是字符串、trim 后非空；缺失即失败，不编造默认文案。 */
function requireString(source: Record<string, unknown>, key: string, raw: string, path: string): string {
    const value = source[key];
    if (typeof value !== "string" || value.trim() === "") {
        fail(raw, `制作规划板分析缺少必需字段：${path}.${key} 应为非空字符串`);
    }
    return value.trim();
}

function requireFiniteNumber(value: unknown, raw: string, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(raw, `制作规划板分析数字字段非法：${path} 应为有限数`);
    }
    return value;
}

/** 编号字段：缺失（undefined/null）时按数组顺序补 1..N，这是位置信息而非内容，可以补。 */
function readOptionalIndex(value: unknown, fallback: number, raw: string, path: string): number {
    if (value === undefined || value === null) return fallback;
    return requireFiniteNumber(value, raw, path);
}

/**
 * 提取第一个顶层 JSON 对象。
 *
 * 按字符扫描并跟踪「是否在字符串内 / 是否被反斜杠转义 / 括号深度」，
 * 因此字符串里的花括号（例如动作描述里的 "{不要走}"）不会被当成结构括号，
 * 后面的嵌套对象也会被一并包含进来。找不到配平的对象时返回 null。
 */
function extractFirstJsonObject(raw: string): string | null {
    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
        const char = raw[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{") depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) return raw.slice(start, index + 1);
        }
    }
    return null;
}

function toPalette(entry: unknown, raw: string, index: number): BoardPalette | null {
    const path = `shared.palette[${index}]`;
    const record = requireRecord(entry, raw, path);
    const name = requireString(record, "name", raw, path);
    const hex = normalizeBoardHexColor(record.hex);
    // 非法色值丢弃该色块：色块是装饰性内容，丢一个比整块板失败更合理，但不能拿别的颜色顶替。
    if (hex === "") return null;
    return { name, hex };
}

function toCameraMove(entry: unknown, raw: string, index: number): BoardCameraMove {
    const path = `environment.cameraMoves[${index}]`;
    const record = requireRecord(entry, raw, path);
    return {
        order: readOptionalIndex(record.order, index + 1, raw, `${path}.order`),
        position: requireString(record, "position", raw, path),
        shotType: requireString(record, "shotType", raw, path),
        movement: requireString(record, "movement", raw, path),
    };
}

function toCharacter(entry: unknown, raw: string, index: number) {
    const path = `characters[${index}]`;
    const record = requireRecord(entry, raw, path);
    return {
        name: requireString(record, "name", raw, path),
        appearance: requireString(record, "appearance", raw, path),
        costume: requireString(record, "costume", raw, path),
        consistency: requireString(record, "consistency", raw, path),
    };
}

function toShot(entry: unknown, raw: string, index: number): BoardShot {
    const path = `storyboard[${index}]`;
    const record = requireRecord(entry, raw, path);
    const timeSec = requireFiniteNumber(record.timeSec, raw, `${path}.timeSec`);
    // 负时间点在视频里没有对应的帧，挑帧会静默落到首帧上，属于会骗人的输入，直接判失败。
    if (timeSec < 0) fail(raw, `制作规划板分析数字字段非法：${path}.timeSec 不能为负数`);
    return {
        index: readOptionalIndex(record.index, index + 1, raw, `${path}.index`),
        timeSec,
        cameraType: requireString(record, "cameraType", raw, path),
        shotSize: requireString(record, "shotSize", raw, path),
        movement: requireString(record, "movement", raw, path),
        action: requireString(record, "action", raw, path),
    };
}

function toLighting(entry: unknown, raw: string, index: number): BoardLighting {
    const path = `lighting[${index}]`;
    const record = requireRecord(entry, raw, path);
    return {
        name: requireString(record, "name", raw, path),
        timeOfDay: requireString(record, "timeOfDay", raw, path),
        quality: requireString(record, "quality", raw, path),
        note: requireString(record, "note", raw, path),
    };
}

/** 情绪关键词：非数组时降级为空数组；数组里只保留非空字符串。 */
function toMoodKeywords(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}

function toShared(value: unknown, raw: string): ProductionBoardAnalysis["shared"] {
    const record = requireRecord(value, raw, "shared");
    const palette = requireArray(record.palette, raw, "shared.palette")
        .map((entry, index) => toPalette(entry, raw, index))
        .filter((entry): entry is BoardPalette => entry !== null);
    return {
        shotCount: requireFiniteNumber(record.shotCount, raw, "shared.shotCount"),
        palette,
        environment: requireString(record, "environment", raw, "shared"),
        notes: requireString(record, "notes", raw, "shared"),
    };
}

function toEnvironment(value: unknown, raw: string): ProductionBoardAnalysis["environment"] {
    const record = requireRecord(value, raw, "environment");
    return {
        location: requireString(record, "location", raw, "environment"),
        description: requireString(record, "description", raw, "environment"),
        cameraMoves: requireArray(record.cameraMoves, raw, "environment.cameraMoves").map((entry, index) =>
            toCameraMove(entry, raw, index),
        ),
    };
}

function toAudio(value: unknown, raw: string): ProductionBoardAnalysis["audio"] {
    const record = requireRecord(value, raw, "audio");
    return {
        ambient: requireString(record, "ambient", raw, "audio"),
        music: requireString(record, "music", raw, "audio"),
        tone: requireString(record, "tone", raw, "audio"),
    };
}

/**
 * 把模型输出解析为制作规划板分析结果。
 *
 * 宽容定位：自动跳过 JSON 前后的说明文字与 ```json 围栏，取第一个顶层对象。
 * 严格校验：必需节缺失、类型不符、内容性字段为空、timeSec 非有限数，全部抛
 * ProductionBoardAnalysisError，错误对象上带 raw（模型原文），上层据此保留原文并报错。
 */
export function parseProductionBoardAnalysis(raw: string): ProductionBoardAnalysis {
    const jsonText = extractFirstJsonObject(raw);
    if (jsonText === null) {
        fail(raw, "模型输出里找不到 JSON 对象：制作规划板分析要求只返回 JSON");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fail(raw, `模型输出的 JSON 无法解析：${reason}`);
    }
    const source = requireRecord(parsed, raw, "根对象");

    const characters = requireArray(source.characters, raw, "characters").map((entry, index) =>
        toCharacter(entry, raw, index),
    );
    const storyboard = requireArray(source.storyboard, raw, "storyboard").map((entry, index) =>
        toShot(entry, raw, index),
    );
    // 空的 storyboard 意味着这张规划板没有任何分镜，继续往下走只会画出一张空网格，判定为失败。
    if (storyboard.length === 0) fail(raw, "制作规划板分析缺少必需内容：storyboard 不能为空数组");
    const lighting = requireArray(source.lighting, raw, "lighting").map((entry, index) => toLighting(entry, raw, index));

    return {
        title: requireString(source, "title", raw, "根对象"),
        logline: requireString(source, "logline", raw, "根对象"),
        shared: toShared(source.shared, raw),
        characters,
        environment: toEnvironment(source.environment, raw),
        storyboard,
        lighting,
        moodKeywords: toMoodKeywords(source.moodKeywords),
        audio: toAudio(source.audio, raw),
        cinematography: requireString(source, "cinematography", raw, "根对象"),
    };
}
