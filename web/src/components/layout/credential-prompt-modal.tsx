import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { useConfigStore } from "@/stores/use-config-store";

/**
 * 「用到 Key 却没有可用 Key」时的凭据提示。两种情形共用一套壳，只换文案与动作：
 *
 * - `login`：连账号都没有（匿名首访）。Key 只能由账号提供，所以引导登录 / 注册。
 * - `createKey`：有账号但还没绑定可用 API Key。这类用户点生成才会失败，应在入口就
 *   引导去用户中心创建 / 选择 Key。
 *
 * 与「配置与用户偏好」（渠道配置框）刻意区分：后者面向要自己接上游渠道的用户，
 * 上述两类用户拿到它既看不懂也走不通。
 *
 * 由 `useConfigStore.openConfigDialog(true)` 的分诊与生成页入口共同打开，
 * 与 `AppConfigModal` 一样挂在顶栏，保证任意路由都可用。
 */
export function CredentialPromptModal() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const kind = useConfigStore((state) => state.credentialPrompt);
    const closeCredentialPrompt = useConfigStore((state) => state.closeCredentialPrompt);
    // 登录 / 去建 Key 之后回到当前页，避免用户被丢到别的页面。
    const redirectTo = encodeURIComponent(`${pathname}${search}`);

    const isLogin = kind === "login";
    const close = () => closeCredentialPrompt();
    const go = (to: string) => {
        closeCredentialPrompt();
        navigate(to);
    };

    return (
        <Modal open={kind !== null} onCancel={close} footer={null} width={420} title={t(isLogin ? "account.loginRequired" : "account.keyRequired")} destroyOnHidden>
            <p className="text-sm text-stone-500 dark:text-stone-400">{t(isLogin ? "account.loginRequiredHint" : "account.keyRequiredHint")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <Button onClick={close}>{t("account.cancel")}</Button>
                {isLogin ? (
                    <>
                        <Button onClick={() => go(`/register?redirect=${redirectTo}`)}>{t("account.goRegister")}</Button>
                        <Button type="primary" onClick={() => go(`/login?redirect=${redirectTo}`)}>
                            {t("account.goLogin")}
                        </Button>
                    </>
                ) : (
                    <Button type="primary" onClick={() => go("/account/keys")}>
                        {t("account.goCreateKey")}
                    </Button>
                )}
            </div>
        </Modal>
    );
}
