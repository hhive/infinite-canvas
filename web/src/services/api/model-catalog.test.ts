import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModelCatalog, imagePricingRows } from "@/services/api/model-catalog";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("fetchModelCatalog", () => {
    it("loads the complete per-model API call list", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { enabled: true, fields: [], groups: [{ id: 1, name: "group", models: [{ media_type: "image", display_name: "完整显示名称", model_name: "image-public", name: "image-public", note: "公开模型备注", calls: [{ label: "同步生成", method: "POST", path: "/v1/images/generations", example: "curl ...", auth: "Bearer" }, { label: "查询图片任务", method: "GET", path: "/v1/images/tasks/{task_id}", example: "curl ...", auth: "Bearer" }] }] }] } });
        const catalog = await fetchModelCatalog();
        expect(catalog.groups[0].models[0].calls).toHaveLength(2);
        expect(catalog.groups[0].models[0].calls[1].path).toBe("/v1/images/tasks/{task_id}");
        expect(catalog.groups[0].models[0]).toMatchObject({ display_name: "完整显示名称", model_name: "image-public", note: "公开模型备注" });
        expect(axios.get).toHaveBeenCalledWith("/api/models/catalog", { signal: undefined });
    });
});

describe("imagePricingRows", () => {
    it("returns only supported size and quality tiers", () => {
        expect(imagePricingRows({ media_type: "image", name: "gpt-image-2", sizes: ["1k", "2k", "4k"], qualities: ["low", "medium", "high"], price_1k: 0.03, price_2k: 0.07, price_4k: 0.1, price_low: 0.03, price_medium: 0.07, price_high: 0.1, calls: [] })).toEqual([
            { label: "1K", price: 0.03 }, { label: "2K", price: 0.07 }, { label: "4K", price: 0.1 },
            { label: "低", price: 0.03 }, { label: "中", price: 0.07 }, { label: "高", price: 0.1 },
        ]);
        expect(imagePricingRows({ media_type: "image", name: "gpt-image-2", sizes: ["1k"], qualities: ["low"], price_1k: 0.03, price_2k: 0.07, price_4k: 0.1, price_low: 0.03, price_medium: 0.07, price_high: 0.1, calls: [] })).toEqual([{ label: "1K", price: 0.03 }, { label: "低", price: 0.03 }]);
    });
});
