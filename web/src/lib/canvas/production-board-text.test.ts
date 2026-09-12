// 制作规划板文字换行工具测试。
//
// 度量回调由测试自己提供，因此断行规则（中文按字、英文按词、超长词硬拆）可以被精确断言，
// 不依赖任何真实 Canvas 实现。
import { describe, expect, it } from "vitest";

import { clampTextLines, createCanvasMeasureText, isCjkChar, TEXT_ELLIPSIS, tokenizeForWrap, truncateTextToWidth, wrapText, wrapTextClamped } from "@/lib/canvas/production-board-text";

/** 测试用中日韩字符判定，与实现独立书写，避免同源错误。 */
const CJK_TEST_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠￠-￦]/;

/** 测试用度量：中日韩字符 10px，其余 5px。 */
function measure(text: string) {
    let width = 0;
    for (const char of text) width += CJK_TEST_PATTERN.test(char) ? 10 : 5;
    return width;
}

describe("isCjkChar", () => {
    it("中日韩汉字与全角标点判定为真", () => {
        expect(isCjkChar("制")).toBe(true);
        expect(isCjkChar("，")).toBe(true);
        expect(isCjkChar("。")).toBe(true);
        expect(isCjkChar("ア")).toBe(true);
    });

    it("拉丁字母、数字、半角标点判定为假", () => {
        expect(isCjkChar("a")).toBe(false);
        expect(isCjkChar("Z")).toBe(false);
        expect(isCjkChar("7")).toBe(false);
        expect(isCjkChar(",")).toBe(false);
        expect(isCjkChar(" ")).toBe(false);
    });

    it("空串与省略号判定为假", () => {
        expect(isCjkChar("")).toBe(false);
        expect(isCjkChar(TEXT_ELLIPSIS)).toBe(false);
    });
});

describe("tokenizeForWrap", () => {
    it("英文按词切分，词间空格记录在 spaceBefore 上", () => {
        expect(tokenizeForWrap("hello world")).toEqual([
            { value: "hello", spaceBefore: false },
            { value: "world", spaceBefore: true },
        ]);
    });

    it("中文按字切分，字与字之间不插空格", () => {
        expect(tokenizeForWrap("拍摄机位")).toEqual([
            { value: "拍", spaceBefore: false },
            { value: "摄", spaceBefore: false },
            { value: "机", spaceBefore: false },
            { value: "位", spaceBefore: false },
        ]);
    });

    it("中英混排：英文成词、中文成字", () => {
        expect(tokenizeForWrap("hello世界")).toEqual([
            { value: "hello", spaceBefore: false },
            { value: "世", spaceBefore: false },
            { value: "界", spaceBefore: false },
        ]);
    });

    it("前导空格被丢弃，首个词不带空格", () => {
        expect(tokenizeForWrap("   hello")).toEqual([{ value: "hello", spaceBefore: false }]);
    });

    it("连续空格折叠为一次分隔", () => {
        expect(tokenizeForWrap("a   b")).toEqual([
            { value: "a", spaceBefore: false },
            { value: "b", spaceBefore: true },
        ]);
    });

    it("纯空白返回空数组", () => {
        expect(tokenizeForWrap("   ")).toEqual([]);
        expect(tokenizeForWrap("")).toEqual([]);
    });

    it("汉字前的显式空格被保留：模型输出的「第 1 段」不能粘成「第 1段」", () => {
        expect(tokenizeForWrap("hi 世界")).toEqual([
            { value: "hi", spaceBefore: false },
            { value: "世", spaceBefore: true },
            { value: "界", spaceBefore: false },
        ]);
    });

    it("原文没有空格时也不凭空加空格", () => {
        expect(tokenizeForWrap("hello世界")).toEqual([
            { value: "hello", spaceBefore: false },
            { value: "世", spaceBefore: false },
            { value: "界", spaceBefore: false },
        ]);
    });
});

describe("wrapText", () => {
    it("空串与纯空白串返回空数组，避免画出空行", () => {
        expect(wrapText("", 100, measure)).toEqual([]);
        expect(wrapText("    ", 100, measure)).toEqual([]);
    });

    it("中文长串按字断行", () => {
        expect(wrapText("一二三四五六七八九十", 25, measure)).toEqual(["一二", "三四", "五六", "七八", "九十"]);
    });

    it("英文按词断行，不拆开单词", () => {
        expect(wrapText("hello world foo", 60, measure)).toEqual(["hello world", "foo"]);
    });

    it("单个超长单词按字符硬拆，不会整词溢出", () => {
        expect(wrapText("abcdefghij", 25, measure)).toEqual(["abcde", "fghij"]);
    });

    it("中英混排断行", () => {
        expect(wrapText("拍摄 hello 世界", 45, measure)).toEqual(["拍摄", "hello 世", "界"]);
    });

    it("中英夹排里的空格原样保留（板面上大量出现「第 1 段」「冷硬 · 高窗」）", () => {
        expect(wrapText("第 1 段：手持跟拍", 400, measure)).toEqual(["第 1 段：手持跟拍"]);
        expect(wrapText("冷硬 · 高窗侧逆光", 400, measure)).toEqual(["冷硬 · 高窗侧逆光"]);
    });

    it("每一行都不超过最大宽度", () => {
        const lines = wrapText("机位 1 从左侧横移，镜头 hello world 跟随主角穿过雨幕进入室内场景", 120, measure);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(120);
    });

    it("断行不丢字符（纯中文）", () => {
        const source = "俯视示意图用于记录空间关系与机位路径";
        expect(wrapText(source, 70, measure).join("")).toBe(source);
    });

    it("最大宽度非正时退化为单行，不抛错也不死循环", () => {
        expect(wrapText("一二三", 0, measure)).toEqual(["一二三"]);
        expect(wrapText("一二三", -10, measure)).toEqual(["一二三"]);
    });
});

describe("clampTextLines", () => {
    it("未超过行数上限时原样返回", () => {
        expect(clampTextLines(["一", "二"], 3, 100, measure)).toEqual(["一", "二"]);
    });

    it("超过行数上限时截断，并在末行补省略号", () => {
        expect(clampTextLines(["一二", "三四", "五六"], 2, 25, measure)).toEqual(["一二", "三四" + TEXT_ELLIPSIS]);
    });

    it("省略号会挤掉末行末尾字符，保证仍不超宽", () => {
        const clamped = clampTextLines(["一二", "三四"], 1, 22, measure);
        expect(clamped).toEqual(["一" + TEXT_ELLIPSIS]);
        expect(measure(clamped[0])).toBeLessThanOrEqual(22);
    });

    it("行数上限非正时返回空数组", () => {
        expect(clampTextLines(["一", "二"], 0, 100, measure)).toEqual([]);
        expect(clampTextLines(["一", "二"], -1, 100, measure)).toEqual([]);
    });

    it("空数组返回空数组", () => {
        expect(clampTextLines([], 2, 100, measure)).toEqual([]);
    });
});

describe("wrapTextClamped", () => {
    it("折行与截断一步完成，渲染侧只需一次调用", () => {
        expect(wrapTextClamped("一二三四五六七八九十", 25, 2, measure)).toEqual(["一二", "三四" + TEXT_ELLIPSIS]);
    });

    it("内容能放下时不加省略号", () => {
        expect(wrapTextClamped("一二三", 25, 3, measure)).toEqual(["一二", "三"]);
    });

    it("空串返回空数组", () => {
        expect(wrapTextClamped("", 100, 2, measure)).toEqual([]);
    });
});

describe("truncateTextToWidth", () => {
    it("不超宽时原样返回", () => {
        expect(truncateTextToWidth("hello", 100, measure)).toBe("hello");
    });

    it("超宽时截断并补省略号，且不超宽", () => {
        const result = truncateTextToWidth("hello world", 30, measure);
        expect(result).toBe("hello" + TEXT_ELLIPSIS);
        expect(measure(result)).toBeLessThanOrEqual(30);
    });

    it("极窄宽度下至少保留省略号，不抛错", () => {
        const result = truncateTextToWidth("hello world", 3, measure);
        expect(result.endsWith(TEXT_ELLIPSIS)).toBe(true);
    });
});

describe("createCanvasMeasureText", () => {
    it("把 canvas 的 measureText 适配成度量回调", () => {
        const calls: string[] = [];
        const ctx = {
            measureText(text: string) {
                calls.push(text);
                return { width: text.length * 3 };
            },
        };
        const adapter = createCanvasMeasureText(ctx);
        expect(adapter("abcd")).toBe(12);
        expect(calls).toEqual(["abcd"]);
    });
});
