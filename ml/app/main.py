"""
NER-SupplyAI internal ML service.

    uvicorn app.main:app --host 127.0.0.1 --port 8000

INTERNAL. The browser never calls this service; Express does, with a shared token, from the same
machine. Three layers keep it that way:

  1. it binds to loopback by default, so nothing off the machine can reach it;
  2. it sends no CORS headers, so a web page cannot read its responses even from localhost;
  3. predictions require `X-Internal-Token`, compared in constant time.

Errors are JSON — `{"error": "...", "detail": [...]}` — and never contain a Python traceback.
"""

from __future__ import annotations

import hmac
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import config
from app.schemas import (
    DeliveryRiskRequest,
    DeliveryRiskResponse,
    HealthResponse,
    RouteRiskRequest,
    RouteRiskResponse,
)
from app.services.delivery_risk import DeliveryRiskModel
from app.services.route_risk import ModelUnavailable, RouteRiskModel

log = logging.getLogger("ner-ml")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

_state: dict[str, object] = {"model": None, "error": None, "delivery": None, "deliveryError": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Loaded once, at startup. Loading per request would re-read a megabyte of JSON and rebuild
    # the SHAP explainer every time; failing here instead of on first request means a broken
    # artifact shows up in /health immediately.
    started = time.perf_counter()
    try:
        _state["model"] = RouteRiskModel()
        log.info("loaded %s in %.0f ms", config.MODEL_VERSION, (time.perf_counter() - started) * 1000)
    except ModelUnavailable as err:
        _state["error"] = str(err)
        log.error("model unavailable: %s", err)

    # The delivery pair loads independently: a corridor that can still score routes is more
    # useful than a service that refuses to start because the second model is missing.
    started = time.perf_counter()
    try:
        _state["delivery"] = DeliveryRiskModel()
        log.info(
            "loaded %s in %.0f ms", config.DELIVERY_MODEL_VERSION, (time.perf_counter() - started) * 1000
        )
    except ModelUnavailable as err:
        _state["deliveryError"] = str(err)
        log.error("delivery model unavailable: %s", err)
    if not config.INTERNAL_TOKEN:
        log.warning("ML_INTERNAL_TOKEN is not set — prediction requests will be refused")
    yield


# No interactive docs: this is not a public API, and /docs would publish its schema to anyone
# who can reach the port.
app = FastAPI(
    title="NER-SupplyAI ML (internal)",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Location and message only. Pydantic's raw errors also echo the offending input back,
    # which is noise at best and a reflection vector at worst.
    detail = [
        {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"error": "Invalid route-risk features.", "detail": detail})


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception) -> JSONResponse:
    # The traceback goes to the server log; the caller gets a sentence.
    log.exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"error": "The ML service failed to process this request."})


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    loaded = _state["model"] is not None
    delivery_loaded = _state["delivery"] is not None
    details = [str(_state[key]) for key in ("error", "deliveryError") if _state[key]]
    return HealthResponse(
        status="ok" if loaded and delivery_loaded and config.INTERNAL_TOKEN else "degraded",
        service="ner-supplyai-ml",
        modelVersion=config.MODEL_VERSION,
        modelLoaded=loaded,
        deliveryModelVersion=config.DELIVERY_MODEL_VERSION,
        deliveryModelLoaded=delivery_loaded,
        # Whether a token is configured — never the token itself.
        authConfigured=bool(config.INTERNAL_TOKEN),
        detail="; ".join(details) or None,
    )


def _authorised(token: str | None) -> JSONResponse | None:
    if not config.INTERNAL_TOKEN:
        return JSONResponse(status_code=503, content={"error": "Internal authentication is not configured."})
    if not token or not hmac.compare_digest(token.encode(), config.INTERNAL_TOKEN.encode()):
        return JSONResponse(status_code=401, content={"error": "Missing or invalid internal token."})
    return None


@app.post("/internal/predict-route-risk", response_model=RouteRiskResponse)
async def predict_route_risk(
    body: RouteRiskRequest,
    x_internal_token: str | None = Header(default=None),
):
    denied = _authorised(x_internal_token)
    if denied:
        return denied

    model = _state["model"]
    if model is None:
        return JSONResponse(status_code=503, content={"error": "The route-risk model is not loaded."})

    started = time.perf_counter()
    result = model.predict(body.features.model_dump(), reference=body.reference)  # type: ignore[attr-defined]
    elapsed_ms = (time.perf_counter() - started) * 1000

    response = JSONResponse(content=RouteRiskResponse(**result).model_dump())
    response.headers["X-Inference-Ms"] = f"{elapsed_ms:.2f}"
    return response


@app.post("/internal/predict-delivery-risk", response_model=DeliveryRiskResponse)
async def predict_delivery_risk(
    body: DeliveryRiskRequest,
    x_internal_token: str | None = Header(default=None),
):
    denied = _authorised(x_internal_token)
    if denied:
        return denied

    model = _state["delivery"]
    if model is None:
        return JSONResponse(status_code=503, content={"error": "The delivery-risk model is not loaded."})

    started = time.perf_counter()
    result = model.predict(body.features.model_dump(), reference=body.reference)  # type: ignore[attr-defined]
    elapsed_ms = (time.perf_counter() - started) * 1000

    response = JSONResponse(content=DeliveryRiskResponse(**result).model_dump())
    response.headers["X-Inference-Ms"] = f"{elapsed_ms:.2f}"
    return response
