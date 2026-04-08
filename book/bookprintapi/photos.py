"""BookPrintAPI SDK — Photos"""

from __future__ import annotations

import mimetypes
import os
from typing import TYPE_CHECKING, BinaryIO

if TYPE_CHECKING:
    from .client import Client


class PhotosClient:
    """책 사진 업로드/조회/삭제"""

    def __init__(self, client: Client):
        self._client = client

    def upload(self, book_uid: str, file_path: str) -> dict:
        """사진 1장 업로드

        Args:
            book_uid: 책 UID
            file_path: 이미지 파일 경로
        """
        with open(file_path, "rb") as f:
            name = os.path.basename(file_path)
            mime = mimetypes.guess_type(file_path)[0] or "image/jpeg"
            files = [("file", (name, f, mime))]
            return self._client.post_form(f"/Books/{book_uid}/photos", files=files)

    def upload_multiple(self, book_uid: str, file_paths: list[str]) -> list[dict]:
        """사진 여러 장 업로드 (순차)

        Args:
            book_uid: 책 UID
            file_paths: 이미지 파일 경로 목록
        """
        results = []
        for path in file_paths:
            results.append(self.upload(book_uid, path))
        return results

    def list(self, book_uid: str) -> dict:
        """업로드된 사진 목록"""
        return self._client.get(f"/Books/{book_uid}/photos")

    def delete(self, book_uid: str, file_name: str) -> dict | None:
        """사진 삭제 (draft 상태 책만 가능)"""
        return self._client.delete(f"/Books/{book_uid}/photos/{file_name}")
