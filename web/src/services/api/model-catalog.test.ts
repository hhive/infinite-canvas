import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModelCatalog } from "@/services/api/model-catalog";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchModelCatalog", () => {
    it("loads the complete per-model API call list", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { enabled: true, fields: [], groups: [{ id: 1, name: "group", models: [{ media_type: "image", name: "image", calls: [{ label: "同步生成", method: "POST", path: "/v1/images/generations", example: "curl ...", auth: "Bearer" }, { label: "查询图片任务", method: "GET", path: "/v1/images/tasks/{task_id}", example: "curl ...", auth: "Bearer" }] }] }] } });
        const catalog = await fetchModelCatalog();
        expect(catalog.groups[0].models[0].calls).toHaveLength(2);
        expect(catalog.groups[0].models[0].calls[1].path).toBe("/v1/images/tasks/{task_id}");
        expect(axios.get).toHaveBeenCalledWith("/api/models/catalog", { signal: undefined });
    });
});
