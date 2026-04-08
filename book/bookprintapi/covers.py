"""BookPrintAPI SDK — Covers"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import Client


class CoversClient:
    """책 표지 생성/조회/삭제"""

    def __init__(self, client: Client):
        self._client = client

    def create(self, book_uid: str, *, template_uid: str,
               parameters: dict[str, Any] | None = None,
               files: list[str] | None = None) -> dict:
        """표지 생성/수정

        Args:
            book_uid: 책 UID
            template_uid: 표지 템플릿 UID
            parameters: 템플릿 파라미터 (제목, 사진URL/파일명 등)
            files: 업로드할 이미지 파일 경로 목록 ($upload 플레이스홀더와 매칭)
        """
        multipart = [
            ("templateUid", (None, template_uid)),
            ("parameters", (None, json.dumps(parameters or {}, ensure_ascii=False))),
        ]

        opened = []
        if files:
            for path in files:
                f = open(path, "rb")
                opened.append(f)
                multipart.append(("files", (os.path.basename(path), f, "image/jpeg")))

        try:
            return self._client.post_form(f"/Books/{book_uid}/cover", files=multipart)
        finally:
            for f in opened:
                f.close()

    def get(self, book_uid: str) -> dict:
        """표지 정보 조회"""
        return self._client.get(f"/Books/{book_uid}/cover")

    def delete(self, book_uid: str) -> dict | None:
        """표지 삭제"""
        return self._client.delete(f"/Books/{book_uid}/cover")
