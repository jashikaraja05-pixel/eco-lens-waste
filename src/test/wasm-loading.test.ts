import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Browser-only WASM deployment boundary", () => {
  it("never gives the bundler an import.meta-relative WASM binary", () => {
    const runtime = readFileSync("public/models/ort/ort-wasm-simd-threaded.mjs", "utf8");
    expect(runtime).not.toMatch(/new URL\(["'][^"']+\.wasm["'],\s*import\.meta\.url\)/);
    expect(runtime).not.toMatch(/import\s*\(["'][^"']+\.wasm["']\)/);
  });

  it("keeps the browser codec binaries and large runtime pointer in public/wasm", () => {
    expect(existsSync("public/wasm/mozjpeg_dec.wasm")).toBe(true);
    expect(existsSync("public/wasm/webp_dec.wasm")).toBe(true);
    expect(existsSync("public/wasm/ort-wasm-simd-threaded.wasm.asset.json")).toBe(true);
  });
});