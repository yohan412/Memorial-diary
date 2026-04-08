"""Sweetbook 내지 GET 응답을 프론트가 바로 쓸 수 있게 pages 배열로 정규화."""

from __future__ import annotations

import json
import re
from typing import Any

_IMG_EXT = re.compile(r"\.(jpe?g|png|gif|webp|bmp|heic|heif)$", re.I)


def _is_record(x: Any) -> bool:
    return isinstance(x, dict)


def _unwrap_book_data(res: dict) -> dict:
    d = res.get("data")
    return d if isinstance(d, dict) else res


def _peel_book_payload(root: dict | None) -> dict | None:
    if not root:
        return None
    cur: dict = root
    for _ in range(5):
        inner = cur.get("data")
        if isinstance(inner, dict):
            cur = inner
            continue
        break
    return cur


def _parse_parameters(v: Any) -> dict | None:
    if v is None or v is False:
        return None
    if isinstance(v, str):
        try:
            o = json.loads(v)
        except json.JSONDecodeError:
            return None
        return o if isinstance(o, dict) else None
    return v if isinstance(v, dict) else None


def _http_url(s: str) -> str | None:
    t = s.strip()
    if t.startswith("//"):
        t = "https:" + t
    if len(t) < 10 or not re.match(r"^https?://", t, re.I):
        return None
    return t


def _pick_first_url(row: dict, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = row.get(k)
        if isinstance(v, str):
            u = _http_url(v)
            if u:
                return u
    return None


def _first_photo_from_params(params: dict) -> str | None:
    fallback: str | None = None
    for v in params.values():
        if isinstance(v, str):
            s = v.strip()
            if not s or re.match(r"^https?://", s, re.I) or s.lower().startswith("www."):
                continue
            if _IMG_EXT.search(s):
                return s
            if fallback is None:
                fallback = s
        elif isinstance(v, list):
            for x in v:
                if not isinstance(x, str):
                    continue
                s = x.strip()
                if not s or re.match(r"^https?://", s, re.I):
                    continue
                if _IMG_EXT.search(s):
                    return s
                if fallback is None:
                    fallback = s
    return fallback


def _template_uid_from_row(row: dict) -> str | None:
    for k in (
        "templateUid",
        "templateID",
        "template_id",
        "contentTemplateUid",
        "contentTemplateUID",
    ):
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _first_thumbnail_from_nested_thumbnails(row: dict) -> str | None:
    th = row.get("thumbnails")
    if not isinstance(th, dict):
        return None
    for k in ("layout", "baseLayerOdd", "baseLayerEven"):
        v = th.get(k)
        if isinstance(v, str):
            u = _http_url(v)
            if u:
                return u
        if isinstance(v, dict):
            for sk in ("url", "href", "src"):
                sv = v.get(sk)
                if isinstance(sv, str):
                    u = _http_url(sv)
                    if u:
                        return u
    return None


def _layout_thumb_for_row(row: dict) -> str | None:
    u = _pick_first_url(
        row,
        (
            "pagePreviewUrl",
            "contentPreviewUrl",
            "renderPreviewUrl",
            "previewImageUrl",
            "thumbnailUrl",
            "previewUrl",
        ),
    )
    if u:
        return u
    u = _pick_first_url(
        row,
        (
            "layoutThumbnailUrl",
            "layoutThumbUrl",
            "thumbUrl",
            "templateThumbnailUrl",
        ),
    )
    if u:
        return u
    return _first_thumbnail_from_nested_thumbnails(row)


def _photo_file_name_for_row(row: dict) -> str | None:
    for k in ("photoFileName", "fileName", "mainImageFileName", "imageMain"):
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    params = (
        _parse_parameters(row.get("parameters"))
        or _parse_parameters(row.get("templateParameters"))
        or {}
    )
    return _first_photo_from_params(params)


def _snapshot_from_row(row: dict, order: int, id_fallback: str) -> dict | None:
    tid = _template_uid_from_row(row)
    if not tid:
        return None
    params = (
        _parse_parameters(row.get("parameters"))
        or _parse_parameters(row.get("templateParameters"))
        or {}
    )
    layout = _layout_thumb_for_row(row)
    photo = _photo_file_name_for_row(row)
    uid = row.get("uid") or row.get("id") or row.get("contentUid") or id_fallback
    name = row.get("templateName") or row.get("name") or row.get("title") or "내지"
    name_s = name.strip() if isinstance(name, str) else "내지"
    out: dict[str, Any] = {
        "uid": str(uid),
        "templateUid": tid,
        "templateName": name_s,
        "order": order,
    }
    if layout:
        out["layoutThumbUrl"] = layout
    if photo:
        out["photoFileName"] = photo
    if params:
        out["parameters"] = params
    return out


def _expand_content_array(arr: list[Any]) -> list[dict]:
    out: list[dict] = []
    seq = 0
    for i, item in enumerate(arr):
        if not isinstance(item, dict):
            continue
        row = item

        nested = row.get("pages")
        if isinstance(nested, list) and nested:
            for j, sub in enumerate(nested):
                if not isinstance(sub, dict):
                    continue
                s = _snapshot_from_row(sub, seq + 1, f"srv-{i}-{j}")
                if s:
                    out.append(s)
                    seq += 1
            continue

        left, right = row.get("leftPage"), row.get("rightPage")
        used = False
        if isinstance(left, dict):
            s = _snapshot_from_row(left, seq + 1, f"srv-{i}-L")
            if s:
                out.append(s)
                seq += 1
                used = True
        if isinstance(right, dict):
            s = _snapshot_from_row(right, seq + 1, f"srv-{i}-R")
            if s:
                out.append(s)
                seq += 1
                used = True
        if used:
            continue

        body = row.get("content")
        if isinstance(body, dict):
            s = _snapshot_from_row(body, seq + 1, f"srv-{i}-body")
            if s:
                out.append(s)
                seq += 1
                continue

        s = _snapshot_from_row(row, seq + 1, f"srv-{i}")
        if s:
            out.append(s)
            seq += 1
    return out


def _row_looks_like_content_page(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    return _template_uid_from_row(row) is not None


def _find_content_array_in_object(data: dict) -> list[Any] | None:
    for v in data.values():
        if not isinstance(v, list) or not v:
            continue
        if any(_row_looks_like_content_page(x) for x in v):
            return v
    return None


_CANDIDATE_KEYS = (
    "pages",
    "contents",
    "items",
    "contentPages",
    "contentList",
    "bookContents",
    "innerPages",
    "pageList",
    "layouts",
    "sheets",
    "spreads",
    "results",
    "list",
)


def extract_normalized_pages_from_payload(payload: dict) -> list[dict]:
    for k in _CANDIDATE_KEYS:
        arr = payload.get(k)
        if not isinstance(arr, list) or not arr:
            continue
        expanded = _expand_content_array(arr)
        if expanded:
            return expanded
    discovered = _find_content_array_in_object(payload)
    if discovered:
        expanded = _expand_content_array(discovered)
        if expanded:
            return expanded
    return []


def enrich_contents_get_response(body: dict | None) -> None:
    """
    Sweetbook 원본 JSON을 제자리에서 보강합니다.
    정규화된 pages가 나오면 payload['pages']에 덮어써 프론트가 첫 번째로 읽게 합니다.
    """
    if not isinstance(body, dict):
        return
    top = _unwrap_book_data(body)
    payload = _peel_book_payload(top) or top
    if not isinstance(payload, dict):
        return
    normalized = extract_normalized_pages_from_payload(payload)
    if not normalized:
        return
    payload["pages"] = normalized
