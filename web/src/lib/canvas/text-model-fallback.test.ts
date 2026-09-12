import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
    buildTextModelAttempts,
    isSwitchableTextModelError,
    MAX_TEXT_FALLBACK_KEYS,
    MAX_TEXT_MODEL_ATTEMPTS,
    MAX_TEXT_TOTAL_ATTEMPTS,
    resolveTextModelCandidates,
    retryTextModelAttempts,
    TextModelFallbackError,
} from "@/lib/canvas/text-model-fallback";

describe("silent fallback module", () => {
    it("切换模型全程静默：纯函数模块不引入 antd message 或 React", () => {
        const source = readFileSync(resolve(process.cwd(), "src/lib/canvas/text-model-fallback.ts"), "utf8");
        expect(source).not.toContain("antd");
        expect(source).not.toMatch(/\bmessage\.(success|error|warning|info|loading|open)\s*\(/);
        expect(source).not.toContain("react");
    });

    it("Key 维度只做请求维度重试：纯函数模块不接触全局会话 Key（无 store、无 select/activate）", () => {
        const source = readFileSync(resolve(process.cwd(), "src/lib/canvas/text-model-fallback.ts"), "utf8");
        expect(source).not.toContain("use-media-api-key-store");
        expect(source).not.toMatch(/\.(select|activate)\s*\(/);
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

describe("buildTextModelAttempts", () => {
    it("先集中试当前会话 Key 的模型候选，再按计数降序换其他 Key（其他 Key 只用首项模型）", () => {
        const attempts = buildTextModelAttempts(["node-model", "catalog-a"], [{ id: 9, textModelCount: 4 }, { id: 3, textModelCount: 12 }], 7);
        expect(attempts).toEqual([
            { model: "node-model" },
            { model: "catalog-a" },
            { apiKeyId: 3, model: "node-model" },
            { apiKeyId: 9, model: "node-model" },
        ]);
    });

    it("其他 Key 按 textModelCount 降序、同值按 id 升序，并且最多取 2 个", () => {
        const keys = [
            { id: 20, textModelCount: 3 },
            { id: 4, textModelCount: 9 },
            { id: 8, textModelCount: 9 },
            { id: 6, textModelCount: 3 },
        ];
        const attempts = buildTextModelAttempts(["m"], keys, 99);
        expect(attempts).toEqual([
            { model: "m" },
            { apiKeyId: 4, model: "m" },
            { apiKeyId: 8, model: "m" },
        ]);
        expect(MAX_TEXT_FALLBACK_KEYS).toBe(2);
    });

    it("跳过没有文本模型的 Key 与当前会话 Key", () => {
        const keys = [
            { id: 7, textModelCount: 10 },
            { id: 5, textModelCount: 0 },
            { id: 6, textModelCount: 2 },
        ];
        expect(buildTextModelAttempts(["m"], keys, 7)).toEqual([
            { model: "m" },
            { apiKeyId: 6, model: "m" },
        ]);
    });

    it("总尝试次数有硬上限 6，超出时优先保留当前会话 Key 的候选", () => {
        const candidates = ["m1", "m2", "m3", "m4", "m5"];
        const attempts = buildTextModelAttempts(candidates, [{ id: 3, textModelCount: 9 }, { id: 4, textModelCount: 8 }], 7);
        expect(MAX_TEXT_TOTAL_ATTEMPTS).toBe(6);
        expect(attempts).toHaveLength(MAX_TEXT_TOTAL_ATTEMPTS);
        expect(attempts.map((item) => item.model)).toEqual(["m1", "m2", "m3", "m4", "m5", "m1"]);
        expect(attempts.at(-1)).toEqual({ apiKeyId: 3, model: "m1" });
    });

    it("候选上限为 4 时，当前会话 Key 4 次加其他 Key 2 次正好用满 6 次", () => {
        const catalog = Array.from({ length: 50 }, (_, index) => `catalog-${index + 1}`);
        const candidates = resolveTextModelCandidates("node-model", catalog);
        const attempts = buildTextModelAttempts(candidates, [{ id: 3, textModelCount: 9 }, { id: 4, textModelCount: 8 }], 7);
        expect(attempts).toHaveLength(6);
        expect(attempts.filter((item) => item.apiKeyId === undefined)).toHaveLength(MAX_TEXT_MODEL_ATTEMPTS);
    });

    it("没有其他可用 Key 时只保留当前会话 Key 的候选", () => {
        expect(buildTextModelAttempts(["m1", "m2"], [], 7)).toEqual([{ model: "m1" }, { model: "m2" }]);
        expect(buildTextModelAttempts(["m1", "m2"], [{ id: 7, textModelCount: 5 }], 7)).toEqual([{ model: "m1" }, { model: "m2" }]);
    });

    it("候选为空时不产生任何尝试（包括其他 Key）", () => {
        expect(buildTextModelAttempts([], [{ id: 3, textModelCount: 9 }], 7)).toEqual([]);
        expect(buildTextModelAttempts(["   "], [{ id: 3, textModelCount: 9 }], 7)).toEqual([]);
    });

    it("不修改传入的 Key 列表（排序不外泄）", () => {
        const keys = [{ id: 9, textModelCount: 1 }, { id: 2, textModelCount: 8 }];
        buildTextModelAttempts(["m"], keys, 7);
        expect(keys.map((key) => key.id)).toEqual([9, 2]);
    });
});

describe("retryTextModelAttempts", () => {
    it("按序列依次尝试并把 apiKeyId 传给调用方，首个成功即停止", async () => {
        const seen: Array<number | undefined> = [];
        const result = await retryTextModelAttempts(
            [
                { model: "m1" },
                { apiKeyId: 3, model: "m1" },
                { apiKeyId: 4, model: "m1" },
            ],
            async (target) => {
                seen.push(target.apiKeyId);
                if (target.apiKeyId === 3) return `ok:${target.apiKeyId}`;
                throw new Error("无可用渠道：请求失败：404");
            },
        );
        expect(result).toBe("ok:3");
        expect(seen).toEqual([undefined, 3]);
    });

    it("不可切换错误立即抛出且不换 Key", async () => {
        const attempt = vi.fn(async () => {
            throw new Error("请求失败：400");
        });
        await expect(retryTextModelAttempts([{ model: "m1" }, { apiKeyId: 3, model: "m1" }], attempt)).rejects.toThrow("请求失败：400");
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("用户取消立即抛出且不换 Key", async () => {
        const attempt = vi.fn(async () => {
            throw new DOMException("Aborted", "AbortError");
        });
        await expect(retryTextModelAttempts([{ model: "m1" }, { apiKeyId: 3, model: "m1" }], attempt)).rejects.toMatchObject({ name: "AbortError" });
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("全部失败时抛出 TextModelFallbackError，attemptedModels 记录已尝试的模型", async () => {
        const attempt = vi.fn(async () => {
            throw new Error("无可用渠道：请求失败：404");
        });
        const error = await retryTextModelAttempts([{ model: "m1" }, { apiKeyId: 3, model: "m1" }, { apiKeyId: 4, model: "m2" }], attempt).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(TextModelFallbackError);
        expect((error as TextModelFallbackError).attemptedModels).toEqual(["m1", "m1", "m2"]);
        expect(attempt).toHaveBeenCalledTimes(3);
    });

    it("序列为空时抛出且不调用尝试函数", async () => {
        const attempt = vi.fn(async () => "ok");
        await expect(retryTextModelAttempts([], attempt)).rejects.toThrow("没有可用的文本模型");
        expect(attempt).not.toHaveBeenCalled();
    });
});
