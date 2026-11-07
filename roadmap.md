# EcoLens GP-05 hackathon improvements
- [x] Repair existing Render Gemini request, safe errors and deterministic object mapping without replacing MobileNet
- [x] Make Render Gemini the main scanner action, preserving explicit browser fallback and historical engine labels
- [x] Run 70 frontend/67 Python tests, syntax check and automatic build; verify signed-in browser fallback/camera/saving/history/dashboard and two-account isolation; document deployment steps
- [ ] Verify real Gemini electrical-switch → E-Waste → saved history/dashboard — blocked by existing Render still returning Gemini HTTP 404; requires redeploy and checking its Google key/base URL/model availability
- [x] Secure Cloud auth + per-user scans database
- [x] Python FastAPI classifier + optional app connection
- [x] Uncertain category, error states, dashboard breakdown + recent scans
- [x] Oceanic Teal theme (replaced old #16A34A green), README, tests, browser check
- [x] Submission readiness pass (3 Nov 2026)
- [x] Python ML service implemented (4 Nov 2026)
- [x] Migrated into this Lovable project (4 Nov 2026)

# Final hackathon submission brief (4 Nov 2026)
- [x] Audit app, backend, schema, secrets
- [x] Fix wrong "Broken glass" warning on non-glass results
- [x] Honest classifier labelling (built-in vision AI vs local model; confidence is AI-estimated)
- [x] Hazardous/coverage claims match what the classifiers really support
- [x] First screen explains ECO-LENSAI: title, problem, solution, 5-step how-it-works
- [x] Learn Hub topics: basics, recycling, composting, battery/e-waste safety, plastic reduction, awareness
- [x] Root `.env.example` with placeholders; confirm no secrets in source
- [x] README rewritten for judges (no invented metrics/URLs)
- [x] Run frontend tests, backend tests, build, E2E scan, mobile check
- [ ] Connect GitHub for this project — blocked on user (Lovable creates a new repo; can't attach the existing ECO-LENSAI repo)
- [x] Inspect supplied trained checkpoint and recorded evaluation (original held-out split unavailable)
- [x] Replace external-host requirement with browser ONNX; legacy Python service remains optional
- [ ] Publish the app and add the live URL to README — needs user

# Browser model integration (6 Nov 2026)
- [x] Inspect checkpoint, evaluation preprocessing, class mapping and authenticated scan workflow
- [x] Export the real checkpoint to ONNX and verify numerical parity
- [x] Implement and test browser inference without accepting browser results as authoritative saved scans
- [x] Verify browser inference with 26 original images from all 13 classes; preserve actual mistakes in report
- [x] Report changed files, unsaved-local trust boundary and verification limitations
- [ ] Verify published model/codec assets and hosted browser policy — requires publishing
- [ ] Independently reproduce held-out accuracy and representative whole-device e-waste performance — requires original split and labelled images

# WASM deployment correction
- [x] Remove source-relative binary loading and move browser binaries to public/wasm
- [x] Recheck 26 real-image predictions, eight exact preprocessing fixtures, signed-in camera/mobile flow and 40 frontend tests

# Browser prediction history saving
- [x] Add authenticated, validated, owner-only browser saving with explicit engine/provenance
- [x] Add Save Scan to the primary browser result and keep Gateway as an explicit alternative
- [x] Test source preservation, failed-save retries, uncertainty and two-account isolation
- [x] Verify sign-in → upload → predict → save → history → dashboard; camera and 880×715 / 390×844 layouts
- [x] Run all tests: 55 frontend, 19 Python and retained authenticated browser/isolation flow; report changed files and remaining limits
