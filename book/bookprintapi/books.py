"""BookPrintAPI SDK — Books"""

from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .client import Client


class BooksClient:
    """책 생성/조회/확정/삭제"""

    def __init__(self, client: Client):
        self._client = client

    def list(self, *, status: str | None = None, limit: int = 20, offset: int = 0) -> dict:
        """책 목록 조회

        Args:
            status: "draft" | "finalized" (미지정 시 전체)
            limit: 결과 수 (1-100)
            offset: 페이지네이션 오프셋
        """
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        return self._client.get("/Books", params=params)

    def create(self, *, book_spec_uid: str, title: str | None = None,
               creation_type: str = "NORMAL", external_ref: str | None = None) -> dict:
        """새 책 생성 (draft 상태)

        Args:
            book_spec_uid: 상품 규격 UID (예: "SQUAREBOOK_HC")
            title: 책 제목
            creation_type: "NORMAL" | "TEST"
            external_ref: 외부 참조 ID (최대 100자)
        """
        payload = {"bookSpecUid": book_spec_uid, "creationType": creation_type}
        if title:
            payload["title"] = title
        if external_ref:
            payload["externalRef"] = external_ref
        return self._client.post("/Books", payload=payload)

    def get(self, book_uid: str) -> dict:
        """책 상세 조회"""
        return self._client.get(f"/Books/{book_uid}")

    def finalize(self, book_uid: str) -> dict:
        """책 확정 (draft → finalized). 확정 후에는 내용 수정 불가."""
        return self._client.post(f"/Books/{book_uid}/finalization", payload={})

    def delete(self, book_uid: str) -> dict | None:
        """책 삭제 (draft 상태만 가능)"""
        return self._client.delete(f"/Books/{book_uid}")
