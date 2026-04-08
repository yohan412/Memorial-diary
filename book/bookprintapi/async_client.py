"""BookPrintAPI SDK — Async HTTP Client (httpx 기반)

Usage:
    from bookprintapi.async_client import AsyncClient

    async def main():
        client = AsyncClient(api_key="SBxxxxx.xxxx", environment="sandbox")
        balance = await client.credits.get_balance()
        books = await client.books.list(status="finalized")
        await client.close()

    # 또는 async with
    async with AsyncClient(api_key="...") as client:
        ...

의존성:
    pip install httpx
"""

from __future__ import annotations

import os
import uuid
from typing import Any

try:
    import httpx
except ImportError:
    raise ImportError("async_client requires httpx. Install with: pip install httpx")

from .exceptions import ApiError

_VERSION = "0.1.0"

_BASE_URLS = {
    "live": "https://api.sweetbook.com/v1",
    "sandbox": "https://api-sandbox.sweetbook.com/v1",
}


class _AsyncBaseClient:
    def __init__(self, client: "AsyncClient"):
        self._client = client

    def _requireParam(self, value, name):
        if value is None or value == "":
            from .exceptions import ValidationError
            raise ValidationError(f"{name} is required", name)


class AsyncBooksClient(_AsyncBaseClient):
    async def list(self, *, status: str | None = None, limit: int = 20, offset: int = 0) -> dict:
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        return await self._client.get("/Books", params=params)

    async def create(self, *, book_spec_uid: str, title: str | None = None,
                     creation_type: str = "NORMAL", external_ref: str | None = None) -> dict:
        payload = {"bookSpecUid": book_spec_uid, "creationType": creation_type}
        if title:
            payload["title"] = title
        if external_ref:
            payload["externalRef"] = external_ref
        return await self._client.post("/Books", payload=payload)

    async def get(self, book_uid: str) -> dict:
        self._requireParam(book_uid, "book_uid")
        return await self._client.get(f"/Books/{book_uid}")

    async def finalize(self, book_uid: str) -> dict:
        self._requireParam(book_uid, "book_uid")
        return await self._client.post(f"/Books/{book_uid}/finalization", payload={})

    async def delete(self, book_uid: str) -> dict | None:
        self._requireParam(book_uid, "book_uid")
        return await self._client.delete(f"/Books/{book_uid}")


class AsyncOrdersClient(_AsyncBaseClient):
    async def estimate(self, items: list[dict]) -> dict:
        return await self._client.post("/orders/estimate", payload={"items": items})

    async def create(self, *, items: list[dict], shipping: dict,
                     external_ref: str | None = None) -> dict:
        payload: dict[str, Any] = {"items": items, "shipping": shipping}
        if external_ref:
            payload["externalRef"] = external_ref
        return await self._client.post("/orders", payload=payload)

    async def list(self, *, limit: int = 20, offset: int = 0,
                   status: int | None = None) -> dict:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return await self._client.get("/orders", params=params)

    async def get(self, order_uid: str) -> dict:
        self._requireParam(order_uid, "order_uid")
        return await self._client.get(f"/orders/{order_uid}")

    async def cancel(self, order_uid: str, cancel_reason: str) -> dict:
        self._requireParam(order_uid, "order_uid")
        return await self._client.post(f"/orders/{order_uid}/cancel", payload={"cancelReason": cancel_reason})

    async def update_shipping(self, order_uid: str, **kwargs) -> dict:
        field_map = {
            "recipient_name": "recipientName", "recipient_phone": "recipientPhone",
            "postal_code": "postalCode", "address1": "address1",
            "address2": "address2", "shipping_memo": "shippingMemo",
        }
        payload = {api_key: kwargs[py_key] for py_key, api_key in field_map.items()
                   if py_key in kwargs and kwargs[py_key] is not None}
        return await self._client.patch(f"/orders/{order_uid}/shipping", payload=payload)


class AsyncCreditsClient(_AsyncBaseClient):
    async def get_balance(self) -> dict:
        return await self._client.get("/credits")

    async def get_transactions(self, *, limit: int = 20, offset: int = 0) -> dict:
        return await self._client.get("/credits/transactions", params={"limit": limit, "offset": offset})

    async def sandbox_charge(self, amount: int, memo: str | None = None) -> dict:
        payload: dict[str, Any] = {"amount": amount}
        if memo:
            payload["memo"] = memo
        return await self._client.post("/credits/sandbox/charge", payload=payload)


class AsyncClient:
    """BookPrintAPI Async HTTP 클라이언트 (httpx 기반)

    Args:
        api_key: API Key. 미지정 시 BOOKPRINT_API_KEY 환경변수.
        environment: "sandbox" | "live".
        base_url: API URL 직접 지정.
        timeout: 타임아웃 (초). 기본 60.
    """

    def __init__(
        self,
        api_key: str | None = None,
        environment: str | None = None,
        base_url: str | None = None,
        timeout: int = 60,
    ):
        self.api_key = api_key or os.getenv("BOOKPRINT_API_KEY", "")
        self.environment = environment or os.getenv("BOOKPRINT_ENV", "live")
        resolved_url = base_url or os.getenv("BOOKPRINT_BASE_URL", "")
        if not resolved_url:
            resolved_url = _BASE_URLS.get(self.environment, _BASE_URLS["live"])
        self.base_url = resolved_url.rstrip("/")

        if not self.api_key:
            raise ValueError("api_key is required.")

        self._http = httpx.AsyncClient(timeout=timeout)

        self.books = AsyncBooksClient(self)
        self.orders = AsyncOrdersClient(self)
        self.credits = AsyncCreditsClient(self)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": f"BookPrintAPI-Python-Async/{_VERSION}",
            "X-Transaction-ID": str(uuid.uuid4()),
        }

    def _url(self, path: str) -> str:
        p = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{p}"

    def _handle(self, resp: httpx.Response) -> dict | None:
        if resp.status_code >= 400:
            try:
                body = resp.json()
                raise ApiError(
                    message=body.get("message", f"HTTP {resp.status_code}"),
                    status_code=resp.status_code,
                    details=body.get("errors", []),
                )
            except (ValueError, KeyError):
                raise ApiError(f"HTTP {resp.status_code}", status_code=resp.status_code)
        if not resp.text:
            return None
        return resp.json()

    async def get(self, path: str, params: dict | None = None) -> dict | None:
        resp = await self._http.get(self._url(path), headers=self._headers(), params=params)
        return self._handle(resp)

    async def post(self, path: str, payload: dict | None = None) -> dict | None:
        headers = self._headers()
        headers["Content-Type"] = "application/json"
        resp = await self._http.post(self._url(path), headers=headers, json=payload)
        return self._handle(resp)

    async def patch(self, path: str, payload: dict | None = None) -> dict | None:
        headers = self._headers()
        headers["Content-Type"] = "application/json"
        resp = await self._http.patch(self._url(path), headers=headers, json=payload)
        return self._handle(resp)

    async def delete(self, path: str) -> dict | None:
        resp = await self._http.delete(self._url(path), headers=self._headers())
        return self._handle(resp)

    async def close(self):
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
