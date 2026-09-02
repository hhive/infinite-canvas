import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { createModelChannel, modelOptionsFromChannels, normalizeChannelModels, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { fetchChannelModels, probeImageSession } from "@/services/api/image";
import { fetchMediaModels, type MediaCapability } from "@/services/api/media-models";
import { readImageLaunchParams, resolveImageLaunchAuthentication } from "@/lib/image-launch-params";
import { currentMediaModelRequestEpoch, isMediaModelRequestEpochCurrent } from "@/stores/use-media-api-key-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const mediaRequest = useRef(0);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
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
        const { apiKey, sub2apiLaunch, cleanUrl } = readImageLaunchParams(window.location);
        handledConfigParams.current = true;
        window.history.replaceState(null, "", cleanUrl);
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
            .then((ready) => {
                setCookieSessionReady(cookieSessionReadiness(ready, authenticationKey));
                if (!ready) {
                    openConfigDialog(false);
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
    }, [applyMediaModels, clearAPIKeys, config.channels, message, openConfigDialog, setCookieSessionReady, setMediaModelsError, setMediaModelsLoading, t, updateConfig]);

    return <>{children}</>;
}

export function shouldInitializeClientRoot(pathname: string): boolean {
    return pathname !== "/pricing";
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
