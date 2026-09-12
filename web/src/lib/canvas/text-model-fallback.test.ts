import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { isSwitchableTextModelError, MAX_TEXT_MODEL_ATTEMPTS, resolveTextModelCandidates, retryTextModelsWithFallback, TextModelFallbackError } from "@/lib/canvas/text-model-fallback";

describe("silent fallback module", () => {
    it("切换模型全程静默：纯函数模块不引入 antd message 或 React", () => {
        const source = readFileSync(resolve(process.cwd(), "src/lib/canvas/text-model-fallback.ts"), "utf8");
        expect(source).not.toContain("antd");
        expect(source).not.toMatch(/\bmessage\.(success|error|warning|info|loading|open)\s*\(/);
        expect(source).not.toContain("react");
    });
});

describe("resolveTextModelCandidates", () => {
    it("按 节点已选模型 → gpt-6-astra → 目录首项 → 目录其余项 的顺序返回去重候选", () => {
        const candidates = resolveTextModelCandidates("node-model", ["first-model", "gpt-6-astra", "node-model", "last-model"]);
        expect(candidates).toEqual(["node-model", "gpt-6-astra", "first-model", "last-model"]);
    });

    it("gpt-6-astra 不在当前 Key 目录时跳过，回退目录首项", () => {
        const candidates = resolveTextModelCandidates("node-model", ["first-model", "second-model"]);
        expect(candidates).toEqual(["node-model", "first-model", "second-model"]);
    });

    it("节点已选模型为空时从 gpt-6-astra 开始", () => {
        expect(resolveTextModelCandidates("", ["first-model", "gpt-6-astra"])).toEqual(["gpt-6-astra", "first-model"]);
    });

    it("节点已选模型不在目录中仍排首位，便于先试后换", () => {
        expect(resolveTextModelCandidates("gpt-6-astra", ["other-model"])).toEqual(["gpt-6-astra", "other-model"]);
    });

    it("目录为空时只返回节点已选模型", () => {
        expect(resolveTextModelCandidates("only-node-model", [])).toEqual(["only-node-model"]);
        expect(resolveTextModelCandidates("", [])).toEqual([]);
    });

    it("忽略空白项并把带空格的名字归一化", () => {
        expect(resolveTextModelCandidates("  node-model  ", ["   ", " gpt-6-astra "])).toEqual(["node-model", "gpt-6-astra"]);
    });

    it("裁剪超大目录：候选数量有上限，不跟随不受控的目录规模", () => {
        const catalog = Array.from({ length: 50 }, (_, index) => `catalog-model-${index + 1}`);
        expect(resolveTextModelCandidates("node-model", catalog)).toHaveLength(MAX_TEXT_MODEL_ATTEMPTS);
        expect(resolveTextModelCandidates("node-model", catalog)).toEqual(["node-model", "catalog-model-1", "catalog-model-2", "catalog-model-3"]);
    });

    it("裁剪后仍保持三级顺序：节点已选模型首位、gpt-6-astra 优先于目录其他项", () => {
        const catalog = Array.from({ length: 50 }, (_, index) => (index === 7 ? "gpt-6-astra" : `catalog-model-${index + 1}`));
        expect(resolveTextModelCandidates("node-model", catalog)).toEqual(["node-model", "gpt-6-astra", "catalog-model-1", "catalog-model-2"]);
        expect(resolveTextModelCandidates("", catalog)).toEqual(["gpt-6-astra", "catalog-model-1", "catalog-model-2", "catalog-model-3"]);
    });
});

describe("isSwitchableTextModelError", () => {
    it.each([401, 403, 404, 429, 500, 502, 503, 504])("HTTP %s 视为可切换", (status) => {
        expect(isSwitchableTextModelError(Object.assign(new Error("请求失败"), { status }))).toBe(true);
        expect(isSwitchableTextModelError(new Error(`请求失败：${status}`))).toBe(true);
    });

    it("HTTP 400 参数错误不可切换", () => {
        expect(isSwitchableTextModelError(Object.assign(new Error("请求失败"), { status: 400 }))).toBe(false);
        expect(isSwitchableTextModelError(new Error("请求失败：400"))).toBe(false);
    });

    it("鉴权失败、限流与模型不存在可切换", () => {
        expect(isSwitchableTextModelError(new Error("鉴权失败，请检查 API Key、套餐权限或模型权限"))).toBe(true);
        expect(isSwitchableTextModelError(new Error("请求被限流或额度不足，请稍后重试"))).toBe(true);
        expect(isSwitchableTextModelError(new Error("当前分组 自营特惠 下对于模型 gpt-6-astra 无可用渠道（distributor）"))).toBe(true);
    });

    it("网络错误与超时可切换", () => {
        expect(isSwitchableTextModelError(new Error("请求失败"))).toBe(true);
        expect(isSwitchableTextModelError(new Error("Failed to fetch"))).toBe(true);
        expect(isSwitchableTextModelError(Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" }))).toBe(true);
        expect(isSwitchableTextModelError(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }))).toBe(true);
    });

    it("未知错误默认继续尝试下一个候选", () => {
        expect(isSwitchableTextModelError(new Error("上游返回了未知错误"))).toBe(true);
    });

    it("没有错误对象时不切换", () => {
        expect(isSwitchableTextModelError(undefined)).toBe(false);
        expect(isSwitchableTextModelError(null)).toBe(false);
    });

    it("用户主动取消不可切换", () => {
        expect(isSwitchableTextModelError(new DOMException("Aborted", "AbortError"))).toBe(false);
        expect(isSwitchableTextModelError(Object.assign(new Error("请求已取消"), { name: "AbortError" }))).toBe(false);
        expect(isSwitchableTextModelError(Object.assign(new Error("canceled"), { name: "CanceledError", code: "ERR_CANCELED" }))).toBe(false);
    });

    it("请求参数错误信息不可切换", () => {
        expect(isSwitchableTextModelError(new Error("Unsupported parameter: 'input_audio'"))).toBe(false);
    });
});

describe("retryTextModelsWithFallback", () => {
    it("首个候选成功时只尝试一次", async () => {
        const attempt = vi.fn(async (model: string) => `ok:${model}`);
        await expect(retryTextModelsWithFallback(["a", "b"], attempt)).resolves.toBe("ok:a");
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("可切换失败时按候选顺序继续，返回首个成功结果", async () => {
        const attempt = vi.fn(async (model: string) => {
            if (model === "c") return `ok:${model}`;
            throw new Error(`模型 ${model} 不可用：请求失败：404`);
        });
        await expect(retryTextModelsWithFallback(["a", "b", "c"], attempt)).resolves.toBe("ok:c");
        expect(attempt.mock.calls.map(([model]) => model)).toEqual(["a", "b", "c"]);
    });

    it("不可切换错误立即抛出且不再尝试后续候选", async () => {
        const attempt = vi.fn(async () => {
            throw new Error("请求失败：400");
        });
        await expect(retryTextModelsWithFallback(["a", "b"], attempt)).rejects.toThrow("请求失败：400");
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("用户取消立即抛出且不再尝试后续候选", async () => {
        const attempt = vi.fn(async () => {
            throw new DOMException("Aborted", "AbortError");
        });
        await expect(retryTextModelsWithFallback(["a", "b"], attempt)).rejects.toMatchObject({ name: "AbortError" });
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("全部候选失败时抛出携带已尝试模型列表的错误", async () => {
        const attempt = vi.fn(async (model: string) => {
            throw new Error(`模型 ${model} 不可用：请求失败：404`);
        });
        const error = await retryTextModelsWithFallback(["a", "b"], attempt).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(TextModelFallbackError);
        expect((error as TextModelFallbackError).attemptedModels).toEqual(["a", "b"]);
        expect((error as Error).message).toContain("a、b");
        expect((error as Error).message).toContain("请求失败：404");
    });

    it("候选为空时抛出且不调用尝试函数", async () => {
        const attempt = vi.fn(async () => "ok");
        await expect(retryTextModelsWithFallback([], attempt)).rejects.toThrow("没有可用的文本模型");
        expect(attempt).not.toHaveBeenCalled();
    });
});
