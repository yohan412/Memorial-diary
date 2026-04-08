#!/usr/bin/env python3
"""
BookPrintAPI SDK — Server Pipeline Example

파트너 서버에서 백그라운드로 책을 생성하고 주문하는 파이프라인 예제입니다.
실제 서비스에서는 이 로직을 큐(Celery, RQ 등)나 스케줄러에서 실행합니다.

사용법:
    python server_pipeline.py

흐름:
    1. 충전금 확인
    2. 책 생성 (draft)
    3. 표지 생성
    4. 내지 페이지 삽입 (반복)
    5. 최소 페이지 확인 + 빈내지 패딩
    6. 발행면 삽입
    7. 책 확정 (finalize)
    8. 가격 견적
    9. 주문 생성
   10. 주문 상태 확인

환경변수:
    BOOKPRINT_API_KEY   API Key (필수)
    BOOKPRINT_BASE_URL  API 서버 URL
"""

import sys
import os
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from bookprintapi import Client, ApiError

# ── 설정 ──
# 실제 서비스에서는 이 값들을 DB나 설정 파일에서 가져옵니다.
BOOK_SPEC = "SQUAREBOOK_HC"
MIN_PAGES = 24

# 일기장A 템플릿 UIDs (예시)
TPL_COVER = "79yjMH3qRPly"
TPL_GANJI = "5M3oo7GlWKGO"
TPL_NAEJI = "5B4ds6i0Rywx"       # 텍스트 전용 내지
TPL_PUBLISH = "5nhOVBjTnIVE"
TPL_BLANK = "2mi1ao0Z4Vxl"

# 샘플 데이터 (실제로는 DB에서 조회)
SAMPLE_ENTRIES = [
    {"month": "1", "day": str(d), "text": f"1월 {d}일의 일기입니다. 오늘도 좋은 하루였습니다."}
    for d in range(1, 16)
]

SHIPPING = {
    "recipientName": "홍길동",
    "recipientPhone": "010-1234-5678",
    "postalCode": "06100",
    "address1": "서울특별시 강남구 테헤란로 123",
    "address2": "4층",
    "memo": "부재 시 경비실",
}


def log(step, msg):
    print(f"  [{step}] {msg}")


def run_pipeline():
    client = Client()  # .env에서 키/URL 로드

    print("=" * 60)
    print("  BookPrintAPI 서버 파이프라인")
    print("=" * 60)

    # 1. 충전금 확인
    log("1", "충전금 확인...")
    credit = client.credits.get_balance()
    balance = credit["data"]["balance"]
    log("1", f"잔액: {balance:,.0f}원")
    if balance <= 0:
        log("1", "충전금 부족! 파이프라인 중단.")
        return

    # 2. 책 생성
    log("2", "책 생성...")
    book = client.books.create(
        book_spec_uid=BOOK_SPEC,
        title="서버 파이프라인 테스트",
        creation_type="TEST",
        external_ref="PIPELINE-001",
    )
    book_uid = book["data"]["bookUid"]
    log("2", f"bookUid: {book_uid}")

    # 3. 표지
    # 3a. 표지 사진 업로드
    log("3", "표지 사진 업로드...")
    sample_photo = os.path.join(os.path.dirname(__file__), "sample_photo.jpg")
    upload = client.photos.upload(book_uid, sample_photo)
    photo_name = upload["data"]["fileName"]
    log("3", f"업로드 완료: {photo_name}")

    # 3b. 표지 생성
    log("3", "표지 생성...")
    client.covers.create(book_uid,
        template_uid=TPL_COVER,
        parameters={"title": "나의 일기장", "dateRange": "2026.01 - 2026.01",
                     "coverPhoto": photo_name},
    )
    log("3", "표지 완료")
    time.sleep(0.5)

    # 4. 간지 + 내지
    log("4", "내지 삽입 시작...")

    # 간지
    client.contents.insert(book_uid, template_uid=TPL_GANJI,
        parameters={"year": "2026", "monthTitle": "1월", "chapterNum": "1", "season_title": "겨울"})
    log("4", "간지 삽입")
    time.sleep(0.5)

    # 내지 (텍스트)
    for i, entry in enumerate(SAMPLE_ENTRIES):
        client.contents.insert(book_uid, template_uid=TPL_NAEJI,
            parameters={"monthNum": entry["month"], "dayNum": entry["day"], "diaryText": entry["text"]})
        log("4", f"내지 {i+1}/{len(SAMPLE_ENTRIES)}")
        time.sleep(0.5)

    # 5. 빈내지 패딩
    # 간지(2p) + 내지15개(15p) = 17p → 최소24p까지 빈내지 추가 + 발행면(1p) 여유
    padding_needed = 6  # 24 - 17 - 1(발행면) = 6p
    log("5", f"빈내지 {padding_needed}장 추가...")
    for i in range(padding_needed):
        client.contents.insert(book_uid, template_uid=TPL_BLANK, break_before="page")
        log("5", f"빈내지 {i+1}/{padding_needed}")
        time.sleep(0.5)

    # 6. 발행면
    log("6", "발행면 삽입...")
    client.contents.insert(book_uid, template_uid=TPL_PUBLISH,
        parameters={"title": "나의 일기장", "publishDate": "2026.03.16", "author": "홍길동"})
    log("6", "발행면 완료")
    time.sleep(0.5)

    # 7. 확정 (페이지 부족 시 빈내지 추가 후 재시도)
    log("7", "책 확정...")
    for attempt in range(5):
        try:
            fin = client.books.finalize(book_uid)
            final_pages = fin["data"].get("pageCount", "?")
            log("7", f"확정 완료! {final_pages}p")
            break
        except ApiError as e:
            if "최소 페이지 미달" in str(e.details):
                log("7", f"페이지 부족 — 빈내지 4장 추가 후 재시도 ({attempt+1})")
                for _ in range(4):
                    client.contents.insert(book_uid, template_uid=TPL_BLANK, break_before="page")
                    time.sleep(0.5)
            else:
                raise

    # 8. 견적
    log("8", "가격 견적...")
    estimate = client.orders.estimate([{"bookUid": book_uid, "quantity": 1}])
    est = estimate["data"]
    paid = est["paidCreditAmount"]
    log("8", f"결제금액: {paid:,.0f}원 (VAT 포함)")

    if not est.get("creditSufficient", False):
        log("8", "충전금 부족! 주문 불가.")
        return

    # 9. 주문
    log("9", "주문 생성...")
    order = client.orders.create(
        items=[{"bookUid": book_uid, "quantity": 1}],
        shipping=SHIPPING,
        external_ref="PIPELINE-001",
    )
    order_data = order["data"]
    order_uid = order_data["orderUid"]
    log("9", f"주문번호: {order_uid}")
    log("9", f"결제: {order_data['paidCreditAmount']:,.0f}원")

    # 10. 주문 확인
    log("10", "주문 상태 확인...")
    detail = client.orders.get(order_uid)
    d = detail["data"]
    log("10", f"상태: {d['orderStatusDisplay']} ({d['orderStatus']})")
    log("10", f"수령인: {d['recipientName']}")

    print()
    print("=" * 60)
    print(f"  파이프라인 완료!")
    print(f"  bookUid:  {book_uid}")
    print(f"  orderUid: {order_uid}")
    print(f"  결제금액: {d['paidCreditAmount']:,.0f}원")
    print("=" * 60)

    # 테스트이므로 취소
    print()
    log("cleanup", "테스트 주문 취소 중...")
    client.orders.cancel(order_uid, "파이프라인 테스트 완료")
    credit2 = client.credits.get_balance()
    log("cleanup", f"충전금 복원: {credit2['data']['balance']:,.0f}원")


if __name__ == "__main__":
    try:
        run_pipeline()
    except ApiError as e:
        print(f"\nAPI 오류: {e}")
        if e.details:
            for d in e.details:
                print(f"  - {d}")
    except Exception as e:
        print(f"\n오류: {e}")
        import traceback; traceback.print_exc()
