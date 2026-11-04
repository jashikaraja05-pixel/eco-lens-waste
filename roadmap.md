# EcoLens GP-05 hackathon improvements
- [x] Secure Cloud auth + per-user scans database
- [x] Python FastAPI classifier + optional app connection
- [x] Uncertain category, error states, dashboard breakdown + recent scans
- [x] Oceanic Teal theme (replaced old #16A34A green), README, tests, browser check
- [x] Submission readiness pass (3 Nov 2026)
- [x] Python ML service implemented (4 Nov 2026)
- [x] Migrated into this Lovable project (4 Nov 2026)

# Final hackathon submission brief (4 Nov 2026)
- [ ] Audit app, backend, schema, secrets
- [ ] Fix wrong "Broken glass" warning on non-glass results
- [ ] Honest classifier labelling (built-in vision AI vs local model; confidence is AI-estimated)
- [ ] Hazardous/coverage claims match what the classifiers really support
- [ ] First screen explains ECO-LENSAI: title, problem, solution, 5-step how-it-works
- [ ] Learn Hub topics: basics, recycling, composting, battery/e-waste safety, plastic reduction, awareness
- [ ] Root `.env.example` with placeholders; confirm no secrets in source
- [ ] README rewritten for judges (no invented metrics/URLs)
- [ ] Run frontend tests, backend tests, build, E2E scan, mobile check
- [ ] GitHub sync status (Lovable syncs automatically; cannot push manually)
- [ ] Run dataset download + training + evaluation (needs GPU/torch environment) — blocked on user
- [ ] Deploy the trained Python service and set PYTHON_CLASSIFIER_URL — blocked on user hosting
