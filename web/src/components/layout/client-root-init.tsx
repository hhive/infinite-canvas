import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { createModelChannel, modelOptionsFromChannels, normalizeChannelModels, resolveMissingKeyPrompt, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { fetchChannelModels, probeImageSession } from "@/services/api/image";
import { fetchMediaModels, type MediaCapability } from "@/services/api/media-models";
import { readImageLaunchParams, resolveImageLaunchAuthentication } from "@/lib/image-launch-params";
import { currentMediaModelRequestEpoch, ensureMediaAPIKeysLoaded, isMediaModelRequestEpochCurrent, useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";
import { ensureSessionLoaded, useSessionStore } from "@/stores/use-session-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const mediaRequest = useRef(0);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const openCredentialPrompt = useConfigStore((state) => state.openCredentialPrompt);
    const clearAPIKeys = useConfigStore((state) => state.clearAPIKeys);
    const setCookieSessionReady = useConfigStore((state) => state.setCookieSessionReady);
    const applyMediaModels = useConfigStore((state) => state.applyMediaModels);
    const setMediaModelsError = useConfigStore((state) => state.setMediaModelsError);
    const setMediaModelsLoading = useConfigStore((state) => state.setMediaModelsLoading);

    usePromptSourceScheduler();

    useEffect(() => {
        if (!shouldInitializeClientRoot(window.location.pathname)) return;
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const { apiKey, sub2apiLaunch, cleanUrl } = readImageLaunchParams(window.location);
        handledConfigParams.current = true;
        window.history.replaceState(null, "", cleanUrl);
        if (baseUrl && !sub2apiLaunch) {
            const result = importChannelCredentials({ baseUrl, apiKey });
            openConfigDialog(false, "channels");
            if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
            else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
            else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
            else message.error(t("config.importedChannelBaseUrlInvalid"));
            return;
        }
        const firstChannel = config.channels[0];
        const authentication = resolveImageLaunchAuthentication({ apiKey, sub2apiLaunch }, firstChannel?.apiKey || "");
        setCookieSessionReady(false);
        if (authentication.clearPersistedAPIKeys) clearAPIKeys();
        const authenticationKey = authentication.apiKey;
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(sub2apiLaunch ? { apiKey: "" } : apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: t("config.channels.defaultName"), apiKey: authenticationKey })],
        );
        if (apiKey && !sub2apiLaunch) updateConfig("apiKey", apiKey);
        const channel = { ...(firstChannel || createModelChannel({ id: "default", name: t("config.channels.defaultName") })), apiKey: authenticationKey };
        void probeImageSession(authenticationKey)
            .then(async (ready) => {
                setCookieSessionReady(cookieSessionReadiness(ready, authenticationKey));
                if (!ready) {
                    // 只在「有凭据上下文却仍失败」时提示：显式给过的 Key 失效，或媒体会话已失效。
                    // 无凭据的匿名访客不弹框（首访打扰）。ensureSessionLoaded 单次读取且结果被缓存，
                    // 只在失败分支里 await，正常路径不增加延迟。
                    // 只有生成页才在入口自动提示；/config 是配置页本身，不弹。
                    if (shouldPromptOnEntry(window.location.pathname)) {
                        await ensureSessionLoaded().catch(() => undefined);
                        const session = useSessionStore.getState();
                        const kind = configPromptForProbeFailure(authenticationKey, session.authSource !== null, session.hasApiKey);
                        if (kind === "config") openConfigDialog(false);
                        else openCredentialPrompt(kind);
                    }
                    return;
                }
                // 会话可用但没有绑定可用 Key（新建账号的典型状态）：点生成才会失败，入口就引导。
                //
                // 只在**一把 Key 都没有**时提示去创建：Key 必须有「有可用模型的分组」才可能被选中
                // （未分组的 Key 模型数为 0），所以已有 Key 却仍不可用时再劝「去创建」只会让用户
                // 原地打转。那种情况交给工作台自己的选择器提示与导航里的用户配置入口。
                if (!authenticationKey.trim() && shouldPromptOnEntry(window.location.pathname)) {
                    await ensureSessionLoaded().catch(() => undefined);
                    const session = useSessionStore.getState();
                    if (session.authSource !== null && !session.hasApiKey) {
                        await ensureMediaAPIKeysLoaded();
                        if (useMediaAPIKeyStore.getState().status === "empty") openCredentialPrompt("createKey");
                    }
                }
                return fetchChannelModels(channel);
            })
            .then((models) => {
                if (!models) return;
                useConfigStore.setState((state) => ({ config: mergeFetchedChannelModels(state.config, models) }));
                if (apiKey) message.success(t("config.importedDirectConfig"));
            })
            .catch((error) => {
                message.error(error instanceof Error ? error.message : "读取模型失败");
            });
        const requestId = ++mediaRequest.current;
        const requestEpoch = currentMediaModelRequestEpoch();
        for (const capability of ["image", "video"] as MediaCapability[]) {
            setMediaModelsLoading(capability);
            void fetchMediaModels(capability, authenticationKey)
                .then((models) => {
                    if (requestId === mediaRequest.current && isMediaModelRequestEpochCurrent(requestEpoch)) applyMediaModels(capability, models);
                })
                .catch((error) => {
                    if (requestId !== mediaRequest.current || !isMediaModelRequestEpochCurrent(requestEpoch)) return;
                    const status = typeof error === "object" && error && "response" in error ? Number((error as { response?: { status?: number } }).response?.status) : 0;
                    setMediaModelsError(capability, error instanceof Error ? error.message : "读取媒体模型失败", status === 401);
                });
        }
    }, [applyMediaModels, clearAPIKeys, config.channels, importChannelCredentials, message, openConfigDialog, openCredentialPrompt, setCookieSessionReady, setMediaModelsError, setMediaModelsLoading, t, updateConfig]);

    return <>{children}</>;
}

/**
 * 需要执行客户端根初始化的页面：生成页 + 配置页。
 *
 * 用允许名单而不是拒绝名单。此前是「排除 /pricing 与 /account」的拒绝名单，后果是
 * 每新增一个路由都会默认继承初始化（以及其中的自动弹框），`/account` 只能靠事后补例外。
 * 允许名单下新增路由默认不初始化，需要时显式加入。
 *
 * 精确匹配之外还要覆盖子路由：`/canvas/:id`（画布项目页，`router.tsx`）是产品内可达路由
 * （画布列表与项目卡片都会导航过去），硬刷新或直链进入时同样要初始化——否则会话探测、
 * 媒体模型目录与 launch 参数消费会整条丢失。
 *
 * `/config` 必须在名单内：配置面板的模型选项来自 `applyMediaModels` 写入的媒体模型目录，
 * 而该目录只在根初始化里拉取（`fetchMediaModels` 循环在探测链之外，不受自动弹框门限影响）。
 * `/prompts` 不需要：提示词来源由 `usePromptSourceScheduler()` 独立驱动，与模型目录无关。
 * 定价页是纯展示（见 f9a32c3）；用户配置页只做账号操作（API Key、用量、余额、兑换）。
 */
const CLIENT_ROOT_INIT_ROUTES = new Set(["/", "/image", "/video", "/canvas", "/config"]);
// 需初始化页面的子路由前缀。注意段边界：`/canvas/` 不会匹配 `/canvases`。
const CLIENT_ROOT_INIT_PREFIXES = ["/canvas/"];

export function shouldInitializeClientRoot(pathname: string): boolean {
    if (CLIENT_ROOT_INIT_ROUTES.has(pathname)) return true;
    return CLIENT_ROOT_INIT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 入口自动提示（登录提示 / 渠道配置框）只发生在生成页。
 *
 * `/config` 虽然需要初始化（拉媒体模型目录），但它**本身就是配置页**：用户来这儿就是为了
 * 手填 Key 或配渠道，再弹一个「请先登录」既自相矛盾，也违背「不做全局登录墙、手填 Key 可生成」。
 * 因此提示与初始化用两份名单。
 */
const ENTRY_PROMPT_ROUTES = new Set(["/", "/image", "/video", "/canvas"]);

export function shouldPromptOnEntry(pathname: string): boolean {
    if (ENTRY_PROMPT_ROUTES.has(pathname)) return true;
    return CLIENT_ROOT_INIT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 探测失败时给哪一种提示。
 *
 * 探测失败（`/api/me` 返回 401/403，见 `probeImageSession`）说明「当前没有可用凭据」。
 * 具体给什么，交给 `resolveMissingKeyPrompt` 按凭据上下文分诊：
 *   - 手填过 Key 或存在媒体会话 → 渠道配置框（他们的补救路径是修 Key / 进用户中心）；
 *   - 两者都没有（典型是匿名首访）→ **登录提示**，因为 Key 只能由账号提供。
 */
export function configPromptForProbeFailure(authenticationKey: string, hasSession: boolean, hasApiKey: boolean) {
    return resolveMissingKeyPrompt(authenticationKey.trim() !== "", hasSession, hasApiKey);
}

export function cookieSessionReadiness(probeSucceeded: boolean, authenticationKey: string) {
    return probeSucceeded && !authenticationKey.trim();
}

export function mergeFetchedChannelModels(config: AiConfig, fetchedImageModels: string[]): AiConfig {
    const firstChannel = config.channels[0] || createModelChannel({ id: "default" });
    const retainedModels = normalizeChannelModels(firstChannel.models).filter((model) => model.capability !== "image");
    const models = normalizeChannelModels([
        ...retainedModels,
        ...fetchedImageModels.map((name) => ({ name, capability: "image" as const })),
    ]);
    const channels = [{ ...firstChannel, models }, ...config.channels.slice(1)];
    return { ...config, channels, models: modelOptionsFromChannels(channels) };
}
