from __future__ import annotations

from dataclasses import dataclass
from urllib.error import HTTPError, URLError

from fastapi import HTTPException, status


@dataclass
class ProviderRequestError(Exception):
    provider: str
    message: str
    code: int | None = None
    retryable: bool = False

    def __str__(self) -> str:
        return self.message


def build_provider_request_error(provider: str, exc: Exception, *, access_hint: str = "") -> ProviderRequestError:
    if isinstance(exc, ProviderRequestError):
        return exc

    if isinstance(exc, HTTPException):
        status_code = exc.status_code if isinstance(exc.status_code, int) else None
        return ProviderRequestError(provider=provider, message=str(exc.detail), code=status_code, retryable=bool(status_code and status_code >= 500))

    if isinstance(exc, HTTPError):
        code = int(getattr(exc, "code", 0) or 0)
        if code in {401, 403}:
            message = f"{provider} access is unavailable for the current API key."
            if access_hint:
                message = f"{message} {access_hint}"
            return ProviderRequestError(provider=provider, message=message, code=code, retryable=False)
        if code == 429:
            return ProviderRequestError(provider=provider, message=f"{provider} rate limit was reached. Try again shortly.", code=code, retryable=True)
        if 500 <= code <= 599:
            return ProviderRequestError(provider=provider, message=f"{provider} is temporarily unavailable right now.", code=code, retryable=True)
        return ProviderRequestError(provider=provider, message=f"{provider} request failed with HTTP {code}.", code=code, retryable=False)

    if isinstance(exc, URLError):
        return ProviderRequestError(provider=provider, message=f"{provider} could not be reached right now.", retryable=True)

    return ProviderRequestError(provider=provider, message=f"{provider} request failed.", retryable=True)


def provider_http_exception(
    provider: str,
    exc: Exception,
    *,
    access_hint: str = "",
    status_code: int = status.HTTP_503_SERVICE_UNAVAILABLE,
) -> HTTPException:
    error = build_provider_request_error(provider, exc, access_hint=access_hint)
    return HTTPException(status_code=status_code, detail=error.message)
