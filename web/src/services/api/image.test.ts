import { afterEach, describe, expect, it, vi } from "vitest";

import { requestImageQuestion } from "@/services/api/image";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

const sameOrigin = window.location.origin;

function textConfig(overrides: Partial<AiConfig> = {}): AiConfig {
    return { ...defaultConfig, model: "gpt-6-astra", channels: [], apiKey: "", baseUrl: sameOrigin, ...overrides };
}

function stubFetch(payload: unknown = { output_text: "反推结果", output: [] }) {
    const fetchMock = vi.fn(async () => ({ ok: true, body: null, json: async () => payload }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function streamingResponse(chunks: string[]) {
    let index = 0;
    return {
        ok: true,
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[index++]) } : { done: true, value: undefined }),
            }),
        },
    };
}

afterEach(() => vi.unstubAllGlobals());

describe("requestImageQuestion same-origin transport", () => {
    it("posts text requests to the same-origin /v1/responses without an empty bearer header", async () => {
        const fetchMock = stubFetch();

        await expect(requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {})).resolves.toBe("反推结果");

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
        expect(url).toBe(`${sameOrigin}/v1/responses`);
        expect(init.headers).toEqual({ "Content-Type": "application/json", Accept: "text/event-stream" });
        expect(init.body).toContain('"model":"gpt-6-astra"');
        expect(init.body).toContain('"stream":true');
        expect(init.body).toContain("描述这张图");
    });

    it("still sends the bearer header when a same-origin API key is configured", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig({ apiKey: "sk-canvas" }), [{ role: "user", content: "描述这张图" }], () => {});

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(init.headers.Authorization).toBe("Bearer sk-canvas");
    });

    it("treats the default channel model as same-origin, like image and video", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig({ baseUrl: "https://api.openai.com", model: "default::gpt-5.5", apiKey: "" }), [{ role: "user", content: "描述这张图" }], () => {});

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(init.headers.Authorization).toBeUndefined();
    });

    it("keeps the aiHeaders transport for cross-origin text requests", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig({ baseUrl: "https://api.example.com", apiKey: "sk-cross" }), [{ role: "user", content: "描述这张图" }], () => {});

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(url).toBe("https://api.example.com/v1/responses");
        expect(init.headers.Authorization).toBe("Bearer sk-cross");
        expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("keeps streaming deltas flowing to onDelta", async () => {
        const onDelta = vi.fn();
        vi.stubGlobal("fetch", vi.fn(async () => streamingResponse(['data: {"type":"response.output_text.delta","delta":"反推"}\n\n', 'data: {"type":"response.output_text.delta","delta":"结果"}\n\n', "data: [DONE]\n\n"])));

        await expect(requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], onDelta)).resolves.toBe("反推结果");
        expect(onDelta.mock.calls.map(([text]) => text)).toEqual(["反推", "反推结果"]);
    });

    it("adds the request-scoped media api key header for a same-origin /responses call", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: 7 });

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(url).toBe(`${sameOrigin}/v1/responses`);
        expect(init.headers["X-Media-Api-Key-Id"]).toBe("7");
    });

    it("keeps the session key when no request-scoped api key id is given", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: undefined });

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(init.headers).not.toHaveProperty("X-Media-Api-Key-Id");
    });

    it("never sends the media api key header to a cross-origin upstream", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig({ baseUrl: "https://api.example.com", apiKey: "sk-cross" }), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: 7 });

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(url).toBe("https://api.example.com/v1/responses");
        expect(init.headers).not.toHaveProperty("X-Media-Api-Key-Id");
    });

    it("ignores an invalid request-scoped api key id", async () => {
        const fetchMock = stubFetch();

        await requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: 0 });
        await requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: 2.5 });
        await requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {}, { apiKeyId: -3 });

        for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, { headers: Record<string, string> }]>) {
            expect(init.headers).not.toHaveProperty("X-Media-Api-Key-Id");
        }
    });

    it("surfaces the upstream error message for a non-2xx same-origin response", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, text: async () => JSON.stringify({ error: { message: "上游不可用" } }) })));

        await expect(requestImageQuestion(textConfig(), [{ role: "user", content: "描述这张图" }], () => {})).rejects.toThrow("上游不可用");
    });
});
