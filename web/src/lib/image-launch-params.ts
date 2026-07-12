export function readImageLaunchParams(location: Pick<Location, "pathname" | "search" | "hash">) {
    const searchParams = new URLSearchParams(location.search);
    const apiKey = searchParams.get("apiKey") || searchParams.get("apikey") || "";
    const sub2apiLaunch = searchParams.get("sub2apiLaunch") === "1";
    searchParams.delete("baseUrl");
    searchParams.delete("baseurl");
    searchParams.delete("apiKey");
    searchParams.delete("apikey");
    searchParams.delete("sub2apiLaunch");
    return {
        apiKey,
        sub2apiLaunch,
        cleanUrl: `${location.pathname}${searchParams.size ? `?${searchParams}` : ""}${location.hash}`,
    };
}

export function resolveImageLaunchAuthentication(params: { apiKey: string; sub2apiLaunch: boolean }, persistedAPIKey: string) {
    if (params.sub2apiLaunch) return { apiKey: "", clearPersistedAPIKeys: true };
    return { apiKey: params.apiKey || persistedAPIKey, clearPersistedAPIKeys: false };
}
