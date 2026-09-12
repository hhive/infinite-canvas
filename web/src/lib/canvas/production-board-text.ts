// 制作规划板的文字换行与截断工具。
//
// Canvas 2D 没有自动换行，板面又大量是中英混排的短标签，因此断行规则必须自己实现：
// 中文按字断（汉字之间可任意换行），英文按词断（不得把单词劈成两半），
// 单个词本身就超宽时再按字符硬拆。度量通过回调注入，便于脱离真实 Canvas 测试。

/** 度量回调：返回文本在目标字号下的像素宽度。 */
export type MeasureTextFn = (text: string) => number;

/** 截断省略号；用单个码位，宽度可预测。 */
export const TEXT_ELLIPSIS = "…";

/** 折行 token：一个英文词或一个汉字，以及它前面是否需要一个空格。 */
export type WrapToken = { value: string; spaceBefore: boolean };

// 中日韩字符区间：CJK 标点、假名、扩展 A、基本区、兼容区、全角形式。
const CJK_RANGES: readonly (readonly [number, number])[] = [
    [0x3000, 0x303f],
    [0x3040, 0x30ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
    [0xff01, 0xff60],
    [0xffe0, 0xffe6],
];

/** 是否是中日韩字符（含全角标点）：是则可逐字断行，否则按词断行。 */
export function isCjkChar(char: string): boolean {
    if (!char) return false;
    const code = char.codePointAt(0)!;
    return CJK_RANGES.some(([start, end]) => code >= start && code <= end);
}

/**
 * 把文本切成折行 token。
 * 空白只作为分隔符：记在后一个 token 的 spaceBefore 上，不产生独立 token，
 * 因此行首不会出现悬挂空格，连续空格也会折叠成一个。
 *
 * 汉字前的**显式**空格要保留：模型输出里「第 1 段」「冷硬 · 高窗」这类中英夹排很常见，
 * 按「汉字之间不需要空格」一刀切会把它们粘成「第 1段」「冷硬 ·高窗」。
 * 但原文本没有空格时也绝不凭空加一个（「hello世界」保持原样）。
 */
export function tokenizeForWrap(text: string): WrapToken[] {
    const tokens: WrapToken[] = [];
    let word = "";
    let pendingSpace = false;
    let hasToken = false;

    const flushWord = () => {
        if (!word) return;
        tokens.push({ value: word, spaceBefore: hasToken && pendingSpace });
        hasToken = true;
        word = "";
        pendingSpace = false;
    };

    for (const char of text) {
        if (/\s/.test(char)) {
            flushWord();
            pendingSpace = true;
            continue;
        }
        if (isCjkChar(char)) {
            flushWord();
            tokens.push({ value: char, spaceBefore: hasToken && pendingSpace });
            hasToken = true;
            pendingSpace = false;
            continue;
        }
        word += char;
    }
    flushWord();
    return tokens;
}

/**
 * 按最大宽度折行。空串与纯空白返回空数组（调用方据此直接跳过绘制，不留空行）。
 * 最大宽度非正时退化为单行，绝不抛错或死循环。
 */
export function wrapText(text: string, maxWidth: number, measureText: MeasureTextFn): string[] {
    const tokens = tokenizeForWrap(text);
    if (!tokens.length) return [];
    const limit = maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY;

    const lines: string[] = [];
    let current = "";
    for (const token of tokens) {
        const separator = current && token.spaceBefore ? " " : "";
        if (measureText(current + separator + token.value) <= limit) {
            current += separator + token.value;
            continue;
        }
        if (current) {
            lines.push(current);
            current = "";
        }
        if (measureText(token.value) > limit) {
            // 单个词自己就超宽（超长英文、无空格长串）：按字符硬拆，避免整词溢出分区。
            let chunk = "";
            for (const char of token.value) {
                if (chunk && measureText(chunk + char) > limit) {
                    lines.push(chunk);
                    chunk = char;
                } else {
                    chunk += char;
                }
            }
            current = chunk;
        } else {
            current = token.value;
        }
    }
    if (current) lines.push(current);
    return lines;
}

/** 给单行加省略号：从尾部逐字回退直到「头部 + 省略号」不超宽；退无可退时只留省略号。 */
export function ellipsizeLine(text: string, maxWidth: number, measureText: MeasureTextFn): string {
    if (measureText(text) <= maxWidth) return text;
    let head = text;
    while (head.length > 0 && measureText(head + TEXT_ELLIPSIS) > maxWidth) head = head.slice(0, -1);
    return head.replace(/\s+$/, "") + TEXT_ELLIPSIS;
}

/** 单行截断：用于标签、色值这类不允许换行的位置。 */
export function truncateTextToWidth(text: string, maxWidth: number, measureText: MeasureTextFn): string {
    return ellipsizeLine(text, maxWidth, measureText);
}

/**
 * 限制行数：超出行数上限时只保留前 maxLines 行，并**强制**在末行补省略号。
 * 末行本身一定放得下（折行阶段已保证），省略号是为了标示「后面还有内容被裁掉」，
 * 因此不能走「放得下就原样返回」的分支，而要显式挤掉末行末尾字符腾出位置。
 */
export function clampTextLines(lines: string[], maxLines: number, maxWidth: number, measureText: MeasureTextFn): string[] {
    if (maxLines <= 0) return [];
    if (lines.length <= maxLines) return [...lines];
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsizeLine(`${kept[maxLines - 1]}${TEXT_ELLIPSIS}`, maxWidth, measureText);
    return kept;
}

/** 折行 + 截断一步到位：渲染侧每个文本块只需一次调用。 */
export function wrapTextClamped(text: string, maxWidth: number, maxLines: number, measureText: MeasureTextFn): string[] {
    return clampTextLines(wrapText(text, maxWidth, measureText), maxLines, maxWidth, measureText);
}

/**
 * 把 canvas 上下文的 measureText 适配成度量回调（调用方需先设置好 ctx.font）。
 * 只要求返回宽度，因此真实上下文与测试桩都能直接传入。
 */
export function createCanvasMeasureText(ctx: { measureText(text: string): { width: number } }): MeasureTextFn {
    return (text: string) => ctx.measureText(text).width;
}
