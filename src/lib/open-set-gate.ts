import { z } from "zod";

/** Shown instead of a waste class when the photo is not one of the 13 supported item types. */
export const UNSUPPORTED_ITEM = "Unknown / Unsupported Item";

export const gateConfigSchema = z.object({
  asset_pointer: z.string().startsWith("/models/"),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  input_name: z.string(), output_name: z.string(),
  unsupported_top1_min: z.number().min(0).max(1),
  unsupported_mass_min: z.number().min(0).max(1),
  organic_mass_min: z.number().min(0).max(1),
  unsupported_indices: z.array(z.number().int().min(0).max(999)),
  organic_indices: z.array(z.number().int().min(0).max(999)),
  labels: z.array(z.string()).length(1000),
});
export type GateConfig = z.infer<typeof gateConfigSchema>;

export type GateVerdict =
  | { status: "unsupported"; recognizedAs: string }
  | { status: "organic-conflict"; recognizedAs: string }
  | { status: "ok"; recognizedAs: string };

/** Open-set check from a general ImageNet recognizer. `wasteItem` is the 13-class model's top label. */
export function gateVerdict(logits: ArrayLike<number>, config: GateConfig, wasteItem: string): GateVerdict {
  if (logits.length !== 1000) throw new Error("The object recognizer returned invalid outputs.");
  const values = Array.from(logits);
  const maximum = Math.max(...values);
  const e = values.map((v) => Math.exp(v - maximum));
  const total = e.reduce((a, b) => a + b, 0);
  const p = e.map((v) => v / total);
  const top = p.indexOf(Math.max(...p));
  const recognizedAs = config.labels[top] ?? "unknown";
  const unsupported = new Set(config.unsupported_indices);
  const mass = (indices: number[]) => indices.reduce((sum, i) => sum + (p[i] ?? 0), 0);
  if ((unsupported.has(top) && (p[top] ?? 0) >= config.unsupported_top1_min) || mass(config.unsupported_indices) >= config.unsupported_mass_min) {
    return { status: "unsupported", recognizedAs };
  }
  if (wasteItem !== "biological" && mass(config.organic_indices) >= config.organic_mass_min) {
    return { status: "organic-conflict", recognizedAs };
  }
  return { status: "ok", recognizedAs };
}
