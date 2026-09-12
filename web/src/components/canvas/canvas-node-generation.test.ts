import { beforeEach, describe, expect, it, vi } from "vitest";

const sampleVideoFrames = vi.fn();
const imageToDataUrl = vi.fn();
const resolveMediaUrl = vi.fn();

vi.mock("@/lib/canvas/video-frame-sampling", () => ({
    sampleVideoFrames: (...args: unknown[]) => sampleVideoFrames(...args),
}));

vi.mock("@/services/image-storage", () => ({
    imageToDataUrl: (...args: unknown[]) => imageToDataUrl(...args),
}));

vi.mock("@/services/file-storage", () => ({
    resolveMediaUrl: (...args: unknown[]) => resolveMediaUrl(...args),
}));

import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext, videoFrameLabel, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { ReferenceVideo } from "@/types/media";

function video(id: string, storageKey = `video:${id}`): ReferenceVideo {
    return { id, name: `${id}.mp4`, type: "video/mp4", url: `https://media.test/${id}.mp4`, storageKey };
}

function frame(timestampMs: number, marker = String(timestampMs)) {
    return { dataUrl: `data:image/jpeg;base64,FRAME:${marker}`, timestampMs };
}

function context(overrides: Partial<NodeGenerationContext> = {}): NodeGenerationContext {
    return {
        prompt: "请根据参考视频的关键帧反推提示词",
        referenceImages: [],
        referenceVideos: [],
        referenceAudios: [],
        videoFrames: [],
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
        ...overrides,
    };
}

beforeEach(() => {
    sampleVideoFrames.mockReset();
    sampleVideoFrames.mockResolvedValue([frame(200, "video-default")]);
    imageToDataUrl.mockReset();
    imageToDataUrl.mockImplementation(async (image: { dataUrl?: string }) => image.dataUrl || "data:image/png;base64,HYDRATED");
    resolveMediaUrl.mockReset();
    resolveMediaUrl.mockImplementation(async (storageKey?: string, fallback = "") => (storageKey ? `resolved:${storageKey}` : fallback));
});

describe("videoFrameLabel", () => {
    it("按「视频N 第k帧 @t.t s」标注，时间戳保留一位小数", () => {
        expect(videoFrameLabel(1, 1, 200)).toBe("【视频1 第1帧 @0.2 s】");
        expect(videoFrameLabel(2, 10, 12_400)).toBe("【视频2 第10帧 @12.4 s】");
        expect(videoFrameLabel(3, 2, 0)).toBe("【视频3 第2帧 @0.0 s】");
    });
});

describe("buildNodeResponseMessages 的视频帧组装", () => {
    it("无图无帧时保持原有纯文本行为", () => {
        expect(buildNodeResponseMessages(context())).toEqual([{ role: "user", content: "请根据参考视频的关键帧反推提示词" }]);
    });

    it("只有视频帧时也走多模态数组，帧前带时间标注", () => {
        const messages = buildNodeResponseMessages(context({ videoFrames: [{ videoId: "v1", frames: [frame(200, "a"), frame(5_200, "b")] }] }));
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频1 第1帧 @0.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
            { type: "text", text: "【视频1 第2帧 @5.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:b" } },
        ]);
    });

    it("视频帧追加在 input_image 之后", () => {
        const messages = buildNodeResponseMessages(
            context({
                referenceImages: [{ id: "i1", name: "i1.png", type: "image/png", dataUrl: "data:image/png;base64,IMG" }],
                videoFrames: [{ videoId: "v1", frames: [frame(200, "a")] }],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "image_url", image_url: { url: "data:image/png;base64,IMG" } },
            { type: "text", text: "【视频1 第1帧 @0.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
        ]);
    });

    it("多个视频按参考视频顺序编号，帧序号在各自视频内重新计数", () => {
        const messages = buildNodeResponseMessages(
            context({
                videoFrames: [
                    { videoId: "v1", frames: [frame(200, "a")] },
                    { videoId: "v2", frames: [frame(300, "b")] },
                ],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频1 第1帧 @0.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
            { type: "text", text: "【视频2 第1帧 @0.3 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:b" } },
        ]);
    });

    it("某个视频抽帧失败时只跳过它的帧，编号仍与参考视频顺序对齐", () => {
        const messages = buildNodeResponseMessages(
            context({
                videoFrames: [
                    { videoId: "v1", frames: [] },
                    { videoId: "v2", frames: [frame(300, "b")] },
                ],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频2 第1帧 @0.3 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:b" } },
        ]);
    });
});

describe("hydrateNodeGenerationContext 的抽帧接入", () => {
    it("对每个参考视频抽帧，地址优先用 storageKey 解析", async () => {
        const hydrated = await hydrateNodeGenerationContext(context({ referenceVideos: [video("v1"), video("v2", "")] }));

        expect(sampleVideoFrames).toHaveBeenCalledTimes(2);
        expect(sampleVideoFrames.mock.calls[0][0]).toMatchObject({ source: "resolved:video:v1" });
        expect(sampleVideoFrames.mock.calls[1][0]).toMatchObject({ source: "https://media.test/v2.mp4" });
        expect(hydrated.videoFrames).toEqual([
            { videoId: "v1", frames: [frame(200, "video-default")] },
            { videoId: "v2", frames: [frame(200, "video-default")] },
        ]);
    });

    it("图片 hydrate 与抽帧并行：两边同时挂起也都能启动，互不阻塞", async () => {
        const started: string[] = [];
        let releaseImages: (value: string) => void = () => undefined;
        let releaseVideo: (value: { dataUrl: string; timestampMs: number }[]) => void = () => undefined;
        imageToDataUrl.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    started.push("image");
                    releaseImages = resolve;
                }),
        );
        sampleVideoFrames.mockImplementation(
            () =>
                new Promise<{ dataUrl: string; timestampMs: number }[]>((resolve) => {
                    started.push("video");
                    releaseVideo = resolve;
                }),
        );

        const pending = hydrateNodeGenerationContext(
            context({
                referenceImages: [{ id: "i1", name: "i1.png", type: "image/png", dataUrl: "data:image/png;base64,IMG" }],
                referenceVideos: [video("v1")],
            }),
        );
        // 两边都没有落地，如果实现是「先图片后视频」的串行顺序，抽帧此时永远不会启动。
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(started.sort()).toEqual(["image", "video"]);

        releaseImages("data:image/png;base64,IMG");
        releaseVideo([frame(200, "a")]);
        const hydrated = await pending;

        expect(hydrated.referenceImages[0].dataUrl).toBe("data:image/png;base64,IMG");
        expect(hydrated.videoFrames).toEqual([{ videoId: "v1", frames: [frame(200, "a")] }]);
    });

    it("单个视频抽帧失败只降级该视频，不让整次生成失败", async () => {
        sampleVideoFrames.mockImplementation(async (input: { source: string }) => {
            if (input.source.includes("v2")) throw new Error("该视频编码无法在当前浏览器中解码");
            return [frame(200, "a")];
        });

        const hydrated = await hydrateNodeGenerationContext(context({ referenceVideos: [video("v1"), video("v2")] }));

        // 失败视频保留占位（frames 为空），这样帧标注里的视频编号始终与参考视频顺序一致。
        expect(hydrated.videoFrames).toEqual([
            { videoId: "v1", frames: [frame(200, "a")] },
            { videoId: "v2", frames: [] },
        ]);
    });

    it("没有参考视频时不抽帧", async () => {
        const hydrated = await hydrateNodeGenerationContext(context());
        expect(sampleVideoFrames).not.toHaveBeenCalled();
        expect(hydrated.videoFrames).toEqual([]);
    });
});

describe("buildNodeGenerationContext 的默认值", () => {
    it("纯文本链路的上下文默认不带任何视频帧", () => {
        expect(buildNodeGenerationContext("node-1", [], [], "提示词").videoFrames).toEqual([]);
    });
});
