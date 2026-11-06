import { z } from "zod";
import manifestJson from "../../public/models/mobilenet-v3-small.json";
import { modelManifestSchema } from "./model-contract";
import { BROWSER_SOURCE, imageSchema, normalizePrediction, type ScanResult } from "./scan-schema";

const manifest = modelManifestSchema.parse(manifestJson);

/** Accept a reported label/score, never caller ownership, engine, bin or guidance. */
export const browserSaveSchema = z.object({
  image: imageSchema,
  item: z.string().refine((item) => manifest.classes.includes(item), "Unknown model class."),
  confidence: z.number().int().min(0).max(100),
  requestId: z.string().uuid(),
}).strict();

export type BrowserSaveInput = z.infer<typeof browserSaveSchema>;
export type BrowserSavedResult = ScanResult & { provenance: "client-reported" };

/** Server-derived category, threshold, instructions and source; not inference attestation. */
export function normalizeBrowserReport(input: BrowserSaveInput): BrowserSavedResult {
  const category = manifest.class_to_category[input.item];
  if (!category) throw new Error("Unknown model class.");
  const result = normalizePrediction({
    item: input.item, category, confidence: input.confidence,
    reasoning: `Browser-reported MobileNetV3-Small prediction: '${input.item}' with ${input.confidence}% prediction confidence. Not measured accuracy; model execution is not independently verified.`,
    steps: manifest.disposal_steps[category] ?? [],
  }, BROWSER_SOURCE);
  return { ...result, provenance: "client-reported" };
}