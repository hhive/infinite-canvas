import { describe, expect, it } from "vitest";

import { shouldInitializeClientRoot } from "@/components/layout/client-root-init";

describe("shouldInitializeClientRoot", () => {
    it("does not initialize API key prompts on the public model marketplace", () => {
        expect(shouldInitializeClientRoot("/models")).toBe(false);
        expect(shouldInitializeClientRoot("/")).toBe(true);
        expect(shouldInitializeClientRoot("/image")).toBe(true);
    });
});
