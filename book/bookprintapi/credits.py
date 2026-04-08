"""BookPrintAPI SDK — Credits (충전금)"""

from __future__ import annotations
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import Client


class CreditsClient:
    """충전금 잔액/거래내역 조회, Sandbox 충전"""

    def __init__(self, client: Client):
        self._client = client

    def get_balance(self) -> dict:
        """충전금 잔액 조회"""
        return self._client.get("/credits")

    def get_transactions(self, *, limit: int = 20, offset: int = 0,
                         from_date: str | None = None, to_date: str | None = None) -> dict:
        """충전금 거래 내역 조회"""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        return self._client.get("/credits/transactions", params=params)

    def sandbox_charge(self, amount: int, memo: str | None = None) -> dict:
        """Sandbox 테스트 충전 (env=test 전용, 계정 자동 생성)

        Args:
            amount: 충전 금액 (원)
            memo: 메모
        """
        payload: dict[str, Any] = {"amount": amount}
        if memo:
            payload["memo"] = memo
        return self._client.post("/credits/sandbox/charge", payload=payload)
