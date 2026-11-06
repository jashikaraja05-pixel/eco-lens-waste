import { describe, expect, it } from "vitest";
import manifestJson from "../../public/models/mobilenet-v3-small.json";
import { modelManifestSchema, predictionFromLogits } from "@/lib/model-contract";

const manifest = modelManifestSchema.parse(manifestJson);
describe("13 trained classes and bin mapping", () => {
  const cases = [
    [0, "battery", "hazardous", "Red Bin (Hazardous Waste Depot)"],
    [1, "biological", "organic", "Green Bin (Organic / Wet Waste)"],
    [2, "brown-glass", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [3, "cardboard", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [4, "clothes", "residual", "Black Bin (Residual Non-Recyclable Waste)"],
    [5, "e-waste", "ewaste", "Red Bin (Special E-Waste Bin)"],
    [6, "green-glass", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [7, "metal", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [8, "paper", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [9, "plastic", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
    [10, "shoes", "residual", "Black Bin (Residual Non-Recyclable Waste)"],
    [11, "trash", "residual", "Black Bin (Residual Non-Recyclable Waste)"],
    [12, "white-glass", "recyclable", "Blue Bin (Dry Recyclable Waste)"],
  ] as const;
  for (const [index, item, category, bin] of cases) {
    it(`maps model index ${index} (${item}) to ${category}`, () => {
      const logits = Array.from({ length: 13 }, (_, i) => i === index ? 1000 : 0);
      expect(predictionFromLogits(logits, manifest)).toMatchObject({ item, category, bin, confidence: 100, source: "mobilenet-browser", saved: false });
    });
  }
  it("withholds a bin when prediction confidence is below 55%", () => {
    expect(predictionFromLogits(Array(13).fill(0), manifest)).toMatchObject({ confidence: 8, category: "uncertain", bin: "No bin — rescan or check local rules" });
  });
  it("recommends a bin at exactly 55% rounded confidence", () => {
    const probability = 0.55;
    const logits = [Math.log(probability), ...Array(12).fill(Math.log((1 - probability) / 12))];
    expect(predictionFromLogits(logits, manifest)).toMatchObject({ confidence: 55, category: "hazardous" });
  });
  it("rejects invalid output shape and non-finite logits", () => {
    expect(() => predictionFromLogits([1, 2], manifest)).toThrow();
    expect(() => predictionFromLogits(Array(13).fill(NaN), manifest)).toThrow();
  });
});