# EcoLens AI — Python ML classification service

FastAPI service that classifies waste photos into the app's six categories
(organic, recyclable, hazardous, e-waste, residual, uncertain) and returns the
recommended bin and disposal steps.

## Engine order

1. **Local PyTorch model** — MobileNetV3-Small, transfer learning from ImageNet,
   trained on a labelled public waste dataset. Active when `models/best.pt` +
   `models/config.json` exist (set `ML_MODEL_DIR` to override the directory).
2. **Vision-model fallback** — an OpenAI-compatible Chat Completions API
   (Lovable AI Gateway by default). Used **only when explicitly configured**
   with `AI_API_KEY`. `/health` always reports which engine is active.

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

**Trust and saving:** “Analyze Waste” uses MobileNetV3 as the primary option and
produces a local prediction with safety/bin guidance. “Save Scan” explicitly
uploads the photo, reported label and confidence through authenticated
`saveBrowserScan`. The server owns category/bin/guidance, user ID and source.
Saved source is exactly `MobileNetV3-Small (ONNX Browser)` with provenance
`client-reported`: saving does not prove browser model execution. The same
owner-scoped request key returns the original row on retry rather than creating
duplicates. History/dashboard include these explicitly saved rows.

“Use Lovable AI Gateway” is an explicit alternative through authenticated
`classifyWaste`, even if a legacy Python URL is configured. It creates a separate
`gateway` result; existing Gateway/Python rows are not relabelled. No failure
automatically switches engines. Direct database INSERT is revoked; saving
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

## Optional legacy Python service deployment

This is not needed for browser ONNX and is not part of the requested integration.

1. Train the model (steps 2–4) and keep `models/` alongside the code.
2. Deploy `backend/` (Dockerfile included) to any host: Render, Fly.io,
   Hugging Face Spaces, a VPS — anything that serves HTTPS.
   `docker build -t ecolens-classifier ./backend && docker run -p 8000:8000 ecolens-classifier`
3. In Lovable, set the secret `PYTHON_CLASSIFIER_URL` to the deployed base URL
   (e.g. `https://ecolens-classifier.onrender.com`). The app's authenticated
   `classifyWaste` server function then routes every scan to this service.
   If `PYTHON_CLASSIFIER_URL` is set but unreachable, the scan fails visibly —
   it is never silently replaced by another engine.
4. The frontend validates image type/size before upload; this service
   re-validates magic bytes and the 6 MB limit server-side.
