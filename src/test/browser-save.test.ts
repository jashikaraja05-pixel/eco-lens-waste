import { describe, expect, it } from "vitest";
import { browserSaveSchema, normalizeBrowserReport } from "@/lib/browser-scan-schema";
import { BROWSER_SOURCE } from "@/lib/scan-schema";
import { rowToScan, stats, type ScanRow } from "@/lib/eco-store";

const input = { image: "data:image/png;base64,iVBORw0KGgo=", item: "battery", confidence: 90, requestId: "11111111-1111-4111-8111-111111111111" };
const row = (source: string = BROWSER_SOURCE, provenance = "client-reported"): ScanRow => ({
  id: "saved", item: "battery", category: "hazardous", bin: "Red Bin (Hazardous Waste Depot)", confidence: 90,
  reasoning: "Browser-reported", steps: ["Keep separate"], image: input.image, source, provenance,
  created_at: "2026-11-06T15:01:00Z",
});

describe("Browser save validation and server-owned fields", () => {
  it("stores the exact engine and explicitly client-reported provenance", () => {
    expect(normalizeBrowserReport(browserSaveSchema.parse(input))).toMatchObject({ source: "MobileNetV3-Small (ONNX Browser)", provenance: "client-reported", category: "hazardous", bin: "Red Bin (Hazardous Waste Depot)" });
  });
  it("saves below-55 confidence as uncertain with no bin", () => {
    expect(normalizeBrowserReport({ ...input, confidence: 54 })).toMatchObject({ confidence: 54, category: "uncertain", bin: "No bin — rescan or check local rules" });
  });
  it("keeps a category at exactly 55 confidence", () => {
    expect(normalizeBrowserReport({ ...input, confidence: 55 })).toMatchObject({ confidence: 55, category: "hazardous" });
  });
  for (const field of ["user_id", "source", "provenance", "category", "bin", "steps", "reasoning"]) {
    it(`rejects caller-supplied ${field}`, () => {
      expect(browserSaveSchema.safeParse({ ...input, [field]: "forged" }).success).toBe(false);
    });
  }
  it("rejects unknown labels, invalid scores and non-images", () => {
    for (const confidence of [-1, 101, 55.5, NaN, Infinity, "90"]) expect(browserSaveSchema.safeParse({ ...input, confidence }).success).toBe(false);
    expect(browserSaveSchema.safeParse({ ...input, item: "medicine" }).success).toBe(false);
    expect(browserSaveSchema.safeParse({ ...input, image: "data:text/plain;base64,aGVsbG8=" }).success).toBe(false);
  });
});

describe("Saved browser history and dashboard", () => {
  it("retrieves browser results without relabelling as Gateway and counts them", () => {
    const scan = rowToScan(row());
    expect(scan?.source).toBe("MobileNetV3-Small (ONNX Browser)");
    expect(scan?.confidence).toBe(90);
    if (!scan) throw new Error("Browser scan missing");
    expect(stats([scan])).toMatchObject({ total: 1, hazardous: 1, avgConfidence: 90 });
  });
  it("preserves Gateway and Python sources on existing rows", () => {
    expect(rowToScan(row("gateway", "server-classified"))?.source).toBe("gateway");
    expect(rowToScan(row("python", "server-classified"))?.source).toBe("python");
  });
  it("rejects unknown sources and falsely server-classified browser results", () => {
    expect(rowToScan(row("unknown"))).toBeNull();
    expect(rowToScan(row(BROWSER_SOURCE, "server-classified"))).toBeNull();
  });
});