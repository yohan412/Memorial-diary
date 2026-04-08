#!/usr/bin/env python3
"""
BookPrintAPI SDK — Simple Credits Example

충전금 잔액 조회, 거래 내역, Sandbox 충전을 CLI로 실행합니다.

사용법:
    python simple_credits.py balance                    # 잔액 조회
    python simple_credits.py transactions               # 거래 내역
    python simple_credits.py charge 100000              # Sandbox 충전
    python simple_credits.py charge 50000 "테스트 충전"  # 메모 포함 충전

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


def fmt_amount(amount):
    return f"{amount:,.0f}원" if amount else "0원"


def cmd_balance(args):
    client = Client()
    result = client.credits.get_balance()
    data = result.get("data", result)
    balance = data.get("balance", 0)
    env = data.get("env", "")
    currency = data.get("currency", "KRW")

    print(f"\n  충전금 잔액: {fmt_amount(balance)} ({currency})")
    if env:
        print(f"  환경: {env}")
    print()


def cmd_transactions(args):
    client = Client()
    limit = 30
    if "--limit" in args:
        idx = args.index("--limit")
        limit = int(args[idx + 1]) if idx + 1 < len(args) else 30

    result = client.credits.get_transactions(limit=limit)
    data = result.get("data", result)
    txs = data.get("transactions", []) if isinstance(data, dict) else []
    pagination = data.get("pagination", {}) if isinstance(data, dict) else {}

    if not txs:
        print("거래 내역이 없습니다.")
        return

    print(f"{'일시':<22} {'사유':<20} {'금액':>12} {'잔액':>12} {'메모'}")
    print("-" * 85)
    for tx in txs:
        dt = tx.get("createdAt", "")[:19].replace("T", " ")
        reason = tx.get("reasonDisplay", "") or tx.get("reason", "")
        amount = tx.get("amount", 0)
        balance = tx.get("balanceAfter", 0)
        memo = tx.get("memo", "")
        sign = "+" if amount >= 0 else ""
        print(f"{dt:<22} {reason:<20} {sign}{fmt_amount(amount):>11} {fmt_amount(balance):>12} {memo}")

    total = pagination.get("total", len(txs))
    print(f"\n총 {total}건")


def cmd_charge(args):
    if not args:
        print("사용법: python simple_credits.py charge <금액> [메모]")
        print("  Sandbox 환경에서만 사용 가능합니다.")
        return

    amount = int(args[0])
    memo = " ".join(args[1:]) if len(args) > 1 else None

    if amount <= 0:
        print("충전 금액은 0보다 커야 합니다.")
        return

    client = Client()
    result = client.credits.sandbox_charge(amount, memo=memo)
    data = result.get("data", result)
    balance = data.get("balance", 0)

    print(f"\n  Sandbox 충전 완료!")
    print(f"  충전금액: {fmt_amount(amount)}")
    print(f"  잔액: {fmt_amount(balance)}")
    print()


COMMANDS = {
    "balance": cmd_balance,
    "transactions": cmd_transactions,
    "charge": cmd_charge,
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
