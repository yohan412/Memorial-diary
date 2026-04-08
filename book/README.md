# BookPrintAPI Python SDK

포토북 생성/주문을 위한 BookPrintAPI Python SDK입니다.

> **이 SDK로 할 수 있는 것**: 포토북 생성 → 표지/내지 구성 → 주문 → 배송 추적

---

## 설치

```bash
pip install -e .
```

또는 설치 없이 바로 사용:

```python
import sys; sys.path.insert(0, "/path/to/bookprintapi-python-sdk")
from bookprintapi import Client
```

**의존성**: `requests`, `python-dotenv` (Python 3.10+)

---

## 빠른 시작

### 1. API Key 설정

```bash
cp .env.example .env
```

`.env` 파일에 API Key를 입력하세요:

```
BOOKPRINT_API_KEY=SBxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BOOKPRINT_BASE_URL=https://api-sandbox.sweetbook.com/v1
```

> API Key는 BookPrintAPI 웹사이트에서 발급받을 수 있습니다.
> Sandbox 테스트 시 `api-sandbox.sweetbook.com`을, 운영 시 `api.sweetbook.com`을 사용하세요.

### 2. 첫 번째 코드

```python
from bookprintapi import Client

client = Client()  # .env에서 API Key 자동 로드

# 내 책 목록 조회
result = client.books.list(status="finalized")
print(result)
```

---

## 전체 흐름: 책 생성부터 주문까지

```
1. 책 생성 (draft)          client.books.create(...)
2. 사진 업로드              client.photos.upload(...)
3. 표지 생성                client.covers.create(...)
4. 내지 페이지 삽입          client.contents.insert(...)  (반복)
5. 책 확정 (finalized)      client.books.finalize(...)
6. 가격 견적                client.orders.estimate(...)
7. 주문 생성                client.orders.create(...)     ← 충전금 차감
8. 주문 상태 확인            client.orders.get(...)
```

### 전체 예시

```python
from bookprintapi import Client

client = Client()

# 1. 책 생성
book = client.books.create(
    book_spec_uid="SQUAREBOOK_HC",
    title="우리 가족 앨범",
    creation_type="TEST"
)
book_uid = book["data"]["bookUid"]
print(f"책 생성: {book_uid}")

# 2. 사진 업로드
client.photos.upload(book_uid, "photo1.jpg")
client.photos.upload(book_uid, "photo2.jpg")

# 3. 표지 생성
client.covers.create(book_uid,
    template_uid="COVER_TEMPLATE_UID",
    parameters={"title": "우리 가족 앨범", "frontPhoto": "photo1.jpg"}
)

# 4. 내지 페이지 삽입
client.contents.insert(book_uid,
    template_uid="CONTENT_TEMPLATE_UID",
    parameters={"photo": "photo2.jpg", "text": "즐거운 하루"}
)

# 5. 책 확정
client.books.finalize(book_uid)
print("책 확정 완료!")

# 6. 가격 견적
estimate = client.orders.estimate([{"bookUid": book_uid, "quantity": 1}])
paid = estimate["data"]["paidCreditAmount"]
print(f"결제 금액: {paid:,.0f}원 (VAT 포함)")

# 7. 주문
order = client.orders.create(
    items=[{"bookUid": book_uid, "quantity": 1}],
    shipping={
        "recipientName": "홍길동",
        "recipientPhone": "010-1234-5678",
        "postalCode": "06100",
        "address1": "서울특별시 강남구 테헤란로 123",
        "address2": "4층",
        "memo": "부재 시 경비실"
    },
    external_ref="MY-ORDER-001"
)
order_uid = order["data"]["orderUid"]
print(f"주문 완료: {order_uid}")

# 8. 주문 상태 확인
detail = client.orders.get(order_uid)
print(f"상태: {detail['data']['orderStatusDisplay']}")
```

---

## SDK 구조

```python
client = Client(api_key="SBxxxxx.xxxx")

client.books       # 책 생성/조회/확정/삭제
client.photos      # 사진 업로드/조회/삭제
client.covers      # 표지 생성/조회/삭제
client.contents    # 내지 삽입/삭제
client.orders      # 주문 생성/조회/취소/배송지변경
client.credits     # 충전금 잔액/거래내역/Sandbox충전
```

---

## API 레퍼런스

### Books

```python
# 목록 조회
client.books.list(status="finalized", limit=20, offset=0)

# 생성
client.books.create(book_spec_uid="SQUAREBOOK_HC", title="제목", creation_type="TEST")

# 상세 조회
client.books.get("bk_xxxx")

# 확정 (이후 내용 수정 불가)
client.books.finalize("bk_xxxx")

# 삭제 (draft만 가능)
client.books.delete("bk_xxxx")
```

### Photos

```python
# 업로드 (1장)
client.photos.upload("bk_xxxx", "image.jpg")

# 업로드 (여러 장)
client.photos.upload_multiple("bk_xxxx", ["img1.jpg", "img2.jpg"])

# 목록
client.photos.list("bk_xxxx")

# 삭제
client.photos.delete("bk_xxxx", "photo250105143052123.JPG")
```

### Covers

```python
# 표지 생성 (파라미터에 사진 URL 또는 업로드 파일명 지정)
client.covers.create("bk_xxxx",
    template_uid="tpl_cover001",
    parameters={"title": "My Book", "frontPhoto": "$upload"},
    files=["cover.jpg"]
)

# 조회 / 삭제
client.covers.get("bk_xxxx")
client.covers.delete("bk_xxxx")
```

### Contents

```python
# 내지 페이지 삽입
client.contents.insert("bk_xxxx",
    template_uid="tpl_content001",
    parameters={"date": "2026-01-01", "diary_text": "오늘의 일기"},
    break_before="page"   # "page": 새 페이지부터 시작
)

# 전체 내지 삭제 (표지 유지)
client.contents.clear("bk_xxxx")
```

### Orders

```python
# 견적 (충전금 차감 없음)
client.orders.estimate([{"bookUid": "bk_xxxx", "quantity": 1}])

# 주문 생성 (충전금 즉시 차감)
client.orders.create(
    items=[{"bookUid": "bk_xxxx", "quantity": 1}],
    shipping={
        "recipientName": "홍길동",
        "recipientPhone": "010-1234-5678",
        "postalCode": "06100",
        "address1": "서울특별시 강남구 테헤란로 123",
    },
    external_ref="MY-ORDER-001"
)

# 묶음 주문 (여러 책을 한 번에)
client.orders.create(
    items=[
        {"bookUid": "bk_xxxx", "quantity": 1},
        {"bookUid": "bk_yyyy", "quantity": 2},
    ],
    shipping={...}
)

# 목록 / 상세
client.orders.list(status=20)
client.orders.get("or_xxxxxxxxxxxx")

# 취소 (PAID/PDF_READY 상태만, 충전금 자동 반환)
client.orders.cancel("or_xxxxxxxxxxxx", "주문 취소합니다")

# 배송지 변경 (발송 전, 변경할 필드만)
client.orders.update_shipping("or_xxxxxxxxxxxx", recipient_phone="010-9999-8888")
```

### Credits (충전금)

```python
# 잔액 조회
client.credits.get_balance()

# 거래 내역
client.credits.get_transactions(limit=50)

# Sandbox 테스트 충전 (sandbox 환경 전용)
client.credits.sandbox_charge(100000, memo="테스트 충전")
```

---

## 주문 상태

| 상태 | 코드 | 설명 | 취소 | 배송지변경 |
|------|:----:|------|:----:|:--------:|
| PAID | 20 | 결제 완료 | O | O |
| PDF_READY | 25 | PDF 생성 완료 | O | O |
| CONFIRMED | 30 | 제작 확정 | X | O |
| IN_PRODUCTION | 40 | 인쇄 중 | X | X |
| PRODUCTION_COMPLETE | 50 | 인쇄 완료 | X | X |
| SHIPPED | 60 | 발송 완료 | X | X |
| DELIVERED | 70 | 배송 완료 | X | X |
| CANCELLED | 80/81 | 취소됨 | - | - |

```
PAID → PDF_READY → CONFIRMED → IN_PRODUCTION → PRODUCTION_COMPLETE → SHIPPED → DELIVERED
```

---

## 가격 계산

```
상품금액 = 단가 × 수량
합계     = 상품금액 + 배송비(3,000원)
결제금액 = Floor(합계 × 1.1 / 10) × 10   ← VAT 10% 포함, 10원 미만 절삭
```

> 정확한 금액은 `client.orders.estimate()`로 사전 확인하세요.

---

## 에러 처리

```python
from bookprintapi import Client, ApiError

client = Client()

try:
    client.orders.create(
        items=[{"bookUid": "bk_invalid", "quantity": 1}],
        shipping={...}
    )
except ApiError as e:
    print(f"오류: {e}")                 # [400] Bad Request
    print(f"상태코드: {e.status_code}")  # 400
    print(f"상세: {e.details}")          # ["Book을 찾을 수 없습니다: bk_invalid"]

    # 충전금 부족 시
    if e.status_code == 402:
        print("충전금이 부족합니다. 충전 후 다시 시도하세요.")
```

---

## 환경 설정

### 방법 1: `environment` 파라미터 (권장)

```python
# Sandbox
client = Client(api_key="SBxxxxx.xxxx", environment="sandbox")

# Live (기본값)
client = Client(api_key="SBxxxxx.xxxx")
```

### 방법 2: 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `BOOKPRINT_API_KEY` | API Key (필수) | - |
| `BOOKPRINT_ENV` | `sandbox` 또는 `live` | `live` |
| `BOOKPRINT_BASE_URL` | API URL 직접 지정 (위 두 변수보다 우선) | - |

| 환경 | URL |
|------|-----|
| Live | `https://api.sweetbook.com/v1` |
| Sandbox | `https://api-sandbox.sweetbook.com/v1` |

> Sandbox에서 생성한 주문은 실제 인쇄/배송되지 않습니다. 테스트 충전금으로 자유롭게 테스트하세요.

---

## 예제 CLI로 테스트하기

`examples/` 폴더에 3개의 CLI 예제가 있습니다. 아래 순서대로 따라하면 충전 → 책 조회 → 견적 → 주문 → 확인 → 취소까지 전체 플로우를 체험할 수 있습니다.

### 준비

```bash
cd examples
cp ../.env.example ../.env
# .env에 API Key 입력, BOOKPRINT_BASE_URL은 sandbox로 설정
```

### Step 1. 충전금 충전 (Sandbox)

```bash
# 잔액 확인
python simple_credits.py balance

# 테스트 충전금 10만원 충전
python simple_credits.py charge 100000

# 거래 내역 확인
python simple_credits.py transactions
```

### Step 2. 내 책 목록 확인

```bash
# finalized 책만 조회 (주문 가능한 책)
python simple_books.py list --status finalized

# 책이 없으면 새로 생성
python simple_books.py create "테스트북" --type TEST
```

### Step 3. 견적 조회

```bash
# bookUid를 Step 2에서 확인한 값으로 교체
python simple_orders.py estimate bk_xxxxxxxxxxxx
```

출력 예시:
```
==================================================
  견적 결과
==================================================
  bk_4NH4AWpcp0vx (26p x 1)  20,300원 x 1 = 20,300원
──────────────────────────────────────────────────
  상품 금액                20,300원
  배송비                    3,000원
  합계 (세전)              23,300원
──────────────────────────────────────────────────
  결제금액 (VAT포함)       25,630원
  현재 충전금             401,000원
  결제 후 잔액            375,370원
==================================================
```

### Step 4. 주문 생성

```bash
python simple_orders.py create bk_xxxxxxxxxxxx \
  --name "홍길동" \
  --phone "010-1234-5678" \
  --postal "06100" \
  --addr1 "서울특별시 강남구 테헤란로 123" \
  --ref "MY-TEST-001"
```

출력 예시:
```
주문 생성 완료!
  주문번호: or_25ENPqM4bDxX
  결제금액: 25,630원
  충전금 잔액: 375,370원
```

### Step 5. 주문 확인

```bash
# 주문 목록
python simple_orders.py list

# 주문 상세
python simple_orders.py get or_25ENPqM4bDxX
```

### Step 6. 주문 취소 (테스트이므로)

```bash
# 취소 (PAID 상태만 가능, 충전금 자동 반환)
python simple_orders.py cancel or_25ENPqM4bDxX "테스트 주문 취소"

# 충전금 복원 확인
python simple_credits.py balance
```

### 전체 명령어 레퍼런스

```bash
# === simple_books.py ===
python simple_books.py list                         # 전체 책 목록
python simple_books.py list --status finalized       # finalized만
python simple_books.py create "제목"                 # 책 생성
python simple_books.py create "제목" --spec SQUAREBOOK_HC --type TEST
python simple_books.py get <bookUid>                 # 책 상세
python simple_books.py finalize <bookUid>            # 책 확정
python simple_books.py delete <bookUid>              # 책 삭제 (draft만)

# === simple_orders.py ===
python simple_orders.py estimate <bookUid> [수량]    # 견적
python simple_orders.py create <bookUid> [수량]      # 주문 (배송지 입력)
python simple_orders.py list                         # 주문 목록
python simple_orders.py list --status 20             # 상태별 필터
python simple_orders.py get <orderUid>               # 주문 상세
python simple_orders.py cancel <orderUid> "사유"      # 주문 취소
python simple_orders.py shipping <orderUid> --name 홍길동 --phone 010-xxxx  # 배송지 변경

# === simple_credits.py ===
python simple_credits.py balance                     # 잔액 조회
python simple_credits.py transactions                # 거래 내역
python simple_credits.py charge <금액>               # Sandbox 충전
python simple_credits.py charge <금액> "메모"         # 메모 포함 충전
```

---

## 파일 구조

```
bookprintapi-python-sdk/
├── bookprintapi/
│   ├── __init__.py       # Client, ApiError, ResponseParser
│   ├── client.py         # Core HTTP 클라이언트 (인증, 재시도, 에러처리)
│   ├── exceptions.py     # ApiError, ValidationError
│   ├── response.py       # ResponseParser
│   ├── books.py          # 책 생성/조회/확정/삭제
│   ├── photos.py         # 사진 업로드/조회/삭제
│   ├── covers.py         # 표지 생성/조회/삭제
│   ├── contents.py       # 내지 삽입/삭제
│   ├── orders.py         # 주문 생성/조회/취소/배송지변경
│   └── credits.py        # 충전금 잔액/거래내역/Sandbox충전
│   └── webhook.py        # 웹훅 서명 검증 유틸
├── examples/
│   ├── simple_books.py   # 책 CLI (list, create, get, finalize, delete)
│   ├── simple_orders.py  # 주문 CLI (estimate, create, list, get, cancel, shipping)
│   └── simple_credits.py # 충전금 CLI (balance, transactions, charge)
├── .env.example          # 환경변수 템플릿
├── pyproject.toml        # 패키지 설정
└── README.md
```
