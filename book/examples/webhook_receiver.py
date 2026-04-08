#!/usr/bin/env python3
"""
BookPrintAPI SDK — Webhook Receiver Example

웹훅 이벤트를 수신하고 서명을 검증하는 Flask 서버 예제입니다.

설치:
    pip install flask python-dotenv

실행:
    python webhook_receiver.py

테스트 (별도 터미널):
    BookPrintAPI 웹사이트에서 웹훅 URL을 등록하고 테스트 이벤트를 전송하세요.
    또는 API로 테스트: POST /webhooks/test { "eventType": "order.created" }

환경변수:
    WEBHOOK_SECRET      웹훅 시크릿 키 (whsk_..., 웹훅 등록 시 발급됨)
    WEBHOOK_PORT        수신 포트 (기본: 5000)
"""

import sys
import os
import io
import json
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, abort, jsonify
from bookprintapi.webhook import verify_signature

app = Flask(__name__)

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
if not WEBHOOK_SECRET:
    print("WARNING: WEBHOOK_SECRET 미설정. .env에 추가하세요.")


@app.route("/webhook", methods=["POST"])
def handle_webhook():
    """웹훅 이벤트 수신 엔드포인트"""

    # 1. 헤더 추출
    signature = request.headers.get("X-Webhook-Signature", "")
    timestamp = request.headers.get("X-Webhook-Timestamp", "")
    event_type = request.headers.get("X-Webhook-Event", "")
    delivery_uid = request.headers.get("X-Webhook-Delivery", "")

    body = request.get_data()

    # 2. 서명 검증
    if WEBHOOK_SECRET:
        try:
            valid = verify_signature(body, signature, timestamp, WEBHOOK_SECRET)
            if not valid:
                print(f"[REJECT] 서명 불일치: {delivery_uid}")
                abort(401)
        except ValueError as e:
            print(f"[REJECT] 서명 검증 실패: {e}")
            abort(400)
    else:
        print("[WARN] WEBHOOK_SECRET 미설정, 서명 검증 건너뜀")

    # 3. 이벤트 처리
    event = request.json
    now = datetime.now().strftime("%H:%M:%S")

    print(f"\n{'='*60}")
    print(f"[{now}] 웹훅 수신: {event_type}")
    print(f"  Delivery: {delivery_uid}")
    print(f"  Timestamp: {timestamp}")

    # 이벤트 타입별 처리
    data = event.get("data", {})

    if event_type == "order.created":
        print(f"  주문 생성: {data.get('order_uid')}")
        print(f"  금액: {data.get('total_amount')}원, 항목: {data.get('item_count')}건")

    elif event_type == "order.cancelled":
        print(f"  주문 취소: {data.get('order_uid')}")
        print(f"  사유: {data.get('cancel_reason')}")
        print(f"  환불: {data.get('refund_amount')}원")

    elif event_type == "production.confirmed":
        print(f"  제작 확정: {data.get('order_uid')}")
        print(f"  출력일: {data.get('print_day')}")

    elif event_type == "production.started":
        print(f"  제작 시작: {data.get('order_uid')}")

    elif event_type == "production.completed":
        print(f"  제작 완료: {data.get('order_uid')}")

    elif event_type == "shipping.departed":
        print(f"  발송: {data.get('order_uid')}")
        print(f"  송장: {data.get('tracking_carrier')} {data.get('tracking_number')}")

    elif event_type == "shipping.delivered":
        print(f"  배송 완료: {data.get('order_uid')}")

    else:
        print(f"  (알 수 없는 이벤트)")
        print(f"  데이터: {json.dumps(data, ensure_ascii=False)[:200]}")

    print(f"{'='*60}")

    # 4. 200 응답 (필수 — 200이 아니면 서버가 재시도함)
    return jsonify({"received": True}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.getenv("WEBHOOK_PORT", "5000"))
    print(f"웹훅 수신 서버 시작: http://localhost:{port}/webhook")
    print(f"시크릿: {'설정됨' if WEBHOOK_SECRET else '미설정 (검증 안 함)'}")
    print(f"이벤트: order.created, order.cancelled, production.*, shipping.*")
    print()
    app.run(host="0.0.0.0", port=port, debug=True)
