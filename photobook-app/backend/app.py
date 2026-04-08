"""Photobook Flask API — Sweetbook 프록시 + 컬러화."""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

_BACKEND_DIR = Path(__file__).resolve().parent
_APP_ROOT = _BACKEND_DIR.parent.parent
_DATA_DIR = _BACKEND_DIR / "data"
_WEBHOOK_INBOX = _DATA_DIR / "webhook_inbox.jsonl"
# utf-8-sig: Windows에서 저장된 BOM이 있어도 키 이름이 깨지지 않음
load_dotenv(_APP_ROOT / ".env", encoding="utf-8-sig")
load_dotenv(_BACKEND_DIR / ".env", encoding="utf-8-sig")

sys.path.insert(0, str(_BACKEND_DIR))

from services.book_contents_normalize import enrich_contents_get_response  # noqa: E402
from services.colorization import colorize_image  # noqa: E402
from services.sweetbook_service import (  # noqa: E402
    ApiError,
    replace_book_cover_multipart,
    finalize_book,
    find_book_in_list,
    get_client,
    insert_content_multipart,
    upload_photo_bytes,
    api_get,
)
from bookprintapi.webhook import verify_signature  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


def _sb_error(e: ApiError, default_status: int = 502):
    """스위트북 4xx/5xx 를 가능하면 동일 코드로 전달(프론트에서 구분 가능)."""
    sc = e.status_code
    http_status = sc if sc is not None and 400 <= sc <= 599 else default_status
    return jsonify(
        {
            "success": False,
            "message": str(e),
            "errors": e.details,
            "status_code": e.status_code,
        }
    ), http_status


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "photobook-backend"})


@app.post("/api/photos/colorize")
def photos_colorize():
    if "image" not in request.files:
        return jsonify({"success": False, "message": "image file required"}), 400
    f = request.files["image"]
    prompt = request.form.get("prompt") or None
    try:
        png, eff, engine, c_metrics = colorize_image(f.stream, prompt)
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    b64 = base64.standard_b64encode(png).decode("ascii")
    return jsonify(
        {
            "success": True,
            "data": {
                "imageBase64": b64,
                "mime": "image/png",
                "promptUsed": eff,
                "engine": engine,
                "meanAbsDiff": c_metrics.get("meanAbsDiff"),
                "deoldifyVariant": c_metrics.get("deoldifyVariant"),
                "renderFactor": c_metrics.get("renderFactor"),
                "stub": c_metrics.get("stub"),
            },
        }
    )


@app.get("/api/photos/colorize/diagnostics")
def photos_colorize_diagnostics():
    """DeOldify 경로 사용 가능 여부 — 가중치는 로드하지 않음."""
    import os

    backend_dir = Path(__file__).resolve().parent
    vendor = backend_dir / "vendor" / "DeOldify"

    data: dict = {
        "COLORIZE_MODE": os.environ.get("COLORIZE_MODE", "deoldify"),
        "torch": None,
        "torchvision": None,
        "cv2": None,
        "huggingface_hub": None,
        "cuda_available": None,
        "deoldify_vendor_ok": vendor.is_dir(),
        "deoldify_variant": os.environ.get("DEOLDIFY_VARIANT", "stable"),
        "DEOLDIFY_HF_REPO": os.environ.get("DEOLDIFY_HF_REPO", "spensercai/DeOldify"),
    }
    try:
        import torch

        data["torch"] = torch.__version__
        data["cuda_available"] = torch.cuda.is_available()
    except Exception as e:
        data["torch"] = False
        data["torch_error"] = str(e)
    try:
        import torchvision

        data["torchvision"] = torchvision.__version__
    except Exception as e:
        data["torchvision"] = False
        data["torchvision_error"] = str(e)
    try:
        import cv2  # noqa: F401

        data["cv2"] = True
    except Exception as e:
        data["cv2"] = False
        data["cv2_error"] = str(e)
    try:
        import huggingface_hub  # noqa: F401

        data["huggingface_hub"] = True
    except Exception as e:
        data["huggingface_hub"] = False
        data["huggingface_hub_error"] = str(e)
    mode = data.get("COLORIZE_MODE", "deoldify")
    if isinstance(mode, str):
        mode = mode.lower()
    deps_ok = (
        data.get("torch") not in (None, False)
        and data.get("torchvision") not in (None, False)
        and data.get("cv2") is True
        and data.get("huggingface_hub") is True
        and data.get("deoldify_vendor_ok") is True
    )
    data["deoldify_dependencies_ok"] = bool(deps_ok)
    data["will_use_deoldify"] = bool(
        deps_ok and mode in ("deoldify", "sd", "oldify")
    )
    data["colorize_backend"] = "deoldify"
    data["COLORIZE_FALLBACK_STUB"] = os.environ.get("COLORIZE_FALLBACK_STUB", "1")
    return jsonify({"success": True, "data": data})


@app.get("/api/book-specs")
def book_specs_list():
    try:
        # 문서: GET /book-specs
        r = api_get("/book-specs", dict(request.args))
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/book-specs/<uid>")
def book_specs_one(uid: str):
    try:
        r = api_get(f"/book-specs/{uid}")
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/templates")
def templates_list():
    try:
        r = api_get("/templates", dict(request.args))
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/templates/<uid>")
def templates_one(uid: str):
    try:
        r = api_get(f"/templates/{uid}")
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/books")
def books_list_route():
    """Sweetbook GET /Books — 계정(API 키)의 책 목록."""
    status = request.args.get("status")
    if status is not None and status != "" and status not in ("draft", "finalized"):
        return jsonify(
            {"success": False, "message": "status must be draft, finalized, or omitted"}
        ), 400
    try:
        limit = int(request.args.get("limit", 20))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"success": False, "message": "invalid limit or offset"}), 400
    limit = max(1, min(100, limit))
    offset = max(0, offset)
    st = status if status else None
    try:
        c = get_client()
        r = c.books.list(status=st, limit=limit, offset=offset)
        return jsonify(r if r is not None else {"success": True, "data": {"books": []}})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/books")
def books_create():
    body = request.get_json(silent=True) or {}
    spec = body.get("bookSpecUid")
    if not spec:
        return jsonify({"success": False, "message": "bookSpecUid required"}), 400
    try:
        c = get_client()
        payload = {
            "bookSpecUid": spec,
            "creationType": body.get("creationType", "NORMAL"),
        }
        if body.get("title"):
            payload["title"] = body["title"]
        if body.get("externalRef"):
            payload["externalRef"] = body["externalRef"]
        r = c.post("/Books", payload=payload)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/books/<book_uid>")
def books_get(book_uid: str):
    """단건 GET 이 스위트북에서 405/404 인 환경이 있어, 목록 조회로 폴백."""
    c = get_client()
    try:
        r = c.get(f"/Books/{book_uid}")
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        if e.status_code in (405, 404):
            try:
                found = find_book_in_list(c, book_uid)
                if found:
                    return jsonify({"success": True, "data": found})
                return jsonify(
                    {
                        "success": False,
                        "message": "책을 목록에서 찾지 못했습니다. 목록을 새로고침해 보세요.",
                    }
                ), 404
            except ApiError as e2:
                return _sb_error(e2)
        return _sb_error(e)


@app.delete("/api/books/<book_uid>")
def books_delete(book_uid: str):
    """Sweetbook: draft 책만 삭제 가능."""
    try:
        c = get_client()
        r = c.books.delete(book_uid)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


def _sb_get_path_fallback(client, paths: list[str]) -> dict | None:
    """Sweetbook 게이트웨이마다 /Books/ vs /books/ 또는 GET 미지원(405) 차이가 있어 순회."""
    last: ApiError | None = None
    for path in paths:
        try:
            return client.get(path)
        except ApiError as e:
            last = e
            if e.status_code in (405, 404):
                continue
            raise
    return None


def _allowed_sweetbook_asset_host(hostname: str | None) -> bool:
    """Sweetbook 도메인 + 환경변수로 허용한 스토리지 접미사 (S3·CDN 등)."""
    if not hostname:
        return False
    h = hostname.lower().rstrip(".")
    if h == "sweetbook.com" or h.endswith(".sweetbook.com"):
        return True
    extra = os.getenv("PHOTOBOOK_ASSET_PROXY_HOST_SUFFIXES", "").strip()
    if not extra:
        return False
    for part in extra.split(","):
        suf = part.strip().lower().rstrip(".")
        if not suf:
            continue
        if h == suf or h.endswith("." + suf):
            return True
    return False


def _looks_like_image_body(body: bytes, content_type_main: str) -> bool:
    if content_type_main.startswith("image/"):
        return True
    if len(body) < 12:
        return False
    # 일부 스토리지가 application/octet-stream 만 주는 경우
    if body[:3] == b"\xff\xd8\xff":
        return True
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if body[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return True
    return False


@app.get("/api/sweetbook-asset")
def sweetbook_asset_proxy():
    """thumbnailUrl 등 외부 이미지를 서버가 받아 같은 출처로 제공 (브라우저 직접 로드 차단 완화)."""
    raw = (request.args.get("url") or "").strip()
    if not raw or len(raw) > 4096:
        return jsonify({"success": False, "message": "url required"}), 400
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.netloc:
        return jsonify({"success": False, "message": "invalid url"}), 400
    if not _allowed_sweetbook_asset_host(parsed.hostname):
        app.logger.warning(
            "sweetbook-asset rejected host=%s (set PHOTOBOOK_ASSET_PROXY_HOST_SUFFIXES if storage is on another CDN)",
            parsed.hostname,
        )
        return jsonify({"success": False, "message": "host not allowed"}), 403
    _headers: dict[str, str] = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; PhotobookApp/1.0; +https://sweetbook.com/) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    _ref = os.getenv("PHOTOBOOK_ASSET_PROXY_REFERER", "https://sweetbook.com/").strip()
    if _ref:
        _headers["Referer"] = _ref
    if os.getenv("PHOTOBOOK_ASSET_PROXY_SEND_API_KEY", "").lower() in (
        "1",
        "true",
        "yes",
    ):
        try:
            c = get_client()
            auth = c._headers().get("Authorization")
            if auth:
                _headers["Authorization"] = auth
        except Exception:
            pass
    try:
        upstream = requests.get(
            raw,
            timeout=60,
            headers=_headers,
            allow_redirects=True,
        )
    except requests.RequestException as e:
        app.logger.warning("sweetbook-asset fetch failed: %s", e)
        return jsonify({"success": False, "message": "fetch failed"}), 502

    if not upstream.ok and upstream.status_code == 403 and "Referer" in _headers:
        _no_ref = {k: v for k, v in _headers.items() if k.lower() != "referer"}
        try:
            upstream = requests.get(
                raw,
                timeout=60,
                headers=_no_ref,
                allow_redirects=True,
            )
        except requests.RequestException as e:
            app.logger.warning("sweetbook-asset retry without Referer failed: %s", e)
            return jsonify({"success": False, "message": "fetch failed"}), 502

    if not upstream.ok:
        return jsonify(
            {"success": False, "message": f"upstream {upstream.status_code}"},
        ), 502
    ctype = upstream.headers.get("Content-Type") or "application/octet-stream"
    main_type = ctype.split(";")[0].strip().lower()
    body = upstream.content
    if not _looks_like_image_body(body, main_type):
        app.logger.warning("sweetbook-asset rejected Content-Type: %s", ctype[:120])
        return jsonify({"success": False, "message": "not an image"}), 502
    mimetype = main_type if main_type.startswith("image/") else "image/jpeg"
    return Response(
        body,
        mimetype=mimetype,
        headers={"Cache-Control": "private, max-age=300"},
    )


@app.get("/api/books/<book_uid>/photos")
def books_photos_list(book_uid: str):
    """Sweetbook GET /Books/{bookUid}/photos — 업로드된 파일명 목록."""
    try:
        c = get_client()
        r = c.get(f"/Books/{book_uid}/photos")
        return jsonify(
            r
            if r is not None
            else {"success": True, "data": {"photos": [], "totalCount": 0}}
        )
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/books/<book_uid>/photos")
def books_photos(book_uid: str):
    if "file" not in request.files:
        return jsonify({"success": False, "message": "file required"}), 400
    f = request.files["file"]
    data = f.read()
    try:
        r = upload_photo_bytes(book_uid, f.filename or "photo.jpg", data, f.mimetype)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/books/<book_uid>/cover")
def books_cover_get(book_uid: str):
    try:
        c = get_client()
        r = _sb_get_path_fallback(
            c,
            [
                f"/Books/{book_uid}/cover",
                f"/books/{book_uid}/cover",
            ],
        )
        if r is not None:
            return jsonify(r if isinstance(r, dict) else {"success": True, "data": r})
        # GET 표지가 405/404 인 환경: 책 목록 행에 표지 템플릿 UID 가 있으면 합성
        try:
            row = find_book_in_list(c, book_uid)
            if isinstance(row, dict):
                tpl = (
                    row.get("coverTemplateUid")
                    or row.get("coverTemplateUID")
                    or row.get("frontCoverTemplateUid")
                    or row.get("frontCoverTemplateUID")
                )
                if isinstance(tpl, str) and tpl.strip():
                    return jsonify(
                        {"success": True, "data": {"templateUid": tpl.strip()}},
                    )
        except ApiError:
            pass
        return jsonify({"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/books/<book_uid>/cover")
def books_cover(book_uid: str):
    template_uid = request.form.get("templateUid")
    params_raw = request.form.get("parameters", "{}")
    if not template_uid:
        return jsonify({"success": False, "message": "templateUid required"}), 400
    try:
        parameters = json.loads(params_raw)
    except json.JSONDecodeError:
        return jsonify({"success": False, "message": "invalid parameters JSON"}), 400
    if not isinstance(parameters, dict):
        return jsonify(
            {"success": False, "message": "parameters must be a JSON object"},
        ), 400
    extras: list[tuple[str, bytes, str]] = []
    for key in request.files:
        uf = request.files[key]
        raw = uf.read()
        mime = uf.mimetype or "image/jpeg"
        extras.append((uf.filename or key, raw, mime))
    try:
        r = replace_book_cover_multipart(
            book_uid, template_uid, parameters, extras or None
        )
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/books/<book_uid>/contents")
def books_contents_get(book_uid: str):
    """내지 목록 조회 — 경로·GET 지원 차이에 폴백. 전부 405/404 이면 빈 목록 200."""
    try:
        c = get_client()
        r = _sb_get_path_fallback(
            c,
            [
                f"/Books/{book_uid}/contents",
                f"/books/{book_uid}/contents",
            ],
        )
        if r is None:
            return jsonify({"success": True, "data": {"pages": [], "contents": []}})
        if isinstance(r, dict):
            enrich_contents_get_response(r)
        return jsonify(r)
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/books/<book_uid>/contents")
def books_contents(book_uid: str):
    template_uid = request.form.get("templateUid")
    params_raw = request.form.get("parameters", "{}")
    break_before = request.form.get("breakBefore")
    if not template_uid:
        return jsonify({"success": False, "message": "templateUid required"}), 400
    try:
        parameters = json.loads(params_raw)
    except json.JSONDecodeError:
        return jsonify({"success": False, "message": "invalid parameters JSON"}), 400
    extras: list[tuple[str, bytes, str]] = []
    for key in request.files:
        uf = request.files[key]
        raw = uf.read()
        mime = uf.mimetype or "image/jpeg"
        extras.append((uf.filename or key, raw, mime))
    try:
        r = insert_content_multipart(
            book_uid,
            template_uid,
            parameters,
            break_before=break_before,
            extra_files=extras or None,
        )
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/books/<book_uid>/finalization")
def books_finalize(book_uid: str):
    try:
        r = finalize_book(book_uid)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/orders/estimate")
def orders_estimate():
    body = request.get_json(silent=True) or {}
    items = body.get("items")
    if not items:
        return jsonify({"success": False, "message": "items required"}), 400
    try:
        c = get_client()
        r = c.post("/orders/estimate", payload={"items": items})
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/orders")
def orders_create():
    body = request.get_json(silent=True) or {}
    items = body.get("items")
    shipping = body.get("shipping")
    if not items or not shipping:
        return jsonify(
            {"success": False, "message": "items and shipping required"}
        ), 400
    try:
        c = get_client()
        payload = {"items": items, "shipping": shipping}
        if body.get("externalRef"):
            payload["externalRef"] = body["externalRef"]
        r = c.post("/orders", payload=payload)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


def _ensure_data_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/api/credits")
def credits_balance():
    try:
        c = get_client()
        r = c.get("/credits")
        return jsonify(r if r is not None else {"success": True, "data": {}})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/orders")
def orders_list():
    try:
        limit = min(int(request.args.get("limit", 20)), 100)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        limit, offset = 20, 0
    params: dict = {"limit": limit, "offset": offset}
    st = request.args.get("status", "").strip()
    if st:
        try:
            params["status"] = int(st)
        except ValueError:
            pass
    fd = request.args.get("from", "").strip()
    td = request.args.get("to", "").strip()
    if fd:
        params["from"] = fd
    if td:
        params["to"] = td
    try:
        c = get_client()
        r = c.get("/orders", params=params)
        return jsonify(r if r is not None else {"success": True, "data": {"orders": []}})
    except ApiError as e:
        return _sb_error(e)


@app.get("/api/orders/<order_uid>")
def orders_get_one(order_uid: str):
    try:
        c = get_client()
        r = c.get(f"/orders/{order_uid}")
        return jsonify(r if r is not None else {"success": True, "data": None})
    except ApiError as e:
        return _sb_error(e)


@app.patch("/api/orders/<order_uid>/shipping")
def orders_patch_shipping(order_uid: str):
    """배송지 변경 — Sweetbook 발송 전 상태만 허용."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"success": False, "message": "JSON body required"}), 400
    try:
        c = get_client()
        r = c.patch(f"/orders/{order_uid}/shipping", payload=body)
        return jsonify(r if r is not None else {"success": True})
    except ApiError as e:
        return _sb_error(e)


@app.post("/api/webhooks/sweetbook")
def webhook_sweetbook_receive():
    """Sweetbook 웹훅 수신 — 파트너 포털에 이 URL을 등록하세요 (서명은 PHOTOBOOK_WEBHOOK_SECRET)."""
    raw = request.get_data(cache=False, as_text=False) or b""
    secret = os.getenv("PHOTOBOOK_WEBHOOK_SECRET", "").strip()
    if secret:
        try:
            sig = request.headers.get("X-Webhook-Signature", "")
            ts = request.headers.get("X-Webhook-Timestamp", "")
            verify_signature(raw, sig, ts, secret)
        except ValueError as e:
            return jsonify({"success": False, "message": str(e)}), 400
    try:
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except json.JSONDecodeError:
        body = {"_parseError": True, "_rawPreview": raw.decode("utf-8", errors="replace")[:4000]}
    _ensure_data_dir()
    entry = {
        "receivedAt": datetime.now(timezone.utc).isoformat(),
        "eventType": body.get("event_type")
        or body.get("eventType")
        or body.get("type")
        or body.get("event"),
        "body": body,
    }
    try:
        with open(_WEBHOOK_INBOX, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as e:
        logging.exception("webhook append failed: %s", e)
        return jsonify({"success": False, "message": "storage failed"}), 500
    return jsonify({"success": True}), 200


@app.get("/api/webhooks/events")
def webhook_events_list():
    """수신한 웹훅 로컬 로그 (설정 화면용)."""
    try:
        limit = min(int(request.args.get("limit", 50)), 200)
    except ValueError:
        limit = 50
    _ensure_data_dir()
    if not _WEBHOOK_INBOX.is_file():
        return jsonify({"success": True, "data": {"events": []}})
    try:
        with open(_WEBHOOK_INBOX, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        lines = []
    events: list = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            events.append({"parseError": True, "line": line[:500]})
    return jsonify({"success": True, "data": {"events": events}})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
