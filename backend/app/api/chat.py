"""Chat endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.ml.conversation import ConversationService
from app.ml.engine import Engine, get_engine
from app.models.activity import ChatMessage
from app.models.user import User
from app.schemas import ChatMessageResponse, ChatRequest, ChatResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def send_message(
    payload: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> ChatResponse:
    """One conversational turn: classify, act, then narrate what was done.

    The turn may have side effects — generating a path, re-planning, or updating
    the learner model — which is the point: the chat is the primary interface, not
    a commentary on one.
    """
    service = ConversationService(engine)
    turn = await service.handle(db, user, payload.message, session_id=payload.session_id)
    return ChatResponse(**turn.as_dict())


@router.get("/history", response_model=list[ChatMessageResponse])
def history(
    session_id: str = Query(default="default", max_length=64),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessageResponse]:
    rows = list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.user_id == user.id, ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(limit)
        )
    )
    return [ChatMessageResponse.model_validate(row) for row in reversed(rows)]


# ``response_model=None`` is required, not decorative: FastAPI otherwise reads the
# ``-> None`` return annotation as a response model, and a model on a 204 asserts.
@router.delete("/history", status_code=204, response_model=None)
def clear_history(
    session_id: str = Query(default="default", max_length=64),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Clear one conversation. The learner's profile and paths are untouched."""
    db.execute(
        delete(ChatMessage).where(
            ChatMessage.user_id == user.id, ChatMessage.session_id == session_id
        )
    )
    db.commit()
