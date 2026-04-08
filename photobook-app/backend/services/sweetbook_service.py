"""bookprintapi.Client 래퍼 — photobook-app 전용 (book/ 파일 수정 없음)."""

from __future__ import annotations

import io
import json
import mimetypes
import sys
import time
from pathlib import Path

# 프로젝트 루트의 book/ 폴더에서 bookprintapi 로드 (설치 없이)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_APP_ROOT = _BACKEND_DIR.parent.parent  # test/
_BOOK_DIR = _APP_ROOT / "book"
if _BOOK_DIR.is_dir() and str(_BOOK_DIR) not in sys.path:
    sys.path.insert(0, str(_BOOK_DIR))

from bookprintapi import ApiError, Client  # noqa: E402


def get_client() -> Client:
    return Client()


def find_book_in_list(client: Client, book_uid: str, max_pages: int = 5) -> dict | None:
    """GET /Books/{uid} 가 405 등으로 막힐 때, 목록에서 해당 책 행을 찾습니다."""
    offset = 0
    limit = 100
    for _ in range(max_pages):
        raw = client.books.list(limit=limit, offset=offset)
        if not raw:
            break
        data = raw.get("data")
        if not isinstance(data, dict):
            data = raw if isinstance(raw, dict) else None
        if not isinstance(data, dict):
            break
        books = data.get("books")
        if books is None:
            books = data.get("items")
        if books is None:
            books = data.get("list")
        if not isinstance(books, list):
            break
        for item in books:
            if isinstance(item, dict):
                uid = item.get("bookUid") or item.get("uid")
                if uid == book_uid:
                    return item
        pagination = data.get("pagination")
        total = None
        if isinstance(pagination, dict):
            total = pagination.get("total")
        offset += limit
        if isinstance(total, (int, float)) and offset >= total:
            break
        if len(books) < limit:
            break
    return None


def api_get(path: str, params: dict | None = None) -> dict | None:
    return get_client().get(path, params=params)


def upload_photo_bytes(
    book_uid: str,
    filename: str,
    data: bytes,
    content_type: str | None = None,
) -> dict:
    client = get_client()
    mime = content_type or mimetypes.guess_type(filename)[0] or "image/jpeg"
    bio = io.BytesIO(data)
    files = [("file", (filename, bio, mime))]
    return client.post_form(f"/Books/{book_uid}/photos", files=files)


def _build_cover_multipart(
    template_uid: str,
    parameters: dict,
    extra_files: list[tuple[str, bytes, str]] | None = None,
) -> list:
    """매 호출마다 새 BytesIO — 재시도·PUT 시 스트림 소진 방지."""
    multipart: list = [
        ("templateUid", (None, template_uid)),
        ("parameters", (None, json.dumps(parameters or {}, ensure_ascii=False))),
    ]
    for name, raw, mime in extra_files or []:
        bio = io.BytesIO(raw)
        multipart.append(("files", (name, bio, mime)))
    return multipart


def _cover_already_exists_error(e: ApiError) -> bool:
    if e.status_code != 400:
        return False
    parts: list[str] = [e.message or ""]
    parts.extend(str(x) for x in (e.details or []))
    joined = " ".join(parts)
    low = joined.lower()
    if "이미" in joined or "존재" in joined:
        return True
    return any(
        k in low
        for k in (
            "already",
            "exist",
            "duplicate",
            "conflict",
        )
    )


def _try_delete_cover(client: Client, book_uid: str) -> None:
    try:
        client.delete(f"/Books/{book_uid}/cover")
    except ApiError as e:
        if e.status_code not in (404, 405):
            raise


def _put_cover_form(client: Client, book_uid: str, multipart: list) -> dict | None:
    """일부 스위트북 환경은 덮어쓰기에 PUT 멀티파트를 씀."""
    resp = client._session.request(
        "PUT",
        client._url(f"/Books/{book_uid}/cover"),
        headers=client._headers(),
        files=multipart,
        timeout=client.timeout,
    )
    return client._handle_response(resp)


def create_cover_multipart(
    book_uid: str,
    template_uid: str,
    parameters: dict,
    extra_files: list[tuple[str, bytes, str]] | None = None,
) -> dict | None:
    client = get_client()
    mp = _build_cover_multipart(template_uid, parameters, extra_files)
    return client.post_form(f"/Books/{book_uid}/cover", files=mp)


def replace_book_cover_multipart(
    book_uid: str,
    template_uid: str,
    parameters: dict,
    extra_files: list[tuple[str, bytes, str]] | None = None,
) -> dict | None:
    """DELETE → POST. POST 가 '이미 존재'면 PUT 시도, 실패 시 DELETE 한 번 더 후 POST 재시도."""
    client = get_client()
    url = f"/Books/{book_uid}/cover"

    _try_delete_cover(client, book_uid)
    mp = _build_cover_multipart(template_uid, parameters, extra_files)
    try:
        return client.post_form(url, files=mp)
    except ApiError as e:
        if not _cover_already_exists_error(e):
            raise

    mp_put = _build_cover_multipart(template_uid, parameters, extra_files)
    try:
        return _put_cover_form(client, book_uid, mp_put)
    except ApiError:
        pass

    _try_delete_cover(client, book_uid)
    mp2 = _build_cover_multipart(template_uid, parameters, extra_files)
    return client.post_form(url, files=mp2)


def insert_content_multipart(
    book_uid: str,
    template_uid: str,
    parameters: dict,
    break_before: str | None = None,
    extra_files: list[tuple[str, bytes, str]] | None = None,
) -> dict:
    client = get_client()
    multipart: list = [
        ("templateUid", (None, template_uid)),
        ("parameters", (None, json.dumps(parameters or {}, ensure_ascii=False))),
    ]
    params = {}
    if break_before:
        params["breakBefore"] = break_before
    for name, raw, mime in extra_files or []:
        bio = io.BytesIO(raw)
        multipart.append(("files", (name, bio, mime)))
    return client.post_form(
        f"/Books/{book_uid}/contents", files=multipart, params=params or None
    )


def _delete_resource_try_paths(client: Client, paths: list[str]) -> dict:
    """DELETE 를 여러 경로로 시도. 일부 환경은 /Books/ vs /books/ 또는 405 로 한쪽만 동작."""
    last: dict = {"status": None, "path": None}
    for path in paths:
        resp = client._session.delete(
            client._url(path),
            headers=client._headers(),
            timeout=client.timeout,
        )
        code = resp.status_code
        last = {"status": code, "path": path}
        if code in (200, 204, 202):
            return {"result": "deleted", **last}
        if code == 404:
            return {"result": "absent", **last}
        if code == 405:
            continue
        if code in (401, 403):
            try:
                raise ApiError.from_response(resp)
            except ApiError as e:
                last["message"] = str(e)
                return {"result": f"error:{e.status_code}", **last}
        try:
            last["message"] = (resp.text or "")[:240]
        except Exception:
            last["message"] = ""
        continue
    if last.get("status") == 405:
        return {"result": "skipped_405", **last}
    return {"result": "failed", **last}


def _book_spec_and_title_for_recreate(client: Client, book_uid: str) -> tuple[str | None, str]:
    for path in (f"/Books/{book_uid}", f"/books/{book_uid}"):
        try:
            raw = client.get(path)
        except ApiError:
            continue
        if not isinstance(raw, dict):
            continue
        d = raw.get("data")
        if not isinstance(d, dict):
            continue
        spec_raw = d.get("bookSpecUid") or d.get("bookSpecUID")
        spec = spec_raw.strip() if isinstance(spec_raw, str) and spec_raw.strip() else None
        title_raw = d.get("title")
        title = (
            title_raw.strip()
            if isinstance(title_raw, str) and title_raw.strip()
            else "나의 포토북"
        )
        if spec:
            return spec, title
    found = find_book_in_list(client, book_uid)
    if isinstance(found, dict):
        spec_raw = found.get("bookSpecUid") or found.get("bookSpecUID")
        spec = spec_raw.strip() if isinstance(spec_raw, str) and spec_raw.strip() else None
        title_raw = found.get("title")
        title = (
            title_raw.strip()
            if isinstance(title_raw, str) and title_raw.strip()
            else "나의 포토북"
        )
        return spec, title
    return None, "나의 포토북"


def _parse_book_uid_from_create_response(raw: dict | None) -> str | None:
    if not raw or not isinstance(raw, dict):
        return None
    d = raw.get("data")
    if not isinstance(d, dict):
        return None
    for k in ("bookUid", "uid", "bookUID"):
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def finalize_book(book_uid: str) -> dict | None:
    """POST /Books/{book_uid}/finalization — JSON 본문 없이 전송.

    Client.post(..., json={{}}) 는 일부 환경에서 스위트북 게이트웨이가 400으로 거절하는
    경우가 있어, 표준 헤더만 붙인 빈 POST 로 맞춥니다.
    """
    client = get_client()
    resp = client._session.post(
        client._url(f"/Books/{book_uid}/finalization"),
        headers=client._headers(),
        timeout=client.timeout,
    )
    return client._handle_response(resp)


__all__ = [
    "ApiError",
    "Client",
    "get_client",
    "find_book_in_list",
    "api_get",
    "upload_photo_bytes",
    "create_cover_multipart",
    "replace_book_cover_multipart",
    "insert_content_multipart",
    "finalize_book",
]
