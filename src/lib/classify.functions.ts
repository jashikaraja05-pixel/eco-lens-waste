import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { imageSchema, type ScanResult } from "./scan-schema";
import { classifyImage } from "./classifier.server";
import { rowToScan, type Scan, type ScanRow } from "./eco-store";
import { browserSaveSchema, normalizeBrowserReport } from "./browser-scan-schema";

/** Classifies an image (Python FastAPI service if configured, else built-in AI) and saves it to the caller's history. */
export const classifyWaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ image: imageSchema, engine: z.literal("gateway").optional() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<Scan> => {
    let result: ScanResult;
    try {
      result = await classifyImage(data.image, { pythonUrl: process.env["PYTHON_CLASSIFIER_URL"], pythonApiKey: process.env["PYTHON_CLASSIFIER_API_KEY"], lovableApiKey: process.env["LOVABLE_API_KEY"] }, data.engine);
    } catch (e) {
      console.error("classification failed", e);
      throw new Error(e instanceof z.ZodError ? "The AI returned an invalid answer. Please try again." : (e as Error).message);
    }
    // Privileged insertion only after authenticated classification; direct INSERT is revoked.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("scans")
      .insert({ ...result, steps: result.steps, image: data.image, user_id: context.userId })
      .select()
      .single();
    if (error || !row) throw new Error("Classified, but could not save to your history.");
    const scan = rowToScan(row as ScanRow);
    if (!scan) throw new Error("Saved result could not be read.");
    return scan;
  });

/** Explicitly saves a client-reported prediction, never claiming trusted inference. */
export const saveBrowserScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => browserSaveSchema.parse(input))
  .handler(async ({ data, context }): Promise<Scan> => {
    const result = normalizeBrowserReport(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("scans").insert({
      ...result, image: data.image, user_id: context.userId, client_request_id: data.requestId,
    });
    // A retry after an ambiguous connection failure reads the original owner-scoped row.
    if (error && error.code !== "23505") throw new Error("Could not save scan. Your prediction is still available; try saving again.");
    const { data: row, error: readError } = await context.supabase.from("scans")
      .select("*").eq("user_id", context.userId).eq("client_request_id", data.requestId).single();
    if (readError || !row) throw new Error("Could not read the saved scan. Try saving again.");
    const scan = rowToScan(row as ScanRow);
    if (!scan) throw new Error("Saved result could not be read.");
    return scan;
  });

/** Permanently deletes the signed-in user's scans and account. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("scans").delete().eq("user_id", context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error("Could not delete account.");
    return { ok: true };
  });
