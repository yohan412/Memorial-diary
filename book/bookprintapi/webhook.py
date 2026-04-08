"""BookPrintAPI SDK — Webhook 서명 검증"""

from __future__ import annotations

import hashlib
import hmac
import time


def verify_signature(
    payload: str | bytes,
    signature: str,
    timestamp: str | int,
    secret: str,
    *,
    tolerance: int = 300,
) -> bool:
    """웹훅 요청의 HMAC-SHA256 서명을 검증합니다.

    서버가 보내는 헤더:
        X-Webhook-Signature: sha256=abc123...
        X-Webhook-Timestamp: 1710000000

    Args:
        payload: 요청 body (문자열 또는 bytes)
        signature: X-Webhook-Signature 헤더 값 (예: "sha256=abc123...")
        timestamp: X-Webhook-Timestamp 헤더 값 (Unix 초)
        secret: 웹훅 시크릿 키 (whsk_...)
        tolerance: 타임스탬프 허용 오차 (초, 기본 300초=5분). 0이면 시간 검증 생략.

    Returns:
        서명이 유효하면 True

    Raises:
        ValueError: 서명 형식이 잘못되었거나 타임스탬프가 만료된 경우

    Example:
        from bookprintapi.webhook import verify_signature

        # Flask
        @app.route('/webhook', methods=['POST'])
        def handle_webhook():
            sig = request.headers.get('X-Webhook-Signature', '')
            ts = request.headers.get('X-Webhook-Timestamp', '')
            if not verify_signature(request.data, sig, ts, WEBHOOK_SECRET):
                abort(400)
            event = request.json
            print(f"이벤트: {event['event_type']}")

        # FastAPI
        @app.post('/webhook')
        async def handle_webhook(request: Request):
            body = await request.body()
            sig = request.headers.get('X-Webhook-Signature', '')
            ts = request.headers.get('X-Webhook-Timestamp', '')
            if not verify_signature(body, sig, ts, WEBHOOK_SECRET):
                raise HTTPException(400)
            event = await request.json()
    """
    if isinstance(payload, str):
        payload = payload.encode("utf-8")

    # sha256= 접두사 제거
    sig_hash = signature
    if sig_hash.startswith("sha256="):
        sig_hash = sig_hash[7:]

    if not sig_hash:
        raise ValueError("Invalid signature: empty")

    # 타임스탬프 검증
    ts = str(timestamp)
    if tolerance > 0:
        try:
            ts_int = int(ts)
        except ValueError:
            raise ValueError(f"Invalid timestamp: {ts}")
        if abs(time.time() - ts_int) > tolerance:
            raise ValueError(f"Timestamp expired. Tolerance: {tolerance}s")

    # HMAC-SHA256: "{timestamp}.{payload}" 로 서명
    signed_payload = f"{ts}.".encode("utf-8") + payload
    expected = hmac.new(
        secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected, sig_hash)
