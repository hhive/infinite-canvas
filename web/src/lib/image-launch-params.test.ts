import { describe, expect, it } from "vitest";

import { readImageLaunchParams, resolveImageLaunchAuthentication } from "@/lib/image-launch-params";

describe("image launch params", () => {
    it.each(["apiKey", "apikey"])("imports %s and removes it from the address", (name) => {
        expect(readImageLaunchParams({ pathname: "/", search: `?${name}=sk-test&tab=image`, hash: "#canvas" })).toEqual({ apiKey: "sk-test", sub2apiLaunch: false, cleanUrl: "/?tab=image#canvas" });
    });

    it("rejects legacy base URL imports", () => {
        const result = readImageLaunchParams({ pathname: "/", search: "?baseUrl=https://evil.test/v1&baseurl=https://other.test/v1", hash: "" });
        expect(result).toEqual({ apiKey: "", sub2apiLaunch: false, cleanUrl: "/" });
        expect(result.cleanUrl).not.toContain("evil.test");
    });

    it("marks a Sub2API cookie launch and removes the marker", () => {
        expect(readImageLaunchParams({ pathname: "/", search: "?sub2apiLaunch=1&tab=image", hash: "" })).toEqual({
            apiKey: "",
            sub2apiLaunch: true,
            cleanUrl: "/?tab=image",
        });
    });
});

describe("image launch authentication", () => {
    it("uses the Cookie session and clears a stale persisted key after Sub2API launch", () => {
        expect(resolveImageLaunchAuthentication({ apiKey: "", sub2apiLaunch: true }, "sk-external-stale")).toEqual({
            apiKey: "",
            clearPersistedAPIKeys: true,
        });
    });

    it("keeps explicit URL and manually persisted Bearer keys outside Cookie launch", () => {
        expect(resolveImageLaunchAuthentication({ apiKey: "sk-url", sub2apiLaunch: false }, "sk-manual").apiKey).toBe("sk-url");
        expect(resolveImageLaunchAuthentication({ apiKey: "", sub2apiLaunch: false }, "sk-manual").apiKey).toBe("sk-manual");
    });
});
