import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";

type AuthShellProps = {
    title: string;
    subtitle: string;
    children: ReactNode;
    /** 卡片底部的次要操作区，例如「去注册」。 */
    footer?: ReactNode;
};

/** 登录 / 注册共用整屏外壳；这两个路由不进顶栏，因此自带返回入口与主题切换。 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);

    return (
        <div className="relative flex min-h-dvh flex-col bg-background text-foreground">
            <header className="flex items-center justify-between px-4 py-4 sm:px-6">
                <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                    <span className="size-5 shrink-0 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    <span className="text-base font-medium">{t("meta.title")}</span>
                </Link>
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="inline-flex size-8 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4" aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            </header>

            <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
                <div className="w-full max-w-md">
                    <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-8">
                        <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{title}</h1>
                        <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>
                        <div className="mt-6">{children}</div>
                        {footer ? <div className="mt-6 border-t border-stone-200 pt-4 text-center text-sm dark:border-stone-800">{footer}</div> : null}
                    </div>
                    <div className="mt-4 text-center">
                        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100">
                            <ArrowLeft className="size-4" />
                            {t("auth.backHome")}
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
