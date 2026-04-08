"""BookPrintAPI SDK — Orders"""

from __future__ import annotations
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import Client


class OrdersClient:
    """주문 생성/조회/취소/배송지 변경"""

    def __init__(self, client: Client):
        self._client = client

    def estimate(self, items: list[dict[str, Any]]) -> dict:
        """가격 견적 (충전금 차감 없음)

        Args:
            items: [{"bookUid": "...", "quantity": 1}, ...]
        """
        return self._client.post("/orders/estimate", payload={"items": items})

    def create(self, *, items: list[dict[str, Any]], shipping: dict[str, Any],
               external_ref: str | None = None) -> dict:
        """주문 생성 (충전금 즉시 차감)

        Args:
            items: [{"bookUid": "...", "quantity": 1}, ...]
            shipping: {"recipientName", "recipientPhone", "postalCode", "address1", "address2"?, "memo"?}
            external_ref: 외부 참조 ID (최대 100자)
        """
        payload: dict[str, Any] = {"items": items, "shipping": shipping}
        if external_ref:
            payload["externalRef"] = external_ref
        return self._client.post("/orders", payload=payload)

    def list(self, *, limit: int = 20, offset: int = 0,
             status: int | None = None,
             from_date: str | None = None, to_date: str | None = None) -> dict:
        """주문 목록 조회

        Args:
            status: 상태 코드 (20=PAID, 25=PDF_READY, 30=CONFIRMED, ...)
            from_date: 시작 일시 (ISO 형식)
            to_date: 종료 일시 (ISO 형식)
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        return self._client.get("/orders", params=params)

    def get(self, order_uid: str) -> dict:
        """주문 상세 조회"""
        return self._client.get(f"/orders/{order_uid}")

    def cancel(self, order_uid: str, cancel_reason: str) -> dict:
        """주문 취소 (PAID / PDF_READY 상태만 가능, 충전금 자동 반환)

        Args:
            order_uid: 주문 UID
            cancel_reason: 취소 사유
        """
        return self._client.post(
            f"/orders/{order_uid}/cancel",
            payload={"cancelReason": cancel_reason},
        )

    def update_shipping(self, order_uid: str, **kwargs) -> dict:
        """배송지 변경 (발송 전 상태만 가능)

        Keyword Args:
            recipient_name: 수령인
            recipient_phone: 전화번호
            postal_code: 우편번호
            address1: 주소1
            address2: 주소2
            shipping_memo: 배송 메모
        """
        field_map = {
            "recipient_name": "recipientName",
            "recipient_phone": "recipientPhone",
            "postal_code": "postalCode",
            "address1": "address1",
            "address2": "address2",
            "shipping_memo": "shippingMemo",
        }
        payload = {}
        for py_key, api_key in field_map.items():
            if py_key in kwargs and kwargs[py_key] is not None:
                payload[api_key] = kwargs[py_key]
        return self._client.patch(f"/orders/{order_uid}/shipping", payload=payload)
