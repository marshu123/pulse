"""The current-user dependency used by every protected route."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise CREDENTIALS_ERROR

    subject = decode_access_token(credentials.credentials)
    if subject is None:
        raise CREDENTIALS_ERROR

    try:
        user_id = int(subject)
    except ValueError:
        raise CREDENTIALS_ERROR

    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_ERROR

    return user
