import { describe, expect, it } from "vitest";
import manifestJson from "../../public/models/mobilenet-v3-small.json";
import { modelManifestSchema, predictionFromViews } from "@/lib/model-contract";
import { normalizeBrowserReport } from "@/lib/browser-scan-schema";
import logits from "./fixtures/real-world-logits.json";

const manifest = modelManifestSchema.parse(manifestJson);
const run = (name: keyof typeof logits) => predictionFromViews(logits[name], manifest);

// Logits produced by the real ONNX model on centre / mirrored / padded views of public photos.
describe("Real-world look-alike photos", () => {
  it("green apple (model leans plastic/glass) is Uncertain, not a recycling bin", () => {
    const r = run("green_apple");
    expect(r.category).toBe("uncertain");
    expect(r.reliable).toBe(false);
  });
  it("electrical switch board (model says paper at 98%) is Uncertain, not the blue bin", () => {
    const r = run("switch_board");
    expect(r.item).toBe("paper");
    expect(r.category).toBe("uncertain");
  });
  it("a clear red apple still goes to organic", () => {
    const r = run("red_apple");
    expect(r.item).toBe("biological");
    expect(r.category).toBe("organic");
  });
  it("a clear cardboard box still goes to recyclable", () => {
    expect(run("cardboard").category).toBe("recyclable");
  });
  it("saving an unreliable prediction stays Uncertain on the server", () => {
    const image = "data:image/jpeg;base64,/9j/4AAQ";
    const saved = normalizeBrowserReport({ image, item: "paper", confidence: 99, requestId: crypto.randomUUID(), reliable: false });
    expect(saved.category).toBe("uncertain");
  });
});
