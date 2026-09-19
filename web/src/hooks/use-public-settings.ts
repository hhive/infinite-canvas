import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { apiErrorMessage } from "@/services/api/request";
import { fetchPublicSettings, type PublicSettings } from "@/services/api/public-settings";

/**
 * 登录 / 注册页共用的公开设置读取。设置决定表单长什么样（验证码、注册开关、邀请码），
 * 读不到时不能猜，必须让页面显式进入失败态并允许重试。
 */
export function usePublicSettings() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<PublicSettings | null>(null);
    const [error, setError] = useState("");
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        void fetchPublicSettings(controller.signal)
            .then((value) => setSettings(value))
            .catch((cause) => {
                if (!controller.signal.aborted) setError(apiErrorMessage(cause, t("auth.settingsFailed"), t("common.networkError")));
            });
        return () => controller.abort();
    }, [retryKey, t]);

    const retry = useCallback(() => {
        setSettings(null);
        setError("");
        setRetryKey((value) => value + 1);
    }, []);

    return { settings, error, retry };
}
