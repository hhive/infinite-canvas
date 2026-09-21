import { Boxes, FileText, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";

/**
 * 左侧导航表。用户中心不在这里 —— 它是顶栏右侧操作簇（UserStatusActions）的入口，
 * launch 会话的隐藏逻辑也收敛在那个组件里，见 components/layout/user-status-actions.tsx。
 */
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
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
