"""BookPrintAPI SDK — Contents"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from .client import Client


class ContentsClient:
    """책 내지(본문) 페이지 삽입/삭제"""

    def __init__(self, client: Client):
        self._client = client

    def insert(self, book_uid: str, *, template_uid: str,
               parameters: dict[str, Any] | None = None,
               files: list[str] | None = None,
               break_before: Literal["page", "spread", "column"] | None = None) -> dict:
        """내지 페이지 삽입

        Args:
            book_uid: 책 UID
            template_uid: 내지 템플릿 UID
            parameters: 템플릿 파라미터 (텍스트, 사진URL/파일명 등)
            files: 업로드할 이미지 파일 경로 목록
            break_before: 페이지 나눔 ("page": 새 페이지, "spread": 새 스프레드)
        """
        multipart = [
            ("templateUid", (None, template_uid)),
            ("parameters", (None, json.dumps(parameters or {}, ensure_ascii=False))),
        ]

        params = {}
        if break_before:
            params["breakBefore"] = break_before

        opened = []
        if files:
            for path in files:
                f = open(path, "rb")
                opened.append(f)
                multipart.append(("files", (os.path.basename(path), f, "image/jpeg")))

        try:
            return self._client.post_form(
                f"/Books/{book_uid}/contents", files=multipart, params=params,
            )
        finally:
            for f in opened:
                f.close()

    def clear(self, book_uid: str) -> dict:
        """모든 내지 페이지 삭제 (표지는 유지)"""
        return self._client.delete(f"/Books/{book_uid}/contents")
