import { z } from "zod";
import { normalizePrediction, UNCERTAIN_THRESHOLD, type ScanResult, type StoredCategory } from "./scan-schema";
import { roundEven } from "./model-preprocessing";

export const modelManifestSchema = z.object({
  arch: z.literal("mobilenet_v3_small"),
  num_classes: z.literal(13),
  classes: z.array(z.string()).length(13),
  idx_to_class: z.record(z.string()),
  class_to_category: z.record(z.enum(["organic", "recyclable", "hazardous", "ewaste", "residual"])),
  image_size: z.literal(224),
  normalization: z.object({ mean: z.array(z.number()).length(3), std: z.array(z.number().positive()).length(3) }),
  uncertain_threshold: z.literal(55),
  model_file: z.literal("mobilenet-v3-small.onnx"),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  input_name: z.literal("image"), output_name: z.literal("logits"),
  preprocessing: z.object({ resize_short_edge: z.literal(257), crop_size: z.literal(224),
    interpolation: z.literal("pillow-bilinear"), center_rounding: z.literal("ties-to-even"),
    channel_order: z.literal("RGB"), layout: z.literal("NCHW"), scale: z.literal(255), exif_transpose: z.literal(false) }),
  disposal_steps: z.record(z.array(z.string())),
}).superRefine((manifest, context) => {
  for (let i = 0; i < manifest.num_classes; i++) {
    const label = manifest.classes[i];
    if (!label || manifest.idx_to_class[String(i)] !== label || !manifest.class_to_category[label]) {
      context.addIssue({ code: "custom", message: "Model class index or category mapping is invalid." });
    }
  }
});

export type ModelManifest = z.infer<typeof modelManifestSchema>;
/** Never assign this type to a stored Scan or send it to classifyWaste. */
export type LocalPrediction = Omit<ScanResult, "source"> & {
  source: "mobilenet-browser"; saved: false; trust: "unverified";
};

export function predictionFromLogits(logits: readonly number[] | Float32Array, manifest: ModelManifest): LocalPrediction {
  if (logits.length !== 13 || Array.from(logits).some((value) => !Number.isFinite(value))) {
    throw new Error("The trained model returned invalid outputs.");
  }
  const maximum = Math.max(...logits);
  const exponentials = Array.from(logits, (value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  const index = Array.from(logits).indexOf(maximum);
  const item = manifest.idx_to_class[String(index)];
  if (!item) throw new Error("The model class mapping is unavailable.");
  const predictedCategory = manifest.class_to_category[item];
  const score = exponentials[index];
  if (!predictedCategory || score === undefined) throw new Error("The model class mapping is unavailable.");
  // Mirrors Python predict_image: ties-to-even confidence rounding before <55.
  const confidence = roundEven(score / total * 100);
  const category: StoredCategory = confidence < UNCERTAIN_THRESHOLD ? "uncertain" : predictedCategory;
  const normalized = normalizePrediction({ item, category, confidence,
    reasoning: `MobileNetV3-Small matched dataset class '${item}' with ${confidence}% prediction confidence. This browser result is unverified and is not measured accuracy.`,
    steps: manifest.disposal_steps[category] ?? [],
  }, "python");
  return { ...normalized, source: "mobilenet-browser", saved: false, trust: "unverified" };
}