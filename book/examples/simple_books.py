#!/usr/bin/env python3
"""
BookPrintAPI SDK — Simple Books Example

책 목록 조회, 생성, 확정, 삭제를 CLI로 실행합니다.

사용법:
    python simple_books.py list                      # 내 책 목록
    python simple_books.py list --status finalized    # finalized 책만
    python simple_books.py create "나의 포토북"        # 새 책 생성
    python simple_books.py get <bookUid>              # 책 상세
    python simple_books.py finalize <bookUid>         # 책 확정
    python simple_books.py delete <bookUid>           # 책 삭제

환경변수:
    BOOKPRINT_API_KEY   API Key (필수)
    BOOKPRINT_BASE_URL  API 서버 URL (기본: https://api.sweetbook.com/v1)
"""

import sys
import os
import json
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# SDK 경로 추가 (설치 없이 실행 가능)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from bookprintapi import Client, ApiError


def print_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def cmd_list(args):
    client = Client()
    status = None
    if "--status" in args:
        idx = args.index("--status")
        status = args[idx + 1] if idx + 1 < len(args) else None

    result = client.books.list(status=status, limit=50)
    data = result.get("data", result)
    books = data.get("books", []) if isinstance(data, dict) else []
    pagination = data.get("pagination", {}) if isinstance(data, dict) else {}

    if not books:
        print("책이 없습니다.")
        return

    print(f"{'UID':<20} {'상태':<12} {'페이지':<6} {'제목'}")
    print("-" * 70)
    for b in books:
        uid = b.get("bookUid", "")
        title = b.get("title", "(제목 없음)")
        status = b.get("status", "")
        pages = b.get("pageCount", 0)
        print(f"{uid:<20} {status:<12} {pages:<6} {title}")

    total = pagination.get("total", len(books))
    print(f"\n총 {total}권")


def cmd_create(args):
    if not args:
        print("사용법: python simple_books.py create <제목> [--spec SQUAREBOOK_HC] [--type TEST]")
        return

    title = args[0]
    spec = "SQUAREBOOK_HC"
    creation_type = "TEST"

    if "--spec" in args:
        idx = args.index("--spec")
        spec = args[idx + 1] if idx + 1 < len(args) else spec
    if "--type" in args:
        idx = args.index("--type")
        creation_type = args[idx + 1] if idx + 1 < len(args) else creation_type

    client = Client()
    result = client.books.create(book_spec_uid=spec, title=title, creation_type=creation_type)
    data = result.get("data", result)
    book_uid = data.get("bookUid", "") if isinstance(data, dict) else ""
    print(f"책 생성 완료: {book_uid}")
    print_json(data)


def cmd_get(args):
    if not args:
        print("사용법: python simple_books.py get <bookUid>")
        return

    client = Client()
    result = client.books.get(args[0])
    print_json(result.get("data", result))


def cmd_finalize(args):
    if not args:
        print("사용법: python simple_books.py finalize <bookUid>")
        return

    client = Client()
    result = client.books.finalize(args[0])
    print_json(result.get("data", result))
    print("책 확정 완료!")


def cmd_delete(args):
    if not args:
        print("사용법: python simple_books.py delete <bookUid>")
        return

    client = Client()
    client.books.delete(args[0])
    print(f"삭제 완료: {args[0]}")


COMMANDS = {
    "list": cmd_list,
    "create": cmd_create,
    "get": cmd_get,
    "finalize": cmd_finalize,
    "delete": cmd_delete,
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
