import type { ReactNode } from "react";
import { Button, Empty } from "antd";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export function AccountPanel({ title, description, extra, children, className }: { title?: ReactNode; description?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn("rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950", className)}>
            {title || extra ? (
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5 dark:border-stone-800">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-100">{title}</h2>
                        {description ? <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{description}</p> : null}
                    </div>
                    {extra}
                </header>
            ) : null}
            <div className="p-5">{children}</div>
        </section>
    );
}

export function AccountStatTile({ label, value, suffix }: { label: string; value: ReactNode; suffix?: string }) {
    return (
        <div className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-stone-950 dark:text-stone-100">
                {value}
                {suffix ? <span className="ml-1 text-xs font-normal text-stone-400">{suffix}</span> : null}
            </div>
        </div>
    );
}

/** 加载失败时的统一失败态：说明原因 + 原地重试，不把失败伪装成空数据。 */
export function AccountErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="py-6 text-center">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error} />
            <Button className="mt-3" onClick={onRetry}>
                {t("account.retry")}
            </Button>
        </div>
    );
}

export function AccountEmptyState({ text }: { text: string }) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} className="py-8" />;
}
