"""BookPrintAPI SDK — Exceptions"""


class ApiError(Exception):
    """API 요청 실패 시 발생하는 에러"""

    def __init__(self, message: str, *, status_code: int | None = None,
                 error_code: str | None = None, details: list | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or []

    def __str__(self):
        parts = [self.message]
        if self.status_code:
            parts.insert(0, f"[{self.status_code}]")
        return " ".join(parts)

    @classmethod
    def from_response(cls, response) -> "ApiError":
        try:
            body = response.json()
            errors = body.get("errors", [])
            message = body.get("message", "") or response.reason
            return cls(
                message=message,
                status_code=response.status_code,
                error_code=body.get("error_code"),
                details=errors,
            )
        except Exception:
            return cls(
                message=f"HTTP {response.status_code}: {response.reason}",
                status_code=response.status_code,
            )


class ValidationError(Exception):
    """요청 파라미터 검증 실패"""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field
