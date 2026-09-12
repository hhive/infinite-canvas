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

import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext, videoFrameLabel, videoFrameTruncationNotice, type NodeGenerationContext, type NodeGenerationVideoFrames, type VideoFrameSamplingSummary } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";
import { DEFAULT_VIDEO_REVERSE_FRAME_RATE } from "@/lib/canvas/video-frame-sampling-plan";

function video(id: string, storageKey = `video:${id}`): ReferenceVideo {
    return { id, name: `${id}.mp4`, type: "video/mp4", url: `https://media.test/${id}.mp4`, storageKey };
}

function frame(timestampMs: number, marker = String(timestampMs)) {
    return { dataUrl: `data:image/jpeg;base64,FRAME:${marker}`, timestampMs };
}

/** 抽帧摘要：默认未截断，按需覆盖截断相关字段。 */
function summary(overrides: Partial<VideoFrameSamplingSummary> = {}): VideoFrameSamplingSummary {
    return { frameRate: DEFAULT_VIDEO_REVERSE_FRAME_RATE, durationMs: 10_000, requestedCount: 20, frameCount: 1, truncated: false, ...overrides };
}

/** 抽帧入口的返回形状（摘要 + 帧数组）。 */
function sampled(frames: { dataUrl: string; timestampMs: number }[], overrides: Partial<VideoFrameSamplingSummary> = {}) {
    return { ...summary({ frameCount: frames.length, ...overrides }), frames };
}

function videoFrames(videoId: string, frames: { dataUrl: string; timestampMs: number }[], sampling: VideoFrameSamplingSummary | null = summary({ frameCount: frames.length })): NodeGenerationVideoFrames {
    return { videoId, frames, sampling };
}

function context(overrides: Partial<NodeGenerationContext> = {}): NodeGenerationContext {
    return {
        prompt: "请根据参考视频的关键帧反推提示词",
        referenceImages: [],
        referenceVideos: [],
        referenceAudios: [],
        videoFrames: [],
        videoFrameRate: DEFAULT_VIDEO_REVERSE_FRAME_RATE,
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
        ...overrides,
    };
}

function configNode(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "config-1", type: CanvasNodeType.Config, title: "配置", position: { x: 0, y: 0 }, width: 320, height: 200, metadata };
}

beforeEach(() => {
    sampleVideoFrames.mockReset();
    sampleVideoFrames.mockResolvedValue(sampled([frame(200, "video-default")]));
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

describe("videoFrameTruncationNotice", () => {
    it("说明总时长、按速率算出的需求帧数与实际上限，模型才知道自己看的是稀疏采样", () => {
        expect(videoFrameTruncationNotice(1, { durationMs: 120_000, frameRate: 5, requestedCount: 600, frameCount: 30, truncated: true })).toBe("【参考视频1 共 120.0 秒，按 5 帧/秒需 600 帧，已按上限抽取 30 帧】");
    });

    it("时长与速率按实际值渲染，不写死", () => {
        expect(videoFrameTruncationNotice(2, { durationMs: 61_500, frameRate: 1, requestedCount: 62, frameCount: 30, truncated: true })).toBe("【参考视频2 共 61.5 秒，按 1 帧/秒需 62 帧，已按上限抽取 30 帧】");
    });
});

describe("buildNodeResponseMessages 的视频帧组装", () => {
    it("无图无帧时保持原有纯文本行为", () => {
        expect(buildNodeResponseMessages(context())).toEqual([{ role: "user", content: "请根据参考视频的关键帧反推提示词" }]);
    });

    it("只有视频帧时也走多模态数组，帧前带时间标注", () => {
        const messages = buildNodeResponseMessages(context({ videoFrames: [videoFrames("v1", [frame(200, "a"), frame(5_200, "b")])] }));
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
                videoFrames: [videoFrames("v1", [frame(200, "a")])],
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
                videoFrames: [videoFrames("v1", [frame(200, "a")]), videoFrames("v2", [frame(300, "b")])],
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
                videoFrames: [videoFrames("v1", [], null), videoFrames("v2", [frame(300, "b")])],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频2 第1帧 @0.3 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:b" } },
        ]);
    });

    it("被上限截断时在帧标注之前插入说明，避免模型臆造时间连续性", () => {
        const messages = buildNodeResponseMessages(
            context({
                videoFrames: [videoFrames("v1", [frame(2_000, "a"), frame(30_000, "b")], summary({ durationMs: 120_000, frameRate: 5, requestedCount: 600, frameCount: 30, truncated: true }))],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【参考视频1 共 120.0 秒，按 5 帧/秒需 600 帧，已按上限抽取 30 帧】" },
            { type: "text", text: "【视频1 第1帧 @2.0 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
            { type: "text", text: "【视频1 第2帧 @30.0 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:b" } },
        ]);
    });

    it("未截断时不插入说明，消息里只有帧标注", () => {
        const messages = buildNodeResponseMessages(context({ videoFrames: [videoFrames("v1", [frame(200, "a")])] }));
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频1 第1帧 @0.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
        ]);
    });

    it("多个视频各自独立判断截断，只给被截断的那个加说明", () => {
        const messages = buildNodeResponseMessages(
            context({
                videoFrames: [
                    videoFrames("v1", [frame(200, "a")]),
                    videoFrames("v2", [frame(300, "b")], summary({ durationMs: 200_000, frameRate: 4, requestedCount: 800, frameCount: 30, truncated: true })),
                ],
            }),
        );
        expect(messages[0].content).toEqual([
            { type: "text", text: "请根据参考视频的关键帧反推提示词" },
            { type: "text", text: "【视频1 第1帧 @0.2 s】" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,FRAME:a" } },
            { type: "text", text: "【参考视频2 共 200.0 秒，按 4 帧/秒需 800 帧，已按上限抽取 30 帧】" },
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
        expect(hydrated.videoFrames).toEqual([videoFrames("v1", [frame(200, "video-default")]), videoFrames("v2", [frame(200, "video-default")])]);
    });

    it("把上下文里的抽帧速率传给抽帧入口", async () => {
        await hydrateNodeGenerationContext(context({ referenceVideos: [video("v1"), video("v2")], videoFrameRate: 5 }));

        expect(sampleVideoFrames.mock.calls[0][0]).toMatchObject({ frameRate: 5 });
        expect(sampleVideoFrames.mock.calls[1][0]).toMatchObject({ frameRate: 5 });
    });

    it("上下文缺速率时按缺省速率抽帧", async () => {
        const { videoFrameRate: _omitted, ...withoutRate } = context({ referenceVideos: [video("v1")] });
        await hydrateNodeGenerationContext(withoutRate as NodeGenerationContext);

        expect(sampleVideoFrames.mock.calls[0][0]).toMatchObject({ frameRate: DEFAULT_VIDEO_REVERSE_FRAME_RATE });
    });

    it("抽帧失败时上下文里的截断标志为 null，不会伪造说明", async () => {
        sampleVideoFrames.mockRejectedValue(new Error("该视频编码无法在当前浏览器中解码"));

        const hydrated = await hydrateNodeGenerationContext(context({ referenceVideos: [video("v1")] }));

        expect(hydrated.videoFrames).toEqual([{ videoId: "v1", frames: [], sampling: null }]);
    });

    it("图片 hydrate 与抽帧并行：两边同时挂起也都能启动，互不阻塞", async () => {
        const started: string[] = [];
        let releaseImages: (value: string) => void = () => undefined;
        let releaseVideo: (value: unknown) => void = () => undefined;
        imageToDataUrl.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    started.push("image");
                    releaseImages = resolve;
                }),
        );
        sampleVideoFrames.mockImplementation(
            () =>
                new Promise<unknown>((resolve) => {
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
        releaseVideo(sampled([frame(200, "a")]));
        const hydrated = await pending;

        expect(hydrated.referenceImages[0].dataUrl).toBe("data:image/png;base64,IMG");
        expect(hydrated.videoFrames).toEqual([videoFrames("v1", [frame(200, "a")])]);
    });

    it("单个视频抽帧失败只降级该视频，不让整次生成失败", async () => {
        sampleVideoFrames.mockImplementation(async (input: { source: string }) => {
            if (input.source.includes("v2")) throw new Error("该视频编码无法在当前浏览器中解码");
            return sampled([frame(200, "a")]);
        });

        const hydrated = await hydrateNodeGenerationContext(context({ referenceVideos: [video("v1"), video("v2")] }));

        // 失败视频保留占位（frames 为空），这样帧标注里的视频编号始终与参考视频顺序一致。
        expect(hydrated.videoFrames).toEqual([videoFrames("v1", [frame(200, "a")]), { videoId: "v2", frames: [], sampling: null }]);
    });

    it("没有参考视频时不抽帧", async () => {
        const hydrated = await hydrateNodeGenerationContext(context());
        expect(sampleVideoFrames).not.toHaveBeenCalled();
        expect(hydrated.videoFrames).toEqual([]);
    });
});

describe("buildNodeGenerationContext 的抽帧速率", () => {
    it("纯文本链路的上下文默认不带任何视频帧，速率取缺省值", () => {
        const built = buildNodeGenerationContext("node-1", [], [], "提示词");
        expect(built.videoFrames).toEqual([]);
        expect(built.videoFrameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
    });

    it("从配置节点的 metadata 读取速率，缺失时用缺省值", () => {
        expect(buildNodeGenerationContext("config-1", [configNode({ generationMode: "text" })], [], "提示词").videoFrameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(buildNodeGenerationContext("config-1", [configNode({ generationMode: "text", videoFrameRate: 5 })], [], "提示词").videoFrameRate).toBe(5);
        expect(buildNodeGenerationContext("config-1", [configNode({ generationMode: "text", videoFrameRate: 3.5 })], [], "提示词").videoFrameRate).toBe(3.5);
    });

    it("节点上的非法速率按缺省值收敛，不会把 NaN 带进抽帧", () => {
        expect(buildNodeGenerationContext("config-1", [configNode({ generationMode: "text", videoFrameRate: Number.NaN })], [], "提示词").videoFrameRate).toBe(DEFAULT_VIDEO_REVERSE_FRAME_RATE);
        expect(buildNodeGenerationContext("config-1", [configNode({ generationMode: "text", videoFrameRate: 99 })], [], "提示词").videoFrameRate).toBe(5);
    });

    it("组装模式（composer）也带上速率：有令牌与无令牌两条分支都不漏", () => {
        const withToken = buildNodeGenerationContext("config-1", [configNode({ composerContent: "@[node:v1]", videoFrameRate: 4 })], [], "根据 @[node:v1] 反推");
        expect(withToken.videoFrameRate).toBe(4);

        const withoutToken = buildNodeGenerationContext("config-1", [configNode({ composerContent: "  没有令牌  ", videoFrameRate: 4 })], [], "根据参考视频反推");
        expect(withoutToken.videoFrameRate).toBe(4);
    });
});
