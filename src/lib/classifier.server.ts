import { GEMINI_SOURCE, imageSchema, normalizePrediction, type ScanResult } from "./scan-schema";

export async function viaPython(url: string, image: string, apiKey?: string): Promise<ScanResult> {
  imageSchema.parse(image);
  const [meta, b64] = image.split(",");
  if (!meta || !b64) throw new Error("Choose a valid JPEG, PNG or WebP image.");
  const mime = meta.slice(5, meta.indexOf(";"));
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([bin], { type: mime }), `scan.${mime.split("/")[1]}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/classify`, {
      method: "POST", body: form, signal: controller.signal,
      headers: apiKey ? { "X-Classifier-Key": apiKey } : {},
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      // Only status codes cross this boundary, never upstream response bodies.
      const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "";
      const upstream = detail.match(/^(?:Vision API error|Gemini API error) \((\d{3})\)\./)?.[1];
      if (upstream) throw new Error(`Gemini API error (${upstream}). Check the Render Gemini model and API settings.`);
      if (res.status === 401 || res.status === 403) throw new Error(`Classifier authorization failed (${res.status}). Check the shared classifier key.`);
      if (res.status === 413 || res.status === 415 || res.status === 422) throw new Error(`Image rejected by the classifier (${res.status}). Choose a clear JPEG, PNG or WebP photo.`);
      if (res.status === 504) throw new Error("Gemini classification timed out (504). Try again or use the browser model.");
      throw new Error(`Classifier service error (${res.status}). Check Render settings or use the browser model.`);
    }
    if (!body || typeof body !== "object") throw new Error("Classifier returned invalid JSON. No result was saved.");
    const engine = "engine" in body && typeof body.engine === "string" ? body.engine : "";
    // Historic or unidentified Python output is never relabelled as Gemini.
    const source = engine === "gemini-vision" || engine.startsWith("gemini-vision:") ? GEMINI_SOURCE : "python";
    return normalizePrediction(body, source);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Classifier request timed out. Try again or use the browser model.");
    if (error instanceof TypeError) throw new Error("Python classifier service is unreachable.");
    throw error;
  } finally { clearTimeout(timeout); }
}

/**
 * Uses only the existing Render service. A failure never silently changes engines.
 */
export async function classifyImage(
  image: string,
  env: {
    pythonUrl?: string | undefined;
    pythonApiKey?: string | undefined;
  },
): Promise<ScanResult> {
  if (!env.pythonUrl) throw new Error("Gemini Python classifier service is not configured. Use the browser model or configure the existing Render service.");
  return viaPython(env.pythonUrl, image, env.pythonApiKey);
}

