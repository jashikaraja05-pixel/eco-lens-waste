import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyImage, viaPython } from "@/lib/classifier.server";
import { GEMINI_SOURCE, engineLabel } from "@/lib/scan-schema";
import { rowToScan, stats } from "@/lib/eco-store";

const image = "data:image/png;base64,iVBORw0KGgo=";
const switchResult = { item: "electrical switch", category: "ewaste", confidence: 92, reasoning: "Visible switch housing.", steps: ["Drop it at an authorised e-waste collection point."], engine: "gemini-vision:gemini-2.5-flash" };
afterEach(() => vi.unstubAllGlobals());

describe("Render Gemini pipeline", () => {
  it("sends multipart image and server-only shared key to the existing classifier", async () => {
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.body).toBeInstanceOf(FormData);
      const file = (options.body as FormData).get("file") as Blob;
      expect(file.type).toBe("image/png");
      expect(new Headers(options.headers).get("X-Classifier-Key")).toBe("test-key");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(switchResult));
    });
    vi.stubGlobal("fetch", fetch);
    const result = await classifyImage(image, { pythonUrl: "https://classifier.example/", pythonApiKey: "test-key" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://classifier.example/classify");
    expect(result).toMatchObject({ item: "electrical switch", category: "ewaste", bin: "Red Bin (Special E-Waste Bin)", source: "Google Gemini (Render)", confidence: 92 });
  });
  it("retrieves new Gemini scans into history and dashboard without relabelling old rows", () => {
    const row = { ...switchResult, id: "switch", bin: "Red Bin (Special E-Waste Bin)", image, created_at: "2026-11-07T09:00:00Z", source: GEMINI_SOURCE, provenance: "server-classified" };
    const scan = rowToScan(row);
    if (!scan) throw new Error("Gemini history row missing");
    expect(scan.source).toBe("Google Gemini (Render)");
    expect(stats([scan])).toMatchObject({ total: 1, ewaste: 1 });
    expect(rowToScan({ ...row, source: "gateway" })?.source).toBe("gateway");
    expect(rowToScan({ ...row, source: "python" })?.source).toBe("python");
    expect(engineLabel("python")).toBe("Python classifier service — underlying engine not recorded");
    expect(engineLabel("gateway")).toBe("Lovable AI Gateway");
  });
  it("only labels explicit Gemini engine reports as Gemini", async () => {
    for (const engine of [undefined, "local-ml:garbage_classification"]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...switchResult, engine }))));
      expect((await viaPython("https://classifier.example", image)).source).toBe("python");
    }
  });
  it("does not call Gateway when Render is unconfigured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(classifyImage(image, {})).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("surfaces the actual 404 safely and never silently switches engines", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: "Vision API error (404)." }), { status: 502 }));
    vi.stubGlobal("fetch", fetch);
    await expect(viaPython("https://classifier.example", image)).rejects.toThrow("Gemini API error (404)");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not echo arbitrary provider error details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "sensitive-upstream-body" }), { status: 502 })));
    await expect(viaPython("https://classifier.example", image)).rejects.toThrow("Classifier service error (502)");
  });
  it("rejects invalid JSON rather than saving it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON")));
    await expect(viaPython("https://classifier.example", image)).rejects.toThrow("invalid JSON");
  });
  it("preserves uncertainty with no bin recommendation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...switchResult, confidence: 54 }))));
    expect(await viaPython("https://classifier.example", image)).toMatchObject({ category: "uncertain", bin: "No bin — rescan or check local rules", source: GEMINI_SOURCE });
  });
  it("aborts a stalled service request without automatic retry", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })));
      const outcome = viaPython("https://classifier.example", image).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await outcome).toBe("Classifier request timed out. Try again or use the browser model.");
    } finally { vi.useRealTimers(); }
  });
});