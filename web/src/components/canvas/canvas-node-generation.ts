import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { sampleVideoFrames, type SampledVideoFrame, type VideoFrameSamplingSummary } from "@/lib/canvas/video-frame-sampling";
import { resolveFrameRate } from "@/lib/canvas/video-frame-sampling-plan";

export type { VideoFrameSamplingSummary } from "@/lib/canvas/video-frame-sampling";

/** 一个参考视频抽出的帧；抽帧失败的视频保留占位，frames 为空数组、sampling 为 null。 */
export type NodeGenerationVideoFrames = { videoId: string; frames: SampledVideoFrame[]; sampling: VideoFrameSamplingSummary | null };

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    videoFrames: NodeGenerationVideoFrames[];
    /** 抽帧速率（帧/秒），取自配置节点 metadata，缺省 2。 */
    videoFrameRate: number;
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

type NodeGenerationResourceInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

type NodeGenerationGroupInput = {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput = NodeGenerationResourceInput | NodeGenerationGroupInput;

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    // 抽帧速率是「被生成的那个节点」上的设置：视频反推时用户改的是配置节点的文本模式设置。
    const videoFrameRate = resolveFrameRate(sourceNode?.metadata?.videoFrameRate);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt, videoFrameRate);
    }

    const resourceInputs = flattenGenerationInputs(inputs);
    let textIndex = 0;
    const upstreamText = resourceInputs.flatMap((input) => (input.text ? [textBlock(generationLabel("text", textIndex++), input.text)] : [])).join("\n\n");
    const referenceImages = resourceInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = resourceInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = resourceInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        // 抽帧是异步的，放在 hydrateNodeGenerationContext 里补齐；这里只保证结构完整。
        videoFrames: [],
        videoFrameRate,
        textCount: resourceInputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, videoFrameRate: number): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            const labels = flattenGenerationInputs([input]).map((resource) => {
                let label = labelByNodeId.get(resource.nodeId);
                if (!label) {
                    label = generationLabel(resource.type, counts[resource.type]++);
                    labelByNodeId.set(resource.nodeId, label);
                    if (resource.type === "text") textBlocks.push(textBlock(label, resource.text || ""));
                    else selectedInputs.push(resource);
                }
                return resource.type === "text" ? `【${label}】` : label;
            });
            nextPrompt += labels.join("、");
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            videoFrames: [],
            videoFrameRate,
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        videoFrames: [],
        videoFrameRate,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        if (node.type === CanvasNodeType.Group) {
            const children = getGroupResourceNodes(node.id, nodes).flatMap(readNodeGenerationResource);
            return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
        }
        return readNodeGenerationResource(node);
    });
}

function flattenGenerationInputs(inputs: NodeGenerationInput[]) {
    const resources = inputs.flatMap((input) => (input.type === "group" ? input.children : [input]));
    return [...new Map(resources.map((input) => [input.nodeId, input])).values()];
}

function readNodeGenerationResource(node: CanvasNodeData): NodeGenerationResourceInput[] {
    const image = readReferenceImage(node);
    if (image) return [{ nodeId: node.id, type: "image", title: node.title, image }];
    const video = readReferenceVideo(node);
    if (video) return [{ nodeId: node.id, type: "video", title: node.title, video }];
    const audio = readReferenceAudio(node);
    if (audio) return [{ nodeId: node.id, type: "audio", title: node.title, audio }];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if (resource?.kind === "image" && resource.url) return [{ nodeId: node.id, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "video" && resource.url) return [{ nodeId: node.id, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: node.metadata?.mimeType || "video/mp4", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "audio" && resource.url) return [{ nodeId: node.id, type: "audio", title: node.title, audio: { id: node.id, name: `${node.title || node.id}.mp3`, type: node.metadata?.mimeType || "audio/mpeg", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "text" && resource.text) return [{ nodeId: node.id, type: "text", title: node.title, text: resource.text }];
    const text = readNodeTextInput(node);
    return text ? [{ nodeId: node.id, type: "text", title: node.title, text }] : [];
}

/** 视频帧的文本标注，帮助模型把每一帧放回时间轴上。时间戳保留一位小数。 */
export function videoFrameLabel(videoIndex: number, frameIndex: number, timestampMs: number) {
    return `【视频${videoIndex} 第${frameIndex}帧 @${(timestampMs / 1000).toFixed(1)} s】`;
}

/**
 * 抽帧被上限截断时的说明，插在该视频的帧标注之前。
 * 逐帧静态图本身看不出采样密度，模型会把 30 张稀疏帧当成连续时间轴去脑补中间过程，
 * 所以必须明说「总时长 / 按速率本该抽多少帧 / 实际只抽了多少帧」。
 */
export function videoFrameTruncationNotice(videoIndex: number, sampling: VideoFrameSamplingSummary) {
    return `【参考视频${videoIndex} 共 ${(sampling.durationMs / 1000).toFixed(1)} 秒，按 ${sampling.frameRate} 帧/秒需 ${sampling.requestedCount} 帧，已按上限抽取 ${sampling.frameCount} 帧】`;
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    const videoFrameMessages = context.videoFrames.flatMap((video, videoIndex) => [
        // 截断说明只加在被截断的视频上，未截断的视频保持原有「帧标注 + 帧图」的紧凑形式。
        ...(video.sampling?.truncated ? [{ type: "text" as const, text: videoFrameTruncationNotice(videoIndex + 1, video.sampling) }] : []),
        ...video.frames.flatMap((frame, frameIndex) => [
            { type: "text" as const, text: videoFrameLabel(videoIndex + 1, frameIndex + 1, frame.timestampMs) },
            { type: "image_url" as const, image_url: { url: frame.dataUrl } },
        ]),
    ]);
    if (!context.referenceImages.length && !videoFrameMessages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })), ...videoFrameMessages],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    // 先把两个动态依赖一起取回来，图片 hydrate 与视频抽帧才能真正在同一个 tick 里并发启动。
    const [{ imageToDataUrl }, { resolveMediaUrl }] = await Promise.all([import("@/services/image-storage"), import("@/services/file-storage")]);
    const [referenceImages, videoFrames] = await Promise.all([Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))), hydrateVideoFrames(context.referenceVideos, resolveMediaUrl, resolveFrameRate(context.videoFrameRate))]);
    return { ...context, referenceImages, videoFrames };
}

/**
 * 并行抽取参考视频的关键帧。
 * 取舍：单个视频抽帧失败（编码不支持、CORS、地址失效等）只让该视频降级为不附带帧，不能让整次生成失败——
 * 视频反推本来就是增强能力，失败时退回到「只有提示词与图片」的既有链路即可。
 * 失败的视频仍保留占位项，这样帧标注里的「视频N」编号始终与参考视频列表的顺序一致。
 */
async function hydrateVideoFrames(videos: ReferenceVideo[], resolveMediaUrl: (storageKey?: string, fallback?: string) => Promise<string>, frameRate: number): Promise<NodeGenerationVideoFrames[]> {
    if (!videos.length) return [];
    const results = await Promise.allSettled(
        videos.map(async (video): Promise<NodeGenerationVideoFrames> => {
            const { frames, ...sampling } = await sampleVideoFrames({ source: await resolveMediaUrl(video.storageKey, video.url), frameRate });
            return { videoId: video.id, frames, sampling };
        }),
    );
    return results.map((result, index) => (result.status === "fulfilled" ? result.value : { videoId: videos[index].id, frames: [], sampling: null }));
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function textBlock(label: string, text: string) {
    return `【${label}】\n${text}`;
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (type === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
