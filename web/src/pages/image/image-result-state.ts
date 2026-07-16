import { LOCAL_TASK_DETACH_MESSAGE } from "@/lib/task-detach";

type ImageResultState = {
    status: "pending" | "success" | "failed";
    taskId?: string;
    taskStatus?: string;
    error?: string;
    locallyDetached?: boolean;
};

export function markImageResultLocallyDetached<T extends ImageResultState>(result: T): T & ImageResultState {
    return {
        ...result,
        status: "failed",
        locallyDetached: true,
        error: LOCAL_TASK_DETACH_MESSAGE,
    };
}

export function canRetryImageResult(result: ImageResultState) {
    return !(result.locallyDetached && (result.taskStatus === "queued" || result.taskStatus === "running"));
}
