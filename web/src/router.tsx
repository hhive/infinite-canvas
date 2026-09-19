import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AccountLayout from "@/pages/account/layout";
import AccountOverviewPage from "@/pages/account";
import AccountBalancePage from "@/pages/account/balance";
import AccountKeysPage from "@/pages/account/keys";
import AccountRedeemPage from "@/pages/account/redeem";
import AccountUsagePage from "@/pages/account/usage";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import RegisterPage from "@/pages/register";
import ModelsPage from "@/pages/models";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/pricing", element: <ModelsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            {
                path: "/account",
                element: <AccountLayout />,
                children: [
                    { index: true, element: <AccountOverviewPage /> },
                    { path: "keys", element: <AccountKeysPage /> },
                    { path: "usage", element: <AccountUsagePage /> },
                    { path: "balance", element: <AccountBalancePage /> },
                    { path: "redeem", element: <AccountRedeemPage /> },
                ],
            },
        ],
    },
    // 登录 / 注册是整屏路由，不经过 UserLayout，因此不会出现在顶栏导航里
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "*", element: <NotFound /> },
]);
