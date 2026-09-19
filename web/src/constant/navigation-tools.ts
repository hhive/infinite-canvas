import { Boxes, FileText, ImagePlus, Images, Maximize2, Settings2, UserRound, Video } from "lucide-react";

import type { SessionAuthSource } from "@/services/api/session";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "pricing",
        icon: Boxes,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "account",
        icon: UserRound,
    },
    {
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

/**
 * launch 会话来自 Sub2API 菜单跳转，用户中心、Key 管理、余额、兑换在原站都更完整，
 * 在 media 再放一个入口只会造成两处不一致，因此只隐藏入口、不隐藏能力：
 * 该会话直接访问 /account 时仍按无会话降级为登录引导，不做拦截。
 *
 * 导航渲染有多处（顶栏、移动端抽屉），过滤必须收敛在这一个函数里。
 */
export function visibleNavigationTools(authSource: SessionAuthSource | null) {
    return authSource === "launch" ? navigationTools.filter((tool) => tool.slug !== "account") : navigationTools;
}
