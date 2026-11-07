# EcoLens AI — Python ML classification service

FastAPI service that classifies waste photos into the app's six categories
(organic, recyclable, hazardous, e-waste, residual, uncertain) and returns the
recommended bin and disposal steps.

## Engine order

1. **Google Gemini** — primary when the existing `AI_API_KEY` is configured on
   Render. Uses Google's official `generateContent` REST API, not a gateway.
   Gemini identifies the physical object; Python rules select the category,
   bin, disposal steps and safety notes. `/health` reports `gemini-vision`.
2. **Existing local PyTorch model** — used only when no Gemini key is configured
   and the unchanged `models/best.pt` + `models/config.json` exist. In the web
   scanner, users can explicitly choose the unchanged browser ONNX model.

No silent fallback: if neither is available, `/classify` returns HTTP 503, and
if the configured engine fails the error surfaces to the user. No prediction is
random, fabricated or hardcoded.

## Dataset

| Dataset | Source | Licence | Classes | Coverage |
|---|---|---|---|---|
| TrashNet (default) | github.com/garythung/trashnet | MIT (c) 2017 Gary Thung — verified in repo LICENSE | cardboard, glass, metal, paper, plastic, trash (2,527 images) | recyclable, residual only |
| Garbage Classification 12 classes | kaggle.com/datasets/mostafaabla/garbage-classification | check the Kaggle page before redistribution | 12 classes, 15,150 images | adds biological (organic) and battery (hazardous); no e-waste class |
| GIZ E-Waste Database | huggingface.co/datasets/GIZ/E-Waste-Database | CC BY 4.0; preserve attribution | e-waste | electronics; must be added separately |

**Category mapping** (`prepare_dataset.py`): TrashNet glass/paper/cardboard/plastic/metal →
recyclable, trash → residual. Garbage12 additionally maps biological → organic,
battery → hazardous, clothes/shoes/trash → residual. The saved 13-class config
adds a separate e-waste class mapped to ewaste; Garbage12 alone does not provide it.

**Limitations (honest scope):**
- TrashNet contains no organic, hazardous or e-waste images — a TrashNet-only
  model can never genuinely predict those categories. Use `--source kaggle`
  for fuller coverage.
- "Uncertain" is never a dataset class; it is produced solely by the 55%
  confidence threshold (`UNCERTAIN_THRESHOLD`, mirrored in
  `src/lib/scan-schema.ts`).
- Dataset photos are studio-like; expect lower accuracy on real bin photos.
- `item` labels are dataset class names (the finest label the model has) —
  the service never invents a product name.

## Commands

```bash
# 1. install (Python 3.11+)
pip install -r backend/requirements.txt

# 2. dataset + stratified train/val/test split (no leakage, split fixed once)
python backend/prepare_dataset.py --source hf --data-dir backend/data      # TrashNet via Hugging Face
# or: python backend/prepare_dataset.py --source dir --dir /path/to/classes
# or: python backend/prepare_dataset.py --kaggle  (needs `pip install kaggle` + Kaggle account)

# 3. train (MobileNetV3-Small transfer learning, early stopping on val accuracy)
python backend/train.py --split backend/data/split.json --epochs 25 --batch 32

# 4. evaluate on the held-out test split ONLY (accuracy, P/R/F1, per-class,
#    confusion matrix, latency) — writes models/evaluation_report.json
python backend/evaluate.py --split backend/data/split.json

# 5. run the API
cd backend && uvicorn main:app --port 8000
# check: curl localhost:8000/health   -> {"engine": "local-ml:trashnet", ...}

# 6. tests
cd backend && pytest tests/ -q
```

The supplied `models/best.pt` is a real 13-output MobileNetV3-Small checkpoint.
Its recorded evaluation report states 96.6% on 2,438 held-out images; the original
split/images are not available here, so that report has not been independently
reproduced. It is not a browser accuracy claim or per-image confidence.

## Browser ONNX (no Python hosting required)

The app runs the genuine exported checkpoint in the browser using ONNX Runtime
Web 1.22.0, single-threaded WASM with same-origin model/runtime files. Python is
used only for one-time conversion. No external Python API is required.
WASM binaries and the large-runtime asset pointer live in `public/wasm/`.
The browser supplies their URLs after user interaction; the public runtime
loader has no `import.meta.url`-relative WASM import for the server bundler.

```bash
pip install torch torchvision onnx onnxruntime numpy pillow
python backend/export_onnx.py --output public/models/mobilenet-v3-small.onnx
```

The script writes the real FP32 ONNX and matching JSON manifest, validates the
graph, hashes the checkpoint/model and compares logits against PyTorch.
Do not replace the checkpoint or edit the manifest's index order by hand.

Evaluation preprocessing is RGB decode without EXIF rotation, bilinear short-edge
resize to **257**, center crop **224** using Python ties-to-even offsets,
float32 RGB/NCHW `/255`, then mean `[0.485, 0.456, 0.406]` and std
`[0.229, 0.224, 0.225]`. JPEG and WebP decode through bundled codecs rather than
canvas; PNG alpha is discarded like Pillow. The resize implementation matches
Pillow's separable bilinear filter and fixed-point rounding. Reference tests
compare complete tensors, not just dimensions. Apply softmax to all 13 logits;
round confidence as Python does, then apply the existing **below 55%** rule.

**Trust and saving:** “Analyze Waste” uses the existing Render Gemini service
and saves its server-classified result through authenticated `classifyWaste`.
“Use Browser MobileNet” produces a local prediction with safety/bin guidance.
“Save Scan” explicitly
uploads the photo, reported label and confidence through authenticated
`saveBrowserScan`. The server owns category/bin/guidance, user ID and source.
Saved source is exactly `MobileNetV3-Small (ONNX Browser)` with provenance
`client-reported`: saving does not prove browser model execution. The same
owner-scoped request key returns the original row on retry rather than creating
duplicates. History/dashboard include these explicitly saved rows.

New Gemini reports are stored as `Google Gemini (Render)` only when the service
explicitly reports a `gemini-vision` engine. Existing Gateway/Python rows are
not relabelled; unidentified Python output retains its legacy source. No failure
automatically switches engines. Direct database INSERT remains revoked; saving
handlers insert after authentication with server-assigned ownership. Reads,
deletes and feedback-only updates retain owner RLS. Browser results remain
client-reported, not authoritative inference attestations.

**Authenticated saving verification:** sign in → upload original TrashNet plastic
image → actual ONNX inference → result → save → history detail/reload → dashboard
passed in Chromium. Two isolated accounts verified cross-owner read/update/delete
denial, anonymous/forged saving denial, owner feedback, retry deduplication and
separately labelled Gateway saving. Camera saving and 880×715 / 390×844 layouts
also passed. Run the retained `tests/browser_save_flow.py` with temporary sandbox
credentials and `ECOLENS_TEST_IMAGE`; it deletes only its own temporary accounts.

**Verified 6 November 2026:** 26 original images, two from each of the 13 classes,
ran in Chromium through the actual browser ONNX engine. All 26 predicted labels
and rounded confidence scores matched PyTorch. Three images were misclassified
relative to dataset labels (one biological and both e-waste label close-ups),
and PyTorch made the same mistakes. This is a parity/demo check, **not held-out
accuracy**. Eight image-format/EXIF/transparency fixtures produced byte-identical
evaluation tensors. Authenticated upload, explicit Gateway save/history reload,
camera inference, phone layout and asset-failure handling were also checked.
See `docs/browser-model-verification.json` for source attribution and outcomes.

Limitations: e-waste samples are label close-ups, not adequate whole-device
recognition tests; real-world quality and hosted CSP/asset loading after publish
remain unverified. Model assets are public and downloadable, as required for
browser inference. Dataset rights need review before redistributing model assets.

## Existing Render service repair and deployment

Keep `https://eco-lens-ai-hpzl.onrender.com`, the current website URL, repository
and `main` branch. Do not create another service or retrain/replace the model.

### What was reproduced and repaired

On 7 November 2026 a real electrical-switch photo sent server-to-server to the
existing Render `/classify` returned HTTP 502, `Vision API error (404).` The old
code posted an OpenAI Chat Completions payload to `AI_BASE_URL/chat/completions`
and defaulted to Lovable's gateway with a gateway-prefixed model. That contract
does not match Google's native API. The exact deployed URL/model values are
not readable here, so their specific contribution to the 404 is unverified.

The repair uses `POST /v1beta/models/{AI_MODEL}:generateContent`,
`x-goog-api-key`, `contents[].parts[].inlineData` containing raw base64 and its
real MIME type, and JSON output. Gemini does not select bins. Python checks
object names, confidence and output validity; fixed mapping/guidance is retained.
HTTP status is reported safely, without provider bodies, keys or request URLs.
Timeouts, corrupt/tiny/oversized images, invalid JSON and incomplete answers
fail without saving or silently changing engines.

### Verify existing Render environment variables manually

| Variable | Required check |
|---|---|
| `AI_API_KEY` | Existing Google AI Studio Gemini key with Gemini API permission/quota. Do not paste it into code or chat. A Lovable gateway key is not a Google key. |
| `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` (or unset). Not `/openai`, `/chat/completions`, or Lovable's gateway. |
| `AI_MODEL` | Preserve your intended Gemini model, but verify it is currently available to this key and supports `generateContent` with images. Use its native ID without a gateway prefix; code also accepts `google/` and `models/` prefixes. A syntactically valid retired/unavailable model still returns 404. The existing default is `gemini-3-flash-preview`; this does not prove current account availability. |
| `CLASSIFIER_API_KEY` | Keep the existing shared key; it must match Lovable's existing `PYTHON_CLASSIFIER_API_KEY`. Never overwrite it as part of deployment. |
| `ALLOW_UNAUTHENTICATED` | Unset in production. |
| `ML_MODEL_DIR` | Keep the current checkpoint path if set. |

Lovable already has `PYTHON_CLASSIFIER_URL` for this Render service and
`PYTHON_CLASSIFIER_API_KEY`. Neither secret was overwritten. There is no Gemini
key in the web app; Google is called only inside the existing Python backend.

### Deployment and exact checks

1. Let these changes sync to the existing repository's `main`. In the **existing**
   Render service, confirm that branch, then **Manual Deploy → Deploy latest
   commit**. Do not change its service URL. For a native Python service keep
   root directory `backend`, build `pip install -r requirements.txt`, and start
   `uvicorn main:app --host 0.0.0.0 --port $PORT`; for its current Docker service
   keep the existing Docker setup.
2. Verify the environment settings above on Render, then redeploy/restart that
   existing service. Google model availability must be checked using the key on
   Render; there is no authorized Google credential available in this sandbox.
3. `curl --fail https://eco-lens-ai-hpzl.onrender.com/health` must report
   `engine: gemini-vision`, `gemini_configured: true`, `auth_required: true`.
   Health alone is not an inference test.
4. Publish the updated Lovable app to its **existing** URL. Publishing the web
   app does not deploy the external Render Python service.
5. Sign in → Scan Waste → upload an electrical-switch photo → Analyze Waste.
   Require detected switch, **E-Waste**, `Red Bin (Special E-Waste Bin)`,
   e-waste safety guidance, **Google Gemini (Render)** and **Saved to history**.
   Open History, view the record, reload, then check Dashboard. Repeat with a
   plastic bottle, apple/peels, battery and unsupported/unclear object. Unknown
   or confidence below 55 must remain Uncertain without bin instructions.
6. Test **Use Browser MobileNet → Save Scan** separately; require source
   `MobileNetV3-Small (ONNX Browser)` and client-reported provenance. With a
   second signed-in account, the first account's records must not be visible.

Automated commands (run from repository root):

```bash
python -m pytest backend/tests -q
python -m py_compile backend/main.py
bunx vitest run
# In your own CI/local checkout; Lovable runs its production build automatically:
bun run build
# Requires authorized sandbox test credentials; cleans only its own test accounts:
ECOLENS_TEST_IMAGE=src/test/fixtures/images/red-apple.jpg python tests/browser_save_flow.py
```

Tests stub Google's response to verify the native request and deterministic
mapping; these are not real Gemini recognition results. The authenticated
browser runner calls real Render and reports a blocked result instead of
pretending that a failed live classification passed. Do not declare the live
switch-to-history repair complete until the redeployed service passes step 5.

### Actual verification results (7 November 2026)

- **70 frontend tests passed** across 10 files, including Render request/safe
  404 handling, engine preservation, Gemini history/dashboard conversion and
  electrical-switch result rendering.
- **67 Python tests passed**, no skips, including native Gemini URL/header/image
  contract, fixed object rules, 54/55 threshold, corrupt images, API status,
  malformed JSON, timeouts, no silent fallback, and existing MobileNet contract.
  One FastAPI test-client dependency deprecation warning remains.
- Python syntax check passed. Lovable's automatic build reported **build OK**;
  no separate manual production build was run in the sandbox.
- Real authenticated Chromium browser fallback: red apple → `biological`,
  **Organic**, 100% softmax confidence → explicit Save Scan → history detail →
  reload → dashboard passed. This is one observed prediction, not accuracy.
  Camera inference/save passed. 880×715 and 390×844 had no horizontal overflow.
- Two temporary accounts verified owner-only reads/updates/deletes, feedback,
  retry isolation/idempotency, forged/anonymous save denial and revoked direct
  inserts. Both test accounts and only their scans were removed; existing users
  and records were untouched. Browser runtime errors: **0**.
- **Live Render switch flow is BLOCKED**, not passed. Clicking Analyze Waste
  with an electrical-switch photo in an authenticated session still returned
  **Gemini API error (404)** from the not-yet-redeployed service. No row was
  inserted, and explicit browser fallback remained available. No real Gemini
  electrical-switch identification or successful Gemini-to-history saving is
  claimed. The request/mapping tests use controlled provider responses.

### Exact changed project files

- `.env.example` — clarify existing Render connection.
- `AGENTS.md` — preserve engine and deterministic mapping boundaries.
- `backend/.env.example` — native Gemini settings, no embedded shared key.
- `backend/Dockerfile` — correct engine-order comment only.
- `backend/README.md` — repair, deployment instructions and actual results.
- `backend/main.py` — official Gemini request, safe parsing/errors, validation,
  boundary-aware object mapping, truthful health/engine report.
- `backend/tests/test_classify_api.py` — Gemini contract/rule/error regression tests.
- `roadmap.md` — completed code work and explicit live Render blocker.
- `src/lib/classifier.server.ts` — existing Render-only call, timeout, safe errors,
  explicit Gemini provenance; remove active Gateway substitution.
- `src/lib/classify.functions.ts` — authenticated Render call and secure saving.
- `src/lib/eco-store.ts` — read new Gemini source without relabelling old rows.
- `src/lib/scan-schema.ts` — distinct Gemini source and shared engine labels.
- `src/routes/index.tsx` — correct primary/fallback actions and engine labels;
  attach the camera stream after its video element mounts (fixes an intermittent
  capture readiness race reproduced during browser testing); no layout redesign.
- `src/test/browser-result.test.tsx` — electrical-switch result test.
- `src/test/gemini-pipeline.test.ts` — Render/auth/image/source/error regressions.
- `tests/browser_save_flow.py` — retain real browser fallback/security checks and
  test real Render switch flow, reporting failure instead of fabricated success.

No credentials, model weights/classes/preprocessing, database schema/policies,
authentication settings, URLs, repository or branch were changed.
