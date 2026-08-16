import { useEffect } from "react";
import { Select } from "antd";

import type { MediaCapability } from "@/services/api/media-models";
import { useConfigStore } from "@/stores/use-config-store";
import { useMediaAPIKeyStore } from "@/stores/use-media-api-key-store";

export function MediaAPIKeyPicker({ capability, taskActive, active = true, compact = false }: { capability: MediaCapability; taskActive: boolean; active?: boolean; compact?: boolean }) {
    const config = useConfigStore((state) => state.config);
    const keys = useMediaAPIKeyStore((state) => state.keys);
    const currentKeyId = useMediaAPIKeyStore((state) => state.currentKeyId);
    const status = useMediaAPIKeyStore((state) => state.status);
    const error = useMediaAPIKeyStore((state) => state.error);
    const activate = useMediaAPIKeyStore((state) => state.activate);
    const select = useMediaAPIKeyStore((state) => state.select);
    const manualAPIKey = Boolean(config.apiKey.trim() || config.channels.some((channel) => channel.apiKey.trim()));

    useEffect(() => {
        if (!manualAPIKey) void activate(capability, taskActive, active);
    }, [activate, active, capability, manualAPIKey, taskActive]);

    if (manualAPIKey || status === "idle" || status === "loading" || status === "unavailable") return null;
    const switching = status === "switching";
    const compatibleKeys = keys.filter((key) => modelCount(key, capability) > 0);
    const selectedKeyId = compatibleKeys.some((key) => key.id === currentKeyId) ? currentKeyId : undefined;
    return (
        <div
            className={compact ? "mb-2 min-w-0" : "col-span-2 min-w-0"}
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {!compact ? <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">使用的 API Key</span> : null}
            <Select
                className="w-full min-w-0"
                value={selectedKeyId}
                loading={switching}
                disabled={!compatibleKeys.length || switching || taskActive || !active}
                placeholder={compatibleKeys.length ? "选择 API Key" : "暂无当前类型可用 API Key"}
                options={compatibleKeys.map((key) => ({ value: key.id, label: `${key.name} · ${key.groupName} · ${key.maskedKey} · 图片 ${key.imageModelCount} / 视频 ${key.videoModelCount}` }))}
                onChange={(value) => void select(value, capability)}
                popupMatchSelectWidth={false}
            />
            {error ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
    );
}

function modelCount(key: { imageModelCount: number; videoModelCount: number }, capability: MediaCapability) {
    return capability === "image" ? key.imageModelCount : key.videoModelCount;
}
