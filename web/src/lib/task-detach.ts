export const LOCAL_TASK_DETACH_MESSAGE = "已停止本地等待，任务仍在后台运行。刷新页面后可恢复查询。";

export function isCurrentTaskRequest<T extends { controller: AbortController }>(requests: Map<string, T>, targetId: string, controller: AbortController) {
    return requests.get(targetId)?.controller === controller;
}

export function recordTaskIdIfCurrent<T extends { controller: AbortController; taskId?: string }>(requests: Map<string, T>, targetId: string, controller: AbortController, taskId: string) {
    const request = requests.get(targetId);
    if (!request || request.controller !== controller) return false;
    request.taskId = taskId;
    return true;
}

export function detachTaskRequest<T extends { controller: AbortController; taskId?: string }>(requests: Map<string, T>, targetId: string) {
    const request = requests.get(targetId);
    if (!request) return undefined;
    request.controller.abort();
    requests.delete(targetId);
    return request.taskId;
}

export function detachTaskBatch<T extends { controller: AbortController; runningNodeId: string }>(requests: Map<string, T>, runningNodeId: string) {
    const targetIds = [...requests.entries()]
        .filter(([, request]) => request.runningNodeId === runningNodeId)
        .map(([targetId]) => targetId);
    targetIds.forEach((targetId) => detachTaskRequest(requests, targetId));
    return targetIds;
}
