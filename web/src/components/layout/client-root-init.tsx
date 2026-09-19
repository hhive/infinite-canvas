import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { createModelChannel, modelOptionsFromChannels, normalizeChannelModels, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { fetchChannelModels, probeImageSession } from "@/services/api/image";
import { fetchMediaModels, type MediaCapability } from "@/services/api/media-models";
import { readImageLaunchParams, resolveImageLaunchAuthentication } from "@/lib/image-launch-params";
import { currentMediaModelRequestEpoch, isMediaModelRequestEpochCurrent } from "@/stores/use-media-api-key-store";
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
                    await ensureSessionLoaded().catch(() => undefined);
                    const hasSession = useSessionStore.getState().authSource !== null;
                    if (shouldAutoOpenConfigDialog(ready, authenticationKey, hasSession)) openConfigDialog(false);
                    return;
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
    }, [applyMediaModels, clearAPIKeys, config.channels, importChannelCredentials, message, openConfigDialog, setCookieSessionReady, setMediaModelsError, setMediaModelsLoading, t, updateConfig]);

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
 * 探测失败时是否自动弹「配置模型渠道」对话框。
 *
 * 探测失败（`/api/me` 返回 401/403，见 `probeImageSession`）只说明「当前没有可用凭据」，
 * 无凭据的匿名访客本就处于这个状态，首访即弹一个渠道配置框是打扰而非帮助。
 *
 * 只有**存在凭据上下文却仍然失败**时，弹框才是有效提示：
 *   - 用户显式提供过 Key（URL 参数或已保存的渠道 Key）→ 告诉他这把 Key 不可用；
 *   - 或存在媒体会话（launch / password）→ 会话可能已失效，需要重配。
 */
export function shouldAutoOpenConfigDialog(probeReady: boolean, authenticationKey: string, hasSession: boolean): boolean {
    return !probeReady && (authenticationKey.trim() !== "" || hasSession);
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
