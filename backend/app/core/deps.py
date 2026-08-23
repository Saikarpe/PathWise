"""Shared FastAPI dependencies: auth guard and ML engine accessor."""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise CREDENTIALS_ERROR

    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise CREDENTIALS_ERROR

    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise CREDENTIALS_ERROR

    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_ERROR
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """The signed-in learner if there is one, otherwise ``None``.

    Used by read-only catalogue endpoints, which are useful to browse before
    signing up but gain per-learner annotations (enrolment status) once you have.
    A bad token is treated as absent rather than as an error: a stale token in
    localStorage should degrade the page to anonymous, not break it.
    """
    if credentials is None or not credentials.credentials:
        return None
    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        return None
    try:
        return db.get(User, int(payload["sub"]))
    except (TypeError, ValueError):
        return None
