/**
 * 画布文本模式（图片反推提示词）的候选解析、失败分类与顺序重试。
 *
 * 纯函数模块：不做 IO、不依赖 React、不弹任何提示。文本模型权限由 Sub2API 在调用时校验，
 * 因此这里只按候选顺序尝试，不预先判断某个模型是否真的可用。
 *
 * 重试有两个维度：模型（同一次请求内换模型）与 Key（按请求维度换用其他 Media API Key）。
 * Key 维度只体现在请求头 {@link TextModelAttempt.apiKeyId} 上，绝不切换全局会话 Key——
 * 会话 Key 是全局的，切换会把正在进行的图片/视频请求一起切走。
 */

/** 反推默认模型：仅当它存在于当前 Key 的文本目录时才使用，避免硬写死目录中不存在的模型导致必失败。 */
export const DEFAULT_REVERSE_TEXT_MODEL = "gpt-6-astra";

/**
 * 候选数量上限：节点已选模型 + gpt-6-astra + 目录前 2 项。
 * 必须设上限的原因：文本目录来自 Sub2API 账号 model_mapping 的并集，规模不受本仓库控制；
 * 而无法识别的错误默认按可切换处理（见 isSwitchableTextModelError），一次失败就可能顺序打穿整份目录；
 * 文本节点还支持 count > 1（多条链并行），候选数与目录长度相乘会让用户长时间卡在重试里。
 */
export const MAX_TEXT_MODEL_ATTEMPTS = 4;

/**
 * 候选顺序：节点已选模型 → gpt-6-astra（仅当存在于目录）→ 目录首项 → 目录其余项。
 * 节点已选模型即使不在目录中也排首位：先试用户/节点的选择，失败后再按目录顺序切换。
 * 出口裁剪到 {@link MAX_TEXT_MODEL_ATTEMPTS} 项（裁剪不影响上面的顺序）。
 */
export function resolveTextModelCandidates(selectedModel: string, availableModels: readonly string[] = []): string[] {
    const candidates: string[] = [];
    const push = (value: unknown) => {
        const model = typeof value === "string" ? value.trim() : "";
        if (model && !candidates.includes(model)) candidates.push(model);
    };
    push(selectedModel);
    if (availableModels.some((model) => typeof model === "string" && model.trim() === DEFAULT_REVERSE_TEXT_MODEL)) push(DEFAULT_REVERSE_TEXT_MODEL);
    availableModels.forEach(push);
    return candidates.slice(0, MAX_TEXT_MODEL_ATTEMPTS);
}

/**
 * 其他 Key 的尝试上限。Media 会话 Key 是全局的：用户在图片节点选过 Key 后，文本请求会继承那个
 * 图片分组的 Key，而该分组可能调不动文本模型。这里用请求维度的 Key 重试兜底，但不做组合爆炸：
 * 每个其他 Key 只用模型候选的首项，且其他 Key 的数量有上限（见本常量）。
 */
export const MAX_TEXT_FALLBACK_KEYS = 2;

/**
 * 总尝试次数硬上限。文本节点支持 count > 1（多条链并行），必须在序列长度上封顶，
 * 否则用户会长时间卡在重试里。当前会话 Key 的候选上限为 {@link MAX_TEXT_MODEL_ATTEMPTS}（4），
 * 加上 2 个其他 Key 恰好用满 6 次。
 */
export const MAX_TEXT_TOTAL_ATTEMPTS = 6;

/** 一次尝试：`apiKeyId` 为空表示沿用全局会话 Key；存在时作为请求头传给 Media 代理，不改动会话。 */
export type TextModelAttempt = { apiKeyId?: number; model: string };

/** Key 维度的候选项；`textModelCount` 为该 Key 可见的文本模型数（不可得时为 0）。 */
export type TextModelFallbackKey = { id: number; textModelCount: number };

/**
 * 生成有序的尝试序列：先集中试当前会话 Key 配模型候选，再依次换其他 Key。
 *
 * 顺序：
 * 1. 当前会话 Key（`apiKeyId` 为 undefined）依次试全部模型候选，顺序与上限沿用
 *    {@link resolveTextModelCandidates}。
 * 2. 其他 Key 按 `textModelCount` 降序、同值按 id 升序，跳过 `textModelCount <= 0` 的 Key
 *    与当前会话 Key；每个其他 Key 只用模型候选的首项。
 * 3. 总尝试次数裁剪到 {@link MAX_TEXT_TOTAL_ATTEMPTS}。
 *
 * 纯函数：只读传入的 Key 快照，不做 IO、不改全局会话 Key（调用方不得在此切换会话）。
 */
export function buildTextModelAttempts(candidates: readonly string[], otherKeys: readonly TextModelFallbackKey[] = [], currentKeyId?: number | null): TextModelAttempt[] {
    const models = candidates.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean);
    if (!models.length) return [];
    const attempts: TextModelAttempt[] = models.map((model) => ({ model }));
    const fallbackKeys = otherKeys
        .filter((key) => Number.isSafeInteger(key.id) && key.id > 0 && key.id !== currentKeyId && Number(key.textModelCount) > 0)
        .sort((left, right) => Number(right.textModelCount) - Number(left.textModelCount) || left.id - right.id)
        .slice(0, MAX_TEXT_FALLBACK_KEYS);
    for (const key of fallbackKeys) attempts.push({ apiKeyId: key.id, model: models[0] });
    return attempts.slice(0, MAX_TEXT_TOTAL_ATTEMPTS);
}

/** 可切换的 HTTP 状态：鉴权失效、模型/接口不存在、限流、上游 5xx。 */
const SWITCHABLE_STATUSES = new Set([401, 403, 404, 429]);
/** 不可切换的 HTTP 状态：请求本身有问题（参数错误），换模型也不会成功。 */
const REQUEST_ERROR_STATUSES = new Set([400, 422]);

/** 可切换的文本线索：模型不可用、限流、网络与超时。 */
const SWITCHABLE_MESSAGE_HINTS = [
    "鉴权失败",
    "限流",
    "额度不足",
    "无可用渠道",
    "模型不存在",
    "model not found",
    "does not exist",
    "unsupported model",
    "network",
    "failed to fetch",
    "econnrefused",
    "econnreset",
    "socket hang up",
    "timeout",
    "超时",
    "网络",
];

/** 不可切换的文本线索：请求参数错误，换模型无意义。 */
const REQUEST_ERROR_MESSAGE_HINTS = ["invalid_request_error", "invalid request", "unsupported parameter", "invalid parameter", "参数错误", "缺少必要参数"];

/** 用户主动取消的线索：换模型无意义，也不应被当成模型故障。 */
const CANCELED_MESSAGE_HINTS = ["请求已取消", "request canceled", "request cancelled", "canceled", "cancelled"];

/**
 * 该错误是否值得换下一个候选模型重试。
 * 可切换：HTTP 401/403/404、模型不存在、429、5xx、网络错误与超时。
 * 不可切换：HTTP 400/422 参数错误、用户主动取消。
 * 无法识别时按可切换处理：上游常见的「无可用渠道」类文案没有固定形状，全部候选失败时统一抛出，不会静默成功。
 */
export function isSwitchableTextModelError(error: unknown): boolean {
    if (error === undefined || error === null) return false;
    if (isCanceledError(error)) return false;
    const message = errorMessage(error).toLowerCase();
    const status = readStatus(error) ?? readStatusFromMessage(message);
    if (status !== undefined) {
        if (REQUEST_ERROR_STATUSES.has(status)) return false;
        if (SWITCHABLE_STATUSES.has(status) || status >= 500) return true;
        return false;
    }
    if (REQUEST_ERROR_MESSAGE_HINTS.some((hint) => message.includes(hint))) return false;
    if (SWITCHABLE_MESSAGE_HINTS.some((hint) => message.includes(hint))) return true;
    return true;
}

/** 尝试过全部候选仍然失败时抛出的错误，携带已尝试的模型列表。 */
export class TextModelFallbackError extends Error {
    readonly attemptedModels: readonly string[];

    constructor(attemptedModels: readonly string[], cause?: unknown) {
        super(fallbackErrorMessage(attemptedModels, cause));
        this.name = "TextModelFallbackError";
        this.attemptedModels = [...attemptedModels];
    }
}

/**
 * 按 {@link buildTextModelAttempts} 生成的序列尝试，返回首个成功结果。
 * 可切换错误继续下一个尝试（含换 Key）；不可切换错误（参数错误、用户取消）立即抛出；
 * 全部失败时抛出 {@link TextModelFallbackError}，其 attemptedModels 按尝试顺序记录实际试过的模型。
 */
export async function retryTextModelAttempts<T>(attempts: readonly TextModelAttempt[], attempt: (target: TextModelAttempt) => Promise<T>): Promise<T> {
    return runTextModelAttempts(attempts, attempt, (target) => target.model);
}

async function runTextModelAttempts<T, Target>(targets: readonly Target[], attempt: (target: Target) => Promise<T>, modelOf: (target: Target) => string): Promise<T> {
    const attemptedModels: string[] = [];
    let lastError: unknown;
    for (const target of targets) {
        attemptedModels.push(modelOf(target));
        try {
            return await attempt(target);
        } catch (error) {
            if (!isSwitchableTextModelError(error)) throw error;
            lastError = error;
        }
    }
    throw new TextModelFallbackError(attemptedModels, lastError);
}

function fallbackErrorMessage(attemptedModels: readonly string[], cause: unknown): string {
    if (!attemptedModels.length) return "没有可用的文本模型";
    const reason = errorMessage(cause) || "请求失败";
    return attemptedModels.length > 1 ? `${reason}（已尝试模型：${attemptedModels.join("、")}）` : reason;
}

function isCanceledError(error: unknown): boolean {
    const name = readField(error, "name");
    // 注意只看 Abort/Cancel：TimeoutError 属于可切换的网络超时，不能当成用户取消。
    if (name === "AbortError" || name === "CanceledError") return true;
    if (readField(error, "code") === "ERR_CANCELED") return true;
    const message = errorMessage(error).toLowerCase();
    return CANCELED_MESSAGE_HINTS.some((hint) => message.includes(hint));
}

function errorMessage(error: unknown): string {
    if (typeof error === "string") return error.trim();
    const message = readField(error, "message");
    return typeof message === "string" ? message.trim() : "";
}

/** 从错误对象上读取 HTTP 状态：fetch 包装错误、axios 错误与带 status 的自定义错误都能覆盖。 */
function readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;
    const record = error as Record<string, unknown>;
    const response = record.response;
    const nested = response && typeof response === "object" ? (response as Record<string, unknown>).status : undefined;
    for (const value of [record.status, record.statusCode, record.code, nested]) {
        const status = Number(value);
        if (Number.isSafeInteger(status) && status >= 400 && status <= 599) return status;
    }
    return undefined;
}

/** 从错误文案里识别状态码：`请求失败：404`、`接口地址不存在（404）`、`HTTP 502`。 */
function readStatusFromMessage(message: string): number | undefined {
    const patterns = [/[：:]\s*(\d{3})\s*$/, /[（(]\s*(\d{3})\s*[)）]/, /http\s*(\d{3})\b/];
    for (const pattern of patterns) {
        const matched = message.match(pattern);
        const status = matched ? Number(matched[1]) : Number.NaN;
        if (Number.isSafeInteger(status) && status >= 400 && status <= 599) return status;
    }
    return undefined;
}

function readField(error: unknown, key: string): unknown {
    return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}
