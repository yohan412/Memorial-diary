"""BookPrintAPI SDK — Response Parser"""

from __future__ import annotations
from typing import Any


class ResponseParser:
    """API 응답 파싱 유틸리티"""

    def __init__(self, body: dict | None):
        self._body = body or {}

    @property
    def raw(self) -> dict:
        return self._body

    def get_data(self) -> Any:
        return self._body.get("data", self._body)

    def get_dict(self) -> dict:
        d = self.get_data()
        return d if isinstance(d, dict) else {}

    def get_list(self) -> list:
        d = self.get_data()
        return d if isinstance(d, list) else []

    def get_pagination(self) -> dict:
        d = self.get_data()
        if isinstance(d, dict):
            return d.get("pagination", {})
        return {}

    def get_message(self) -> str:
        return self._body.get("message", "")
