"""BookPrintAPI SDK — Core HTTP Client"""

from __future__ import annotations

import os
import uuid
from typing import Any, BinaryIO

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .exceptions import ApiError

_VERSION = "0.1.0"
_DEFAULT_TIMEOUT = 60

_BASE_URLS = {
    "live": "https://api.sweetbook.com/v1",
    "sandbox": "https://api-sandbox.sweetbook.com/v1",
}


class Client:
    """BookPrintAPI HTTP 클라이언트

    Args:
        api_key: API Key (SBxxxxx.xxxx 형식). 미지정 시 BOOKPRINT_API_KEY 환경변수 사용.
        environment: "sandbox" | "live". 미지정 시 BOOKPRINT_ENV 환경변수 또는 "live".
        base_url: API 서버 URL 직접 지정 (environment보다 우선). 미지정 시 BOOKPRINT_BASE_URL 환경변수.
        timeout: 요청 타임아웃 (초). 기본값 60.
        max_retries: 재시도 횟수. 기본값 3.
    """

    def __init__(
        self,
        api_key: str | None = None,
        environment: str | None = None,
        base_url: str | None = None,
        timeout: int = _DEFAULT_TIMEOUT,
        max_retries: int = 3,
    ):
        self.api_key = api_key or os.getenv("BOOKPRINT_API_KEY", "")
        self.environment = environment or os.getenv("BOOKPRINT_ENV", "live")

        # base_url 우선순위: 인자 > 환경변수 > environment 매핑
        resolved_url = base_url or os.getenv("BOOKPRINT_BASE_URL", "")
        if not resolved_url:
            resolved_url = _BASE_URLS.get(self.environment, _BASE_URLS["live"])
        self.base_url = resolved_url.rstrip("/")
        self.timeout = timeout

        if not self.api_key:
            raise ValueError("api_key is required. Set BOOKPRINT_API_KEY env var or pass it directly.")

        self._session = requests.Session()
        retry = Retry(total=max_retries, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
        self._session.mount("https://", HTTPAdapter(max_retries=retry))
        self._session.mount("http://", HTTPAdapter(max_retries=retry))

        # Sub-clients (lazy import to avoid circular)
        from .books import BooksClient
        from .photos import PhotosClient
        from .covers import CoversClient
        from .contents import ContentsClient
        from .orders import OrdersClient
        from .credits import CreditsClient

        self.books = BooksClient(self)
        self.photos = PhotosClient(self)
        self.covers = CoversClient(self)
        self.contents = ContentsClient(self)
        self.orders = OrdersClient(self)
        self.credits = CreditsClient(self)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": f"BookPrintAPI-Python/{_VERSION}",
            "Idempotency-Key": str(uuid.uuid4()),
        }

    def _url(self, path: str) -> str:
        p = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{p}"

    def _handle_response(self, resp: requests.Response) -> dict | None:
        if not resp.ok:
            raise ApiError.from_response(resp)
        if not resp.text:
            return None
        return resp.json()

    def _request(self, method: str, path: str, **kwargs) -> dict | None:
        try:
            resp = self._session.request(method, self._url(path), timeout=self.timeout, **kwargs)
            return self._handle_response(resp)
        except ApiError:
            raise
        except requests.RequestException as e:
            raise ApiError(f"Network error: {e}", status_code=None) from e

    def get(self, path: str, params: dict | None = None) -> dict | None:
        return self._request("GET", path, headers=self._headers(), params=params)

    def post(self, path: str, payload: dict | None = None) -> dict | None:
        headers = self._headers()
        headers["Content-Type"] = "application/json"
        return self._request("POST", path, headers=headers, json=payload)

    def post_form(self, path: str, data: dict | None = None,
                  files: list[tuple[str, Any]] | None = None,
                  params: dict | None = None) -> dict | None:
        return self._request("POST", path, headers=self._headers(), data=data, files=files, params=params)

    def patch(self, path: str, payload: dict | None = None) -> dict | None:
        headers = self._headers()
        headers["Content-Type"] = "application/json"
        return self._request("PATCH", path, headers=headers, json=payload)

    def delete(self, path: str, params: dict | None = None) -> dict | None:
        return self._request("DELETE", path, headers=self._headers(), params=params)
