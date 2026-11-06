<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Accounts use Lovable Cloud auth and scans live in the `scans` table with owner-only RLS; never store credentials or history in browser storage.
- Trusted server classification runs in authenticated classifyWaste; direct database INSERT is revoked so clients cannot forge server-classified results.
- Explicit browser saves run in authenticated saveBrowserScan with server-derived ownership, engine, category, threshold and guidance; provenance stays client-reported because browser logits cannot prove model execution.
- Only authenticated, validated saving handlers may use admin inserts; history reads, deletes and feedback updates retain owner-only RLS, and browser retry IDs are unique per owner to avoid duplicates.
- Export model assets from the saved checkpoint with backend/export_onnx.py and parity-check preprocessing against waste_model.py; never hand-edit class order or invent model weights.
- Keep WASM binaries or their large-asset pointers under public/wasm and load explicit URLs only during browser actions; runtime loaders must not use source imports or import.meta-relative binary URLs because they break server deployment.
- Bin text, per-result safety notes (`safetyFor`) and the uncertainty threshold are owned by scan-schema.ts; the Python service in `backend/` mirrors them in common.py and is used when `PYTHON_CLASSIFIER_URL` is set.
- Keep the React interface in one route file.
- Browser predictions run centre, mirrored and padded views; disagreement or low view confidence (stricter for paper/plastic/glass look-alikes) forces Uncertain, and saves carry that flag so the server stores Uncertain too.
