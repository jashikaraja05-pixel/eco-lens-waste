"""EcoLens AI â€” Python FastAPI classification service.

The existing trained MobileNet checkpoint is unchanged. Gemini is primary when
AI_API_KEY is configured; failures never silently switch to the local model.
"""
from __future__ import annotations

import base64
import hmac
import io
import json
import math
import os
import re
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from common import ALLOWED, BINS, CATEGORIES, DISPOSAL_STEPS, MAX_BYTES, UNCERTAIN_THRESHOLD, safety_for, sniff

AI_BASE_URL = os.getenv("AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "")
# Shared secret required in the X-Classifier-Key header for /classify.
CLASSIFIER_API_KEY = os.getenv("CLASSIFIER_API_KEY", "")
ALLOW_UNAUTHENTICATED = os.getenv("ALLOW_UNAUTHENTICATED", "") == "1"  # local dev only
AI_MODEL = os.getenv("AI_MODEL", "gemini-3-flash-preview")
MODELS_DIR = Path(os.getenv("ML_MODEL_DIR", Path(__file__).parent / "models"))
PROMPT = (
    "You are an expert visual object identification system for waste segregation. "
    "Identify the single main physical object visible in the image. "
    "Return its specific common name, such as charger, electrical switch, fan, adapter, cable, battery, plastic bottle, paper, glass bottle, food scraps, or cardboard. "
    "Do not guess when the object is unclear, blurry, hidden, or multiple unrelated objects are present. "
    "Do not decide the waste category. The backend will determine the category using fixed rules. "
    "Return ONLY JSON: "
    '{"item": "specific object name", "confidence": 0-100, "reasoning": "short visual explanation"}'
)

app = FastAPI(title="EcoLens AI Classifier", version="2.0.0")
# The app calls this service server-to-server, so browsers need no CORS by default.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS,
                       allow_methods=["POST", "GET"], allow_headers=["Content-Type", "X-Classifier-Key"])


def require_key(provided: str | None) -> None:
    if ALLOW_UNAUTHENTICATED and not CLASSIFIER_API_KEY:
        return
    if not CLASSIFIER_API_KEY:
        raise HTTPException(503, "Service misconfigured: CLASSIFIER_API_KEY is not set.")
    if not provided or not hmac.compare_digest(provided.encode(), CLASSIFIER_API_KEY.encode()):
        raise HTTPException(401, "Missing or invalid X-Classifier-Key header.")

# Local model is loaded lazily so the service still starts (and /health works)
# before training has been run.
_local_model = None
_local_config: dict | None = None


def get_local():
    global _local_model, _local_config
    if _local_config is None:
        try:
            from waste_model import load_model
            _local_model, _local_config = load_model(MODELS_DIR)
        except (FileNotFoundError, ImportError) as e:
            _local_config = {}
            print(f"Local ML model not available ({e}); using configured fallback only.")
    return _local_model, _local_config


def engine_name() -> str:
    model, _ = get_local()
    if model is not None:
        return f"local-ml:{_local_config.get('dataset_name', 'unknown')}"
    return "none"

def predict_local(image_bytes: bytes, mime: str) -> dict:
    model, config = get_local()
    if model is None:
        raise HTTPException(503, "Local ML model is not trained yet. Run prepare_dataset.py and train.py, or configure AI_API_KEY.")
    try:
        image = Image.open(__import__("io").BytesIO(image_bytes))
        image.load()
    except Exception:
        raise HTTPException(415, "Image could not be decoded.")
    if image.width < 32 or image.height < 32:
        raise HTTPException(422, "Image is too small to classify (min 32x32 px).")
    from waste_model import predict_image
    p = predict_image(model, config, image)
    category = p["category"]
    if category not in CATEGORIES:
        raise HTTPException(502, "Model returned an unknown category.")
    return {
        "item": p["item"],
        "category": category,
        "confidence": p["confidence"],
        "reasoning": p["reasoning"],
        "steps": DISPOSAL_STEPS[category],
        "bin": BINS[category],
        "warnings": safety_for(category, p["item"]),
        "engine": engine_name(),
        "latency_ms": p["_latency_ms"],
    }


def map_object_to_category(item: str) -> str:
    """Map Gemini-identified object names to fixed waste categories."""
    name = re.sub(r"[-_]", " ", item.lower().strip())
    # Describing a shape (e.g. fan-shaped leaf) does not identify an appliance.
    name = re.sub(r"\b\w+ shaped\b", "", name)
    def contains(words):
        return any(re.search(r"\b" + re.escape(word) + r"\b", name) for word in words)

    if contains(["unknown", "unclear", "blurry", "unsupported", "unidentified", "multiple objects", "mixed items"]):
        return "uncertain"
    if contains(["battery", "batteries", "lithium cell"]):
        return "hazardous"
    elif contains(["charger", "fan", "switch", "adapter", "adaptor", "cable", "wire", "socket", "circuit", "circuit board", "phone", "mobile", "computer", "keyboard", "electronic", "earphone", "headphone", "remote", "motor"]):
        return "ewaste"
    elif contains(["chip wrapper", "biscuit wrapper", "plastic wrapper", "soiled tissue", "used tissue", "thermocol"]):
        return "residual"
    elif contains(["plastic bottle", "plastic container", "paper", "cardboard", "glass bottle", "glass jar", "metal can", "aluminium can", "aluminum can", "tin can"]):
        return "recyclable"
    elif contains(["food scraps", "vegetable peels", "vegetable peel", "fruit peels", "fruit peel", "apple", "banana", "orange peel", "food waste", "leaves", "garden waste"]):
        return "organic"
    else:
        return "uncertain"


def gemini_endpoint() -> str:
    """Allow only Google's native API; never forward its key to a gateway."""
    base = AI_BASE_URL.strip().rstrip("/") or "https://generativelanguage.googleapis.com/v1beta"
    if base == "https://generativelanguage.googleapis.com":
        base += "/v1beta"
    if base not in ("https://generativelanguage.googleapis.com/v1beta", "https://generativelanguage.googleapis.com/v1"):
        raise HTTPException(503, "Gemini configuration error: AI_BASE_URL must be Google's native API base, not /openai or a gateway.")
    model = AI_MODEL.strip()
    # Accept legacy Google gateway prefixes without changing the model itself.
    for prefix in ("google/", "models/"):
        if model.startswith(prefix):
            model = model[len(prefix):]
    if not re.fullmatch(r"gemini-[A-Za-z0-9._-]+", model):
        raise HTTPException(503, "Gemini configuration error: check AI_MODEL against Google's available models.")
    return f"{base}/models/{model}:generateContent"


def predict_gemini(image_bytes: bytes, mime: str) -> dict:
    body = {
        "systemInstruction": {"parts": [{"text": PROMPT}]},
        "contents": [{"role": "user", "parts": [
            {"text": "Identify the physical object in this photo. Do not choose a waste category."},
            {"inlineData": {"mimeType": mime, "data": base64.b64encode(image_bytes).decode("ascii")}},
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    headers = {"x-goog-api-key": AI_API_KEY, "Content-Type": "application/json"}
    endpoint = gemini_endpoint()
    try:
        with httpx.Client(timeout=90) as client:
            r = client.post(endpoint, json=body, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(504, "Gemini request timed out. Try again or use the browser model.") from None
    except httpx.HTTPError:
        raise HTTPException(502, "Gemini service is unreachable. Try again or use the browser model.") from None
    if r.status_code >= 400:
        hint = "Check AI_MODEL and the native API endpoint." if r.status_code == 404 else "Check the API key and its permissions." if r.status_code in (401, 403) else "Try again later or use the browser model."
        # Do not log/return upstream bodies, URLs or headers: they can contain secrets.
        raise HTTPException(429 if r.status_code == 429 else 502, f"Gemini API error ({r.status_code}). {hint}")

    try:
        response = r.json()
        candidate = response["candidates"][0]
        if candidate.get("finishReason", "STOP") != "STOP":
            raise ValueError("Incomplete answer")
        text = "".join(part.get("text", "") for part in candidate["content"]["parts"] if not part.get("thought"))
        p = json.loads(text)
        item = p["item"]
        score = p["confidence"]
        reasoning = p.get("reasoning", "Object identified from the image.")
        if not isinstance(item, str) or not item.strip() or len(item) > 150:
            raise ValueError("Invalid item")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 100:
            raise ValueError("Invalid confidence")
        if not isinstance(reasoning, str) or not reasoning.strip() or len(reasoning) > 1500:
            raise ValueError("Invalid explanation")
        item = item.strip()
        confidence = round(score)
    except (KeyError, ValueError, TypeError, IndexError, AttributeError):
        raise HTTPException(502, "Gemini returned invalid or incomplete JSON. No classification was saved.") from None

    category = map_object_to_category(item)

    if confidence < UNCERTAIN_THRESHOLD:
        category = "uncertain"

    if category == "uncertain":
        reasoning = "The object could not be identified confidently or matched to a supported waste category."

    return {
        "item": item,
        "category": category,
        "confidence": confidence,
        "reasoning": reasoning,
        "steps": DISPOSAL_STEPS[category],
        "bin": BINS[category],
        "warnings": safety_for(category, item),
        "engine": f"gemini-vision:{gemini_endpoint().split('/models/')[1].split(':')[0]}"
    }


@app.get("/health")
def health():
    model, config = get_local()
    info = {}
    if model is not None:
        info = {"trained_dataset": config.get("dataset_name"),
                "classes": config.get("classes"),
                "trained_at": config.get("trained_at")}
    return {"status": "ok", "engine": engine_name(),
            "local_model": model is not None, "local_model_info": info,
            "gemini_configured": bool(AI_API_KEY),
            "auth_required": not (ALLOW_UNAUTHENTICATED and not CLASSIFIER_API_KEY),
            "uncertain_threshold": UNCERTAIN_THRESHOLD}


@app.post("/classify")
async def classify(file: UploadFile = File(...), x_classifier_key: str | None = Header(default=None)):
    require_key(x_classifier_key)
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large (max 6 MB).")
    mime = sniff(data)
    if not data or mime not in ALLOWED:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP image.")

    try:
        with Image.open(io.BytesIO(data)) as decoded:
            if decoded.width < 32 or decoded.height < 32:
                raise HTTPException(422, "Image is too small to classify (min 32x32 px).")
            decoded.verify()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(415, "Image could not be decoded safely.") from None

    if get_local()[0] is not None:
        return predict_local(data, mime)
    raise HTTPException(503, "No classification engine available: configure AI_API_KEY or train the local model.")





