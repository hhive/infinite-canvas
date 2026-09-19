/**
 * 只接受站内绝对路径，避免 `redirect` 参数被用作开放跳转。
 *
 * 登录与注册共用：`/account/*` 的登录引导会把当前路径作为 `redirect` 传下去，
 * 两个页面都必须消费它，否则用户注册/登录完会被丢到别处 —— 注册页此前就漏了这一步。
 */
export function safeRedirect(value: string | null) {
    const target = (value ?? "").trim();
    return target.startsWith("/") && !target.startsWith("//") ? target : "/account";
}
