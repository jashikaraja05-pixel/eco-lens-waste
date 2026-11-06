import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { preprocessRgb, roundEven } from "@/lib/model-preprocessing";

describe("Python evaluation preprocessing parity", () => {
  const cases = [
    [35, 53, "dabe329cec2251ea863fab0c8bfd62a9f0d715edb0d5bc1b81f96b74d39fa650"],
    [52, 34, "9f3b632c588137b6be94313861bf6ea47e75e21f64805994f92d8b63f6fdf537"],
    [257, 257, "fe0a33a3fdf5541c3bfe75b3d3a426bdc57db592830455468a0e31b917d8b4fa"],
    [431, 323, "3fa5fa815a1406aba3ab3a3ef4db25e7734b9d07aa3ff304e9641b2cf80e6179"],
  ] as const;
  for (const [width, height, hash] of cases) {
    it(`matches the full Pillow/torchvision tensor at ${width} × ${height}`, () => {
      const data = new Uint8Array(width * height * 3);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          data.set([(x * 17 + y * 3) % 256, (x * 5 + y * 23) % 256, (x * 11 + y * 7) % 256], (y * width + x) * 3);
        }
      }
      const tensor = preprocessRgb({ data, width, height }, {
        resizeShortEdge: 257, cropSize: 224,
        mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
      });
      expect(tensor.length).toBe(1 * 3 * 224 * 224);
      expect(createHash("sha256").update(new Uint8Array(tensor.buffer)).digest("hex")).toBe(hash);
    });
  }
  it("uses Python ties-to-even center crop offsets", () => {
    expect(roundEven(16.5)).toBe(16);
    expect(roundEven(17.5)).toBe(18);
  });
});