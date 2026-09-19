import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { useConfigStore } from "@/stores/use-config-store";

/**
 * 「用到 Key 却没有 Key」时的登录提示。
 *
 * 与「配置与用户偏好」（渠道配置框）刻意区分：后者面向要自己接上游渠道的用户，
 * 既没有账号也没有手填 Key 的匿名访客拿到它既看不懂也走不通。这里给的是能立刻执行的
 * 下一步——去登录或注册账号，Key 由账号提供。
 *
 * 由 `useConfigStore.openConfigDialog(true)` 的分诊与生成页入口的探测失败分支共同打开，
 * 与 `AppConfigModal` 一样挂在顶栏，保证任意路由都可用。
 */
export function LoginPromptModal() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const isOpen = useConfigStore((state) => state.isLoginPromptOpen);
    const setLoginPromptOpen = useConfigStore((state) => state.setLoginPromptOpen);
    // 登录后回到当前页，避免用户被丢到用户中心概览。
    const redirectTo = encodeURIComponent(`${pathname}${search}`);

    const close = () => setLoginPromptOpen(false);
    const go = (to: string) => {
        setLoginPromptOpen(false);
        navigate(to);
    };

    return (
        <Modal open={isOpen} onCancel={close} footer={null} width={420} title={t("account.loginRequired")} destroyOnHidden>
            <p className="text-sm text-stone-500 dark:text-stone-400">{t("account.loginRequiredHint")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <Button onClick={close}>{t("account.cancel")}</Button>
                <Button onClick={() => go("/register")}>{t("account.goRegister")}</Button>
                <Button type="primary" onClick={() => go(`/login?redirect=${redirectTo}`)}>
                    {t("account.goLogin")}
                </Button>
            </div>
        </Modal>
    );
}
