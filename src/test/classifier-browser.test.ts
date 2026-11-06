import { describe, expect, it } from "vitest";
import { classifyLocally } from "@/lib/classifier.browser";

describe("Local image validation", () => {
  it("rejects uploads larger than the existing 15 MB limit before decoding or inference", async () => {
    const oversized = new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    await expect(classifyLocally(oversized)).rejects.toThrow("Image is over 15 MB.");
  });
});