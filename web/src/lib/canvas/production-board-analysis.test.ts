import { describe, expect, it } from "vitest";

import {
    ProductionBoardAnalysisError,
    buildProductionBoardPrompt,
    parseProductionBoardAnalysis,
} from "@/lib/canvas/production-board-analysis";

/** 一份字段齐全、类型合法的模型输出，测试里按需增删字段构造异常输入。 */
function validPayload(): Record<string, unknown> {
    return {
        title: "秋日归途",
        logline: "一个人在黄昏的稻田里走回家。",
        shared: {
            shotCount: 8,
            palette: [
                { name: "主色", hex: "#1A2B3C" },
                { name: "高光", hex: "#EEDDCC" },
            ],
            environment: "江南稻田，傍晚",
            notes: "手持跟拍为主，保持自然光",
        },
        characters: [{ name: "主角", appearance: "短发，瘦削", costume: "灰色外套", consistency: "全程同一件外套" }],
        environment: {
            location: "田埂",
            description: "狭长田埂，两侧是成熟稻田",
            cameraMoves: [
                { order: 1, position: "场景左后角", shotType: "广角", movement: "静态" },
                { order: 2, position: "主角正前方", shotType: "中景", movement: "跟踪" },
            ],
        },
        storyboard: [
            { index: 1, timeSec: 0.5, cameraType: "低角度手持", shotSize: "广角", movement: "手持", action: "主角走入画面" },
            { index: 2, timeSec: 3.2, cameraType: "过肩", shotSize: "中景", movement: "静态", action: "主角停下脚步" },
        ],
        lighting: [{ name: "黄昏主光", timeOfDay: "傍晚", quality: "柔光", note: "低角度暖调" }],
        moodKeywords: ["宁静", "怀旧"],
        audio: { ambient: "虫鸣", music: "钢琴", tone: "舒缓" },
        cinematography: "以自然光手持为主，弱对比低饱和",
    };
}

/** 捕获解析错误，便于同时断言错误类型与错误上携带的模型原文。 */
function captureParseError(raw: string): ProductionBoardAnalysisError {
    try {
        parseProductionBoardAnalysis(raw);
    } catch (error) {
        if (error instanceof ProductionBoardAnalysisError) return error;
        throw error;
    }
    throw new Error("预期解析失败，但解析成功了");
}

describe("buildProductionBoardPrompt", () => {
    const prompt = buildProductionBoardPrompt();

    it("要求只输出 JSON 且不要解释文字", () => {
        expect(prompt).toContain("只输出");
        expect(prompt).toContain("JSON");
        expect(prompt).toContain("不要");
    });

    it("覆盖全部交付字段名，避免与 schema 漂移", () => {
        for (const field of [
            "title",
            "logline",
            "shared",
            "shotCount",
            "palette",
            "characters",
            "environment",
            "cameraMoves",
            "storyboard",
            "timeSec",
            "cameraType",
            "shotSize",
            "movement",
            "action",
            "lighting",
            "moodKeywords",
            "audio",
            "cinematography",
        ]) {
            expect(prompt).toContain(field);
        }
    });

    it("明确要求 storyboard 每格给时间点，并说明时间来自帧上标注", () => {
        expect(prompt).toContain("timeSec");
        expect(prompt).toContain("秒");
        expect(prompt).toMatch(/时间/);
    });

    it("给出镜头大小与运动方式的词表", () => {
        for (const word of ["广角", "中景", "特写", "微距", "静态", "跟踪", "手持"]) {
            expect(prompt).toContain(word);
        }
    });

    it("约束调色板数量与 hex 格式", () => {
        expect(prompt).toContain("#RRGGBB");
        expect(prompt).toMatch(/4\s*到\s*6|4~6|4-6/);
    });

    it("要求 8 个分镜，并说明渲染按 8 格布局", () => {
        expect(prompt).toContain("8 个镜头");
        expect(prompt).toContain("8 格");
    });

    it("限制每格 action 与每条灯光 note 的字数，从源头避免板面截断", () => {
        expect(prompt).toMatch(/action[^\n]*不超过\s*30\s*个汉字/);
        expect(prompt).toMatch(/note[^\n]*不超过\s*30\s*个汉字/);
    });

    it("限制 cameraMoves 给 3 到 4 个，避免相邻机位挤在一起被截断", () => {
        expect(prompt).toMatch(/cameraMoves[^\n]*3\s*到\s*4\s*个/);
    });
});

describe("parseProductionBoardAnalysis：宽容定位", () => {
    it("解析纯净 JSON", () => {
        const analysis = parseProductionBoardAnalysis(JSON.stringify(validPayload()));
        expect(analysis.title).toBe("秋日归途");
        expect(analysis.storyboard).toHaveLength(2);
        expect(analysis.storyboard[0].timeSec).toBe(0.5);
        expect(analysis.audio.music).toBe("钢琴");
    });

    it("解析 ```json 围栏包裹的 JSON", () => {
        const raw = ["好的，以下是分析结果：", "```json", JSON.stringify(validPayload(), null, 2), "```", "以上。", ""].join("\n");
        const analysis = parseProductionBoardAnalysis(raw);
        expect(analysis.title).toBe("秋日归途");
        expect(analysis.shared.shotCount).toBe(8);
    });

    it("解析前后带说明文字、无围栏的 JSON", () => {
        const raw = `根据你给的抽帧，我整理如下。\n${JSON.stringify(validPayload())}\n希望有帮助，需要调整随时说。`;
        expect(parseProductionBoardAnalysis(raw).logline).toContain("稻田");
    });

    it("字符串里含花括号与转义引号时不会提前截断", () => {
        const payload = validPayload();
        (payload.storyboard as Record<string, unknown>[])[0].action = '主角念出 "{不要走}" 并说 \\"我还在\\"';
        payload.cinematography = "整体像 {胶片} 的质感，构图留白";
        const analysis = parseProductionBoardAnalysis(`说明文字混在前后\n${JSON.stringify(payload)}\n结束`);
        expect(analysis.storyboard[0].action).toBe('主角念出 "{不要走}" 并说 \\"我还在\\"');
        expect(analysis.cinematography).toBe("整体像 {胶片} 的质感，构图留白");
    });

    it("取第一个顶层对象：后面若还有别的 JSON 不影响解析", () => {
        const raw = `${JSON.stringify(validPayload())}\n{"extra":true}`;
        expect(parseProductionBoardAnalysis(raw).title).toBe("秋日归途");
    });

    it("前导说明里出现成对花括号时不猜测：只认第一个对象，解析不了就如实失败", () => {
        // 这里刻意不做「换一个起点再试」的猜测：对着残缺输出反复试探容易把说明文字里的
        // JSON 片段当成结果，静默解析出错误的板面比直接报错更糟。
        const raw = `说明文字 { 不是 JSON } 混在前后\n${JSON.stringify(validPayload())}`;
        expect(() => parseProductionBoardAnalysis(raw)).toThrow("JSON");
    });
});

describe("parseProductionBoardAnalysis：失败必须抛错并携带原文", () => {
    it("没有任何 JSON 对象时抛错", () => {
        const raw = "抱歉，我无法完成这个任务。";
        const error = captureParseError(raw);
        expect(error.message).toContain("JSON");
        expect(error.raw).toBe(raw);
    });

    it("JSON 语法错误时抛错", () => {
        const raw = '{"title": "甲", "logline": }';
        const error = captureParseError(raw);
        expect(error.message).toContain("JSON");
        expect(error.raw).toBe(raw);
    });

    it("缺少必需节时抛错并带上模型原文", () => {
        const payload = validPayload();
        delete payload.storyboard;
        const raw = JSON.stringify(payload);
        const error = captureParseError(raw);
        expect(error).toBeInstanceOf(ProductionBoardAnalysisError);
        expect(error.message).toContain("storyboard");
        expect(error.raw).toBe(raw);
        expect(error.name).toBe("ProductionBoardAnalysisError");
    });

    it("缺少嵌套必需节（shared / environment / audio）时抛错", () => {
        for (const section of ["shared", "environment", "audio"]) {
            const payload = validPayload();
            delete payload[section];
            expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow(section);
        }
    });

    it("storyboard 不是数组时抛错", () => {
        const payload = validPayload();
        payload.storyboard = { index: 1 };
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("storyboard");
    });

    it("storyboard 为空数组时抛错：没有分镜的规划板没有意义", () => {
        const payload = validPayload();
        payload.storyboard = [];
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("storyboard");
    });

    it("timeSec 不是有限数时抛错", () => {
        for (const bad of ["1.5", null, Number.NaN, Number.POSITIVE_INFINITY]) {
            const payload = validPayload();
            (payload.storyboard as Record<string, unknown>[])[0].timeSec = bad;
            expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("timeSec");
        }
    });

    it("timeSec 为负数时抛错：负时间点没有对应的帧", () => {
        const payload = validPayload();
        (payload.storyboard as Record<string, unknown>[])[0].timeSec = -1;
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("timeSec");
    });

    it("内容性字段缺失即失败，绝不编造：逐个清空 storyboard 字段", () => {
        for (const field of ["cameraType", "shotSize", "movement", "action"]) {
            const payload = validPayload();
            delete (payload.storyboard as Record<string, unknown>[])[0][field];
            expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow(field);
        }
    });

    it("内容性字段为空串同样视为缺失", () => {
        const payload = validPayload();
        (payload.storyboard as Record<string, unknown>[])[0].action = "   ";
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("action");
    });

    it("顶层标量字段缺失或类型不符时抛错", () => {
        for (const field of ["title", "logline", "cinematography"]) {
            const payload = validPayload();
            delete payload[field];
            expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow(field);
        }
        const payload = validPayload();
        payload.title = 123;
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("title");
    });

    it("shared.shotCount 非有限数时抛错", () => {
        const payload = validPayload();
        (payload.shared as Record<string, unknown>).shotCount = "8";
        expect(() => parseProductionBoardAnalysis(JSON.stringify(payload))).toThrow("shotCount");
    });

    it("characters 不是数组时抛错，条目缺字段也抛错", () => {
        const badArray = validPayload();
        badArray.characters = { name: "甲" };
        expect(() => parseProductionBoardAnalysis(JSON.stringify(badArray))).toThrow("characters");

        const badEntry = validPayload();
        delete (badEntry.characters as Record<string, unknown>[])[0].costume;
        expect(() => parseProductionBoardAnalysis(JSON.stringify(badEntry))).toThrow("costume");
    });

    it("lighting / cameraMoves 条目缺字段时抛错", () => {
        const badLighting = validPayload();
        delete (badLighting.lighting as Record<string, unknown>[])[0].quality;
        expect(() => parseProductionBoardAnalysis(JSON.stringify(badLighting))).toThrow("quality");

        const badMove = validPayload();
        const environment = badMove.environment as Record<string, unknown>;
        delete (environment.cameraMoves as Record<string, unknown>[])[0].position;
        expect(() => parseProductionBoardAnalysis(JSON.stringify(badMove))).toThrow("position");
    });
});

describe("parseProductionBoardAnalysis：容错但不伪造", () => {
    it("非法 hex 丢弃该色块，合法的归一为大写 #RRGGBB", () => {
        const payload = validPayload();
        (payload.shared as Record<string, unknown>).palette = [
            { name: "三位简写", hex: "#abc" },
            { name: "颜色名", hex: "red" },
            { name: "缺井号", hex: "112233" },
            { name: "透明度", hex: "#11223344" },
            { name: "合法", hex: "#1a2b3c" },
        ];
        const analysis = parseProductionBoardAnalysis(JSON.stringify(payload));
        expect(analysis.shared.palette).toEqual([
            { name: "三位简写", hex: "#AABBCC" },
            { name: "合法", hex: "#1A2B3C" },
        ]);
    });

    it("全部色块非法时调色板为空数组，但不因此判整个分析失败", () => {
        const payload = validPayload();
        (payload.shared as Record<string, unknown>).palette = [{ name: "坏", hex: "not-a-color" }];
        expect(parseProductionBoardAnalysis(JSON.stringify(payload)).shared.palette).toEqual([]);
    });

    it("缺失的编号按数组顺序补 1..N，已给出的编号原样保留", () => {
        const payload = validPayload();
        payload.storyboard = [
            { timeSec: 0.5, cameraType: "甲", shotSize: "广角", movement: "手持", action: "动作一" },
            { index: 7, timeSec: 2.5, cameraType: "乙", shotSize: "中景", movement: "静态", action: "动作二" },
            { timeSec: 5.5, cameraType: "丙", shotSize: "特写", movement: "跟踪", action: "动作三" },
        ];
        const environment = payload.environment as Record<string, unknown>;
        environment.cameraMoves = [
            { position: "左后角", shotType: "广角", movement: "静态" },
            { order: 4, position: "正前方", shotType: "中景", movement: "跟踪" },
            { order: null, position: "侧后方", shotType: "特写", movement: "手持" },
        ];
        const analysis = parseProductionBoardAnalysis(JSON.stringify(payload));
        expect(analysis.storyboard.map((shot) => shot.index)).toEqual([1, 7, 3]);
        expect(analysis.environment.cameraMoves.map((move) => move.order)).toEqual([1, 4, 3]);
    });

    it("字符串字段做 trim，不残留模型顺手加的空格", () => {
        const payload = validPayload();
        payload.title = "  秋日归途  ";
        payload.moodKeywords = ["  宁静  ", "怀旧"];
        const analysis = parseProductionBoardAnalysis(JSON.stringify(payload));
        expect(analysis.title).toBe("秋日归途");
        expect(analysis.moodKeywords).toEqual(["宁静", "怀旧"]);
    });

    it("moodKeywords 非数组时降级为空数组", () => {
        for (const bad of ["宁静、怀旧", { 0: "宁静" }, null, 42]) {
            const payload = validPayload();
            payload.moodKeywords = bad;
            expect(parseProductionBoardAnalysis(JSON.stringify(payload)).moodKeywords).toEqual([]);
        }
    });

    it("moodKeywords 数组里的非字符串与空串条目被剔除", () => {
        const payload = validPayload();
        payload.moodKeywords = ["宁静", 42, null, "  ", "怀旧"];
        expect(parseProductionBoardAnalysis(JSON.stringify(payload)).moodKeywords).toEqual(["宁静", "怀旧"]);
    });

    it("忽略多余字段，只返回契约内的字段", () => {
        const payload = validPayload();
        payload.extraNote = "模型自由发挥";
        (payload.shared as Record<string, unknown>).extra = true;
        const analysis = parseProductionBoardAnalysis(JSON.stringify(payload));
        expect(Object.keys(analysis).sort()).toEqual(
            ["audio", "characters", "cinematography", "environment", "lighting", "logline", "moodKeywords", "shared", "storyboard", "title"].sort(),
        );
        expect((analysis.shared as unknown as Record<string, unknown>).extra).toBeUndefined();
    });
});
