import { create } from "zustand";

import { fetchSessionState, type SessionAuthSource, type SessionUser } from "@/services/api/session";

type SessionStore = {
    authSource: SessionAuthSource | null;
    /** 会话是否已绑定可用 API Key；有账号但没有 Key 的用户需要在入口被引导去创建。 */
    hasApiKey: boolean;
    user: SessionUser | null;
    hasSession: boolean;
    loaded: boolean;
    reload: () => Promise<void>;
    clear: () => void;
};

let loadPromise: Promise<void> | null = null;

/**
 * media 会话状态。无会话（C 模式：未登录 + 手填 API Key）是正常状态而非错误：
 * 401 只把 hasSession 置为 false，不重试、不跳转，页面自行降级为登录引导。
 */
const initialState = {
    authSource: null as SessionAuthSource | null,
    hasApiKey: false,
    user: null as SessionUser | null,
    hasSession: false,
    loaded: false,
};

export const useSessionStore = create<SessionStore>()((set) => ({
    ...initialState,
    reload: async () => {
        loadPromise = null;
        await ensureSessionLoaded();
    },
    clear: () => {
        loadPromise = null;
        set({ ...initialState, loaded: true });
    },
}));

/** 单次读取会话，重复调用复用同一个请求；失败一律按无会话降级。 */
export function ensureSessionLoaded(): Promise<void> {
    if (!loadPromise) {
        loadPromise = fetchSessionState()
            .then((session) => {
                useSessionStore.setState({ authSource: session.authSource, hasApiKey: session.hasApiKey, user: session.user, hasSession: session.authSource !== null || session.user !== null, loaded: true });
            })
            .catch(() => {
                useSessionStore.setState({ ...initialState, loaded: true });
            });
    }
    return loadPromise;
}

/** 会话身份变化（登录 / 登出）后必须重新读取，否则导航过滤仍按旧身份渲染。 */
export async function refreshSession(): Promise<void> {
    await useSessionStore.getState().reload();
}

export function resetSessionStoreForTest() {
    loadPromise = null;
    useSessionStore.setState(initialState);
}
