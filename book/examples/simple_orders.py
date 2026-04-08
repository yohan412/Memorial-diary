#!/usr/bin/env python3
"""
BookPrintAPI SDK — Simple Orders Example

주문 견적, 생성, 조회, 취소를 CLI로 실행합니다.

사용법:
    python simple_orders.py estimate <bookUid> [quantity]           # 견적
    python simple_orders.py create <bookUid> [quantity]             # 주문 생성
    python simple_orders.py list                                    # 주문 목록
    python simple_orders.py list --status 20                        # 상태별 필터
    python simple_orders.py get <orderUid>                          # 주문 상세
    python simple_orders.py cancel <orderUid> <사유>                # 주문 취소
    python simple_orders.py shipping <orderUid> --name 홍길동       # 배송지 변경

환경변수:
    BOOKPRINT_API_KEY   API Key (필수)
    BOOKPRINT_BASE_URL  API 서버 URL (기본: https://api.sweetbook.com/v1)
"""

import sys
import os
import json
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from bookprintapi import Client, ApiError

STATUS_NAMES = {
    20: "PAID", 25: "PDF_READY", 30: "CONFIRMED", 40: "IN_PRODUCTION",
    45: "COMPLETED", 50: "PRODUCTION_COMPLETE", 60: "SHIPPED",
    70: "DELIVERED", 80: "CANCELLED", 81: "CANCELLED_REFUND",
}


def print_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def fmt_amount(amount):
    return f"{amount:,.0f}원" if amount else "0원"


def cmd_estimate(args):
    if not args:
        print("사용법: python simple_orders.py estimate <bookUid> [quantity]")
        return

    book_uid = args[0]
    quantity = int(args[1]) if len(args) > 1 else 1

    client = Client()
    result = client.orders.estimate([{"bookUid": book_uid, "quantity": quantity}])
    data = result.get("data", result)

    print(f"\n{'='*50}")
    print(f"  견적 결과")
    print(f"{'='*50}")

    for item in data.get("items", []):
        uid = item.get("bookUid", "")
        pages = item.get("pageCount", 0)
        qty = item.get("quantity", 1)
        unit = item.get("unitPrice", 0)
        amt = item.get("itemAmount", 0)
        print(f"  {uid} ({pages}p x {qty})  {fmt_amount(unit)} x {qty} = {fmt_amount(amt)}")

    print(f"{'─'*50}")
    print(f"  상품 금액        {fmt_amount(data.get('productAmount', 0)):>15}")
    print(f"  배송비           {fmt_amount(data.get('shippingFee', 0)):>15}")
    pack = data.get("packagingFee", 0)
    if pack > 0:
        print(f"  포장비           {fmt_amount(pack):>15}")
    print(f"  합계 (세전)      {fmt_amount(data.get('totalAmount', 0)):>15}")
    print(f"{'─'*50}")
    paid = data.get("paidCreditAmount", 0)
    balance = data.get("creditBalance", 0)
    sufficient = data.get("creditSufficient", False)
    print(f"  결제금액 (VAT포함) {fmt_amount(paid):>13}")
    print(f"  현재 충전금        {fmt_amount(balance):>13}")
    print(f"  결제 후 잔액       {fmt_amount(balance - paid):>13} {'' if sufficient else '⚠ 잔액 부족!'}")
    print(f"{'='*50}\n")


def cmd_create(args):
    if not args:
        print("사용법: python simple_orders.py create <bookUid> [quantity]")
        print("       --name 수령인 --phone 전화번호 --postal 우편번호 --addr1 주소")
        return

    book_uid = args[0]
    quantity = int(args[1]) if len(args) > 1 and not args[1].startswith("--") else 1

    def get_arg(flag, default=""):
        if flag in args:
            idx = args.index(flag)
            return args[idx + 1] if idx + 1 < len(args) else default
        return default

    name = get_arg("--name") or input("수령인: ").strip()
    phone = get_arg("--phone") or input("전화번호: ").strip()
    postal = get_arg("--postal") or input("우편번호: ").strip()
    addr1 = get_arg("--addr1") or input("주소1: ").strip()
    addr2 = get_arg("--addr2", "")
    memo = get_arg("--memo", "")
    ref = get_arg("--ref", "")

    if not all([name, phone, postal, addr1]):
        print("수령인, 전화번호, 우편번호, 주소1은 필수입니다.")
        return

    shipping = {
        "recipientName": name,
        "recipientPhone": phone,
        "postalCode": postal,
        "address1": addr1,
    }
    if addr2:
        shipping["address2"] = addr2
    if memo:
        shipping["memo"] = memo

    client = Client()
    result = client.orders.create(
        items=[{"bookUid": book_uid, "quantity": quantity}],
        shipping=shipping,
        external_ref=ref or None,
    )
    data = result.get("data", result)
    order_uid = data.get("orderUid", "")
    paid = data.get("paidCreditAmount", 0)
    balance_after = data.get("creditBalanceAfter")

    print(f"\n주문 생성 완료!")
    print(f"  주문번호: {order_uid}")
    print(f"  결제금액: {fmt_amount(paid)}")
    if balance_after is not None:
        print(f"  충전금 잔액: {fmt_amount(balance_after)}")


def cmd_list(args):
    client = Client()
    status = None
    if "--status" in args:
        idx = args.index("--status")
        status = int(args[idx + 1]) if idx + 1 < len(args) else None

    result = client.orders.list(limit=30, status=status)
    data = result.get("data", result)
    orders = data.get("orders", []) if isinstance(data, dict) else []
    pagination = data.get("pagination", {}) if isinstance(data, dict) else {}

    if not orders:
        print("주문이 없습니다.")
        return

    print(f"{'주문번호':<18} {'상태':<20} {'항목':<4} {'결제금액':>12} {'수령인':<10} {'주문일'}")
    print("-" * 90)
    for o in orders:
        uid = o.get("orderUid", "")
        st = o.get("orderStatus", 0)
        st_name = o.get("orderStatusDisplay", "") or STATUS_NAMES.get(st, str(st))
        items = o.get("itemCount", 0)
        paid = o.get("paidCreditAmount", 0)
        name = o.get("recipientName", "")
        dt = o.get("orderedAt", "")[:10]
        print(f"{uid:<18} {st_name:<20} {items:<4} {fmt_amount(paid):>12} {name:<10} {dt}")

    total = pagination.get("total", len(orders))
    print(f"\n총 {total}건")


def cmd_get(args):
    if not args:
        print("사용법: python simple_orders.py get <orderUid>")
        return

    client = Client()
    result = client.orders.get(args[0])
    data = result.get("data", result)

    st = data.get("orderStatus", 0)
    st_name = data.get("orderStatusDisplay", "") or STATUS_NAMES.get(st, str(st))

    print(f"\n{'='*50}")
    print(f"  주문 상세: {data.get('orderUid', '')}")
    print(f"{'='*50}")
    print(f"  상태: {st_name} ({st})")
    print(f"  유형: {data.get('orderType', '')}")
    print(f"  외부참조: {data.get('externalRef', '-')}")
    print(f"  주문일: {data.get('orderedAt', '')}")

    print(f"\n  [금액]")
    print(f"  상품금액: {fmt_amount(data.get('totalProductAmount', 0))}")
    print(f"  배송비: {fmt_amount(data.get('totalShippingFee', 0))}")
    print(f"  합계: {fmt_amount(data.get('totalAmount', 0))}")
    print(f"  결제금액: {fmt_amount(data.get('paidCreditAmount', 0))}")

    print(f"\n  [배송지]")
    print(f"  {data.get('recipientName', '')} / {data.get('recipientPhone', '')}")
    print(f"  [{data.get('postalCode', '')}] {data.get('address1', '')} {data.get('address2', '')}")
    if data.get("trackingNumber"):
        print(f"  송장: {data.get('trackingCarrier', '')} {data.get('trackingNumber', '')}")

    items = data.get("items", [])
    if items:
        print(f"\n  [항목] ({len(items)}건)")
        for it in items:
            it_st = it.get("itemStatus", 0)
            it_name = it.get("itemStatusDisplay", "") or STATUS_NAMES.get(it_st, str(it_st))
            title = it.get("bookTitle", "") or it.get("bookUid", "")
            print(f"    {title} | {it.get('pageCount', 0)}p x {it.get('quantity', 1)} | "
                  f"{fmt_amount(it.get('itemAmount', 0))} | {it_name}")

    print(f"{'='*50}\n")


def cmd_cancel(args):
    if len(args) < 2:
        print("사용법: python simple_orders.py cancel <orderUid> <취소사유>")
        return

    order_uid = args[0]
    reason = " ".join(args[1:])

    client = Client()
    result = client.orders.cancel(order_uid, reason)
    data = result.get("data", result)
    refund = data.get("refundAmount", 0)
    print(f"주문 취소 완료: {order_uid}")
    if refund:
        print(f"환불 금액: {fmt_amount(refund)}")


def cmd_shipping(args):
    if not args:
        print("사용법: python simple_orders.py shipping <orderUid> --name 홍길동 --phone 010-xxxx")
        return

    order_uid = args[0]
    rest = args[1:]

    def get_arg(flag):
        if flag in rest:
            idx = rest.index(flag)
            return rest[idx + 1] if idx + 1 < len(rest) else None
        return None

    kwargs = {}
    mapping = {
        "--name": "recipient_name",
        "--phone": "recipient_phone",
        "--postal": "postal_code",
        "--addr1": "address1",
        "--addr2": "address2",
        "--memo": "shipping_memo",
    }
    for flag, key in mapping.items():
        val = get_arg(flag)
        if val:
            kwargs[key] = val

    if not kwargs:
        print("변경할 항목을 지정하세요: --name, --phone, --postal, --addr1, --addr2, --memo")
        return

    client = Client()
    client.orders.update_shipping(order_uid, **kwargs)
    print(f"배송지 변경 완료: {order_uid}")
    for k, v in kwargs.items():
        print(f"  {k}: {v}")


COMMANDS = {
    "estimate": cmd_estimate,
    "create": cmd_create,
    "list": cmd_list,
    "get": cmd_get,
    "cancel": cmd_cancel,
    "shipping": cmd_shipping,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        print("Commands:", ", ".join(COMMANDS.keys()))
        return

    cmd = sys.argv[1]
    if cmd not in COMMANDS:
        print(f"알 수 없는 명령: {cmd}")
        print("Commands:", ", ".join(COMMANDS.keys()))
        sys.exit(1)

    try:
        COMMANDS[cmd](sys.argv[2:])
    except ApiError as e:
        print(f"API 오류: {e}")
        if e.details:
            for d in e.details:
                print(f"  - {d}")
        sys.exit(1)
    except Exception as e:
        print(f"오류: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
