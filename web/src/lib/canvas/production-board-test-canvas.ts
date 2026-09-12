// 仅测试使用的 Canvas 2D 记录器。
//
// jsdom 没有真实 canvas，绘制层又必须被验证（画了什么、顺序、关键文案），
// 因此用一个 Proxy 记录所有方法调用与属性写入，并按当前 ctx.font 给出像素宽度估算，
// 让换行与分区计算在测试里得到与真实环境相近的输入。
import { isCjkChar, type MeasureTextFn } from "@/lib/canvas/production-board-text";

export type RecordedCanvasCall = { method: string; args: unknown[] };

export type RecordedStyleSet = { key: string; value: unknown };

export type RecordingCanvasContext = {
    ctx: CanvasRenderingContext2D;
    calls: RecordedCanvasCall[];
    state: Record<string, unknown>;
    /** 按顺序记录所有属性写入，用于断言「用某个颜色画过东西」。 */
    setLog: RecordedStyleSet[];
    /** 按调用顺序取出所有绘制出来的文字。 */
    fillTexts: () => string[];
    /** 全部调用过的方法名。 */
    methodNames: () => string[];
    countOf: (method: string) => number;
    /** 所有绘制文字拼成的串，便于做「包含某段文案」的断言。 */
    allText: () => string;
    /** 某个样式值是否被设置过。 */
    usedStyle: (value: string) => boolean;
};

/** 缺省度量：中日韩字符按 1em，其余按 0.55em，字号取自当前 ctx.font。 */
export function measureWithFont(text: string, font: string): number {
    const size = Number(/(\d+(?:\.\d+)?)\s*px/.exec(font)?.[1] ?? 16);
    let units = 0;
    for (const char of text) units += isCjkChar(char) ? 1 : 0.55;
    return units * size;
}

export function createRecordingCanvasContext(options: { measure?: MeasureTextFn } = {}): RecordingCanvasContext {
    const calls: RecordedCanvasCall[] = [];
    const state: Record<string, unknown> = {};
    const setLog: RecordedStyleSet[] = [];
    const measure = options.measure ?? ((text: string) => measureWithFont(text, String(state.font ?? "")));

    const target: Record<string, unknown> = {
        measureText: (text: string) => ({ width: measure(String(text)) }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        canvas: { width: 0, height: 0 },
    };

    const ctx = new Proxy(target, {
        get(object, property) {
            if (typeof property !== "string") return (object as Record<PropertyKey, unknown>)[property];
            if (property in object) return object[property];
            if (property in state) return state[property];
            return (...args: unknown[]) => {
                calls.push({ method: property, args });
            };
        },
        set(_object, property, value) {
            if (typeof property === "string") {
                state[property] = value;
                setLog.push({ key: property, value });
            }
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;

    return {
        ctx,
        calls,
        state,
        setLog,
        fillTexts: () => calls.filter((call) => call.method === "fillText").map((call) => String(call.args[0])),
        methodNames: () => calls.map((call) => call.method),
        countOf: (method: string) => calls.filter((call) => call.method === method).length,
        allText: () =>
            calls
                .filter((call) => call.method === "fillText")
                .map((call) => String(call.args[0]))
                .join("\n"),
        usedStyle: (value: string) => setLog.some((entry) => entry.value === value),
    };
}
