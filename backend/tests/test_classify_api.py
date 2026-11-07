import base64
import io
import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import common
import main as service

KEY = "test-classifier-key"
AUTH = {"X-Classifier-Key": KEY}
buffer = io.BytesIO()
Image.new("RGB", (64, 64)).save(buffer, format="PNG")
PNG = buffer.getvalue()


def _client(monkeypatch, predict=None, local=None, api_key=""):
    monkeypatch.setattr(service, "AI_API_KEY", api_key)
    monkeypatch.setattr(service, "CLASSIFIER_API_KEY", KEY)
    monkeypatch.setattr(service, "ALLOW_UNAUTHENTICATED", False)
    monkeypatch.setattr(service, "AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setattr(service, "AI_MODEL", "gemini-2.5-flash")
    monkeypatch.setattr(service, "get_local", lambda: (local, {}))
    if predict is not None:
        monkeypatch.setattr(service, "predict_local", predict)
    return TestClient(service.app)


def response(item="electrical switch", confidence=92, **extra):
    return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
        {"text": json.dumps({"item": item, "confidence": confidence, "reasoning": "Visible switch housing.", **extra})}
    ]}}]})


def test_health_reports_actual_primary_engine(monkeypatch):
    c = _client(monkeypatch, local=object(), api_key="test-key")
    body = c.get("/health").json()
    assert body["engine"] == "gemini-vision"
    assert body["local_model"] is True
    assert body["gemini_configured"] is True
    assert body["uncertain_threshold"] == 55


def test_gemini_native_request_and_switch_rules(monkeypatch):
    c = _client(monkeypatch, local=object(), api_key="test-gemini-key")
    seen = {}
    def post(client, url, **kwargs):
        seen.update(url=url, **kwargs)
        # A model-supplied category/bin cannot override Python rules.
        return response(category="recyclable", bin="Blue", steps=["Wrong instruction"])
    monkeypatch.setattr(httpx.Client, "post", post)
    # Call ASGI through a different HTTP client method so the upstream stub is isolated.
    r = c.request("POST", "/classify", files={"file": ("switch.png", PNG, "image/png")}, headers=AUTH)
    assert r.status_code == 200
    assert seen["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    assert seen["headers"] == {"x-goog-api-key": "test-gemini-key", "Content-Type": "application/json"}
    assert "Authorization" not in seen["headers"]
    inline = seen["json"]["contents"][0]["parts"][1]["inlineData"]
    assert inline == {"mimeType": "image/png", "data": base64.b64encode(PNG).decode()}
    assert "model" not in seen["json"] and "messages" not in seen["json"]
    body = r.json()
    assert body["item"] == "electrical switch"
    assert body["category"] == "ewaste"
    assert body["bin"] == "Red Bin (Special E-Waste Bin)"
    assert body["steps"] == common.DISPOSAL_STEPS["ewaste"]
    assert body["warnings"] == common.safety_for("ewaste", "electrical switch")
    assert body["engine"] == "gemini-vision:gemini-2.5-flash"


@pytest.mark.parametrize("item,category", [
    ("charger", "ewaste"), ("ceiling fan", "ewaste"), ("electrical switch box", "ewaste"),
    ("adapter", "ewaste"), ("cable", "ewaste"), ("battery", "hazardous"),
    ("plastic bottle", "recyclable"), ("paper", "recyclable"), ("cardboard", "recyclable"),
    ("glass bottle", "recyclable"), ("metal can", "recyclable"), ("food scraps", "organic"),
    ("vegetable peels", "organic"), ("fruit peels", "organic"), ("leaves", "organic"),
    ("red apple", "organic"), ("unknown", "uncertain"), ("blurry electrical switch", "uncertain"),
    ("unsupported paper object", "uncertain"), ("office chair", "uncertain"),
    ("fantasy figurine", "uncertain"), ("paperweight", "uncertain"), ("computer mouse", "ewaste"),
    ("mouse", "uncertain"), ("fan-shaped leaf", "uncertain"), ("battery charger", "hazardous"),
])
def test_deterministic_object_rule(item, category):
    assert service.map_object_to_category(item) == category


@pytest.mark.parametrize("confidence,category", [(54, "uncertain"), (55, "ewaste")])
def test_gemini_threshold(monkeypatch, confidence, category):
    _client(monkeypatch, api_key="test-key")
    monkeypatch.setattr(httpx.Client, "post", lambda *a, **k: response(confidence=confidence))
    result = service.predict_gemini(PNG, "image/png")
    assert result["category"] == category
    assert result["bin"] == common.BINS[category]
    assert result["steps"] == common.DISPOSAL_STEPS[category]


@pytest.mark.parametrize("model", ["gemini-2.5-flash", "google/gemini-2.5-flash", "models/gemini-2.5-flash"])
def test_native_model_path_prefixes(monkeypatch, model):
    _client(monkeypatch)
    monkeypatch.setattr(service, "AI_MODEL", model)
    assert service.gemini_endpoint().endswith("/models/gemini-2.5-flash:generateContent")


def test_gateway_base_never_receives_gemini_key(monkeypatch):
    _client(monkeypatch, api_key="test-key")
    monkeypatch.setattr(service, "AI_BASE_URL", "https://ai.gateway.lovable.dev/v1")
    def forbidden(*a, **k):
        raise AssertionError("No request to the wrong host is allowed")
    monkeypatch.setattr(httpx.Client, "post", forbidden)
    with pytest.raises(HTTPException) as error:
        service.predict_gemini(PNG, "image/png")
    assert error.value.status_code == 503


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 500])
def test_upstream_status_is_safe_and_never_falls_back(monkeypatch, status):
    c = _client(monkeypatch, local=object(), api_key="test-key")
    monkeypatch.setattr(httpx.Client, "post", lambda *a, **k: httpx.Response(status, text="sensitive-upstream-body"))
    monkeypatch.setattr(service, "predict_local", lambda *a: pytest.fail("No silent model fallback"))
    r = c.request("POST", "/classify", files={"file": ("x.png", PNG, "image/png")}, headers=AUTH)
    assert r.status_code == (429 if status == 429 else 502)
    assert f"Gemini API error ({status})" in r.json()["detail"]
    assert "sensitive-upstream-body" not in r.text


@pytest.mark.parametrize("upstream", [
    httpx.Response(200, text="invalid json"),
    httpx.Response(200, json={"candidates": []}),
    httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}),
    response(confidence=float("nan")), response(confidence=101), response(confidence=True), response(item=""),
])
def test_invalid_json_or_output_is_not_a_prediction(monkeypatch, upstream):
    _client(monkeypatch, api_key="test-key")
    monkeypatch.setattr(httpx.Client, "post", lambda *a, **k: upstream)
    with pytest.raises(HTTPException) as error:
        service.predict_gemini(PNG, "image/png")
    assert error.value.status_code == 502


@pytest.mark.parametrize("exception,status", [(httpx.ReadTimeout("sensitive-url"), 504), (httpx.ConnectError("sensitive-url"), 502)])
def test_network_errors_are_safe(monkeypatch, exception, status):
    _client(monkeypatch, api_key="test-key")
    def fail(*a, **k):
        raise exception
    monkeypatch.setattr(httpx.Client, "post", fail)
    with pytest.raises(HTTPException) as error:
        service.predict_gemini(PNG, "image/png")
    assert error.value.status_code == status
    assert "sensitive-url" not in error.value.detail


def test_classify_local_payload_contract(monkeypatch):
    def fake_predict(bytes_, mime):
        return {"item": "plastic", "category": "recyclable", "confidence": 92,
                "reasoning": "test", "steps": common.DISPOSAL_STEPS["recyclable"],
                "bin": common.BINS["recyclable"], "engine": "local-ml:test", "latency_ms": 1.0}
    c = _client(monkeypatch, predict=fake_predict, local=object())
    r = c.post("/classify", files={"file": ("x.png", PNG, "image/png")}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["category"] == "recyclable"
    assert r.json()["engine"] == "local-ml:test"


@pytest.mark.parametrize("auth,status", [(None, 401), ({"X-Classifier-Key": "wrong"}, 401), (AUTH, 200)])
def test_classifier_auth(monkeypatch, auth, status):
    c = _client(monkeypatch, local=object(), predict=lambda *a: {"category": "uncertain"})
    assert c.post("/classify", files={"file": ("x.png", PNG, "image/png")}, headers=auth).status_code == status


def test_no_configured_shared_key(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(service, "CLASSIFIER_API_KEY", "")
    assert c.post("/classify", files={"file": ("x.png", PNG, "image/png")}, headers=AUTH).status_code == 503


def test_no_engine(monkeypatch):
    c = _client(monkeypatch)
    assert c.post("/classify", files={"file": ("x.png", PNG, "image/png")}, headers=AUTH).status_code == 503


@pytest.mark.parametrize("data,status", [
    (b"not an image", 415), (b"\x89PNG\r\n\x1a\n" + b"0" * 64, 415),
    (PNG + b"0" * (common.MAX_BYTES + 1), 413),
])
def test_invalid_image_is_rejected_before_api_call(monkeypatch, data, status):
    c = _client(monkeypatch, api_key="test-key")
    monkeypatch.setattr(service, "predict_gemini", lambda *a: pytest.fail("Invalid images must not reach Gemini"))
    assert c.post("/classify", files={"file": ("x.png", data, "image/png")}, headers=AUTH).status_code == status


def test_tiny_image_rejected(monkeypatch):
    b = io.BytesIO()
    Image.new("RGB", (16, 16)).save(b, "PNG")
    c = _client(monkeypatch)
    assert c.post("/classify", files={"file": ("x.png", b.getvalue(), "image/png")}, headers=AUTH).status_code == 422


def test_safety_warnings_never_suggest_opening_devices():
    for category in ("hazardous", "ewaste"):
        assert "do not" in " ".join(common.SAFETY_WARNINGS[category]).lower()
