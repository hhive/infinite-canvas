import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { apiErrorStatus, apiErrorMessage } from "@/services/api/request";
import { refreshSession } from "@/stores/use-session-store";

/**
 * 用户中心页面共用的加载状态机：loading / error / 重试。
 * loader 每次渲染都会重建，因此只作为 ref 读取，重新加载由 deps 与 retryKey 触发。
 */
export function useAccountResource<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []) {
    const { t } = useTranslation();
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [retryKey, setRetryKey] = useState(0);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        loaderRef
            .current(controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) setData(value);
            })
            .catch((cause) => {
                if (controller.signal.aborted) return;
                setError(apiErrorMessage(cause, t("account.loadFailed"), t("common.networkError")));
                // 上游会话失效会被服务端清掉，此时页面必须重新判定会话并降级为登录引导，
                // 否则用户只会看到一片「加载失败」。
                if (apiErrorStatus(cause) === 401) void refreshSession();
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, retryKey]);

    return { data, error, loading, reload: useCallback(() => setRetryKey((value) => value + 1), []) };
}
