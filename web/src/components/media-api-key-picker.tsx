import { useEffect } from "react";
import { Select } from "antd";

import { mediaAPIKeyCapabilityCount, type MediaAPIKey } from "@/services/api/media-api-keys";
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
    const compatibleKeys = keys.filter((key) => mediaAPIKeyCapabilityCount(key, capability) > 0);
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
                options={compatibleKeys.map((key) => ({ value: key.id, label: keyOptionLabel(key, capability) }))}
                onChange={(value) => void select(value, capability)}
                popupMatchSelectWidth={false}
            />
            {error ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
    );
}

/**
 * 文本模式下只显示 Key 身份，不显示图片/视频计数：这两个数字与文本可用性无关，
 * 文本计数本身又是哨兵值（见 mediaAPIKeyCapabilityCount），显示出来会误导用户按图片数量推断文本权限。
 */
function keyOptionLabel(key: MediaAPIKey, capability: MediaCapability) {
    const identity = `${key.name} · ${key.groupName} · ${key.maskedKey}`;
    return capability === "text" ? identity : `${identity} · 图片 ${key.imageModelCount} / 视频 ${key.videoModelCount}`;
}
