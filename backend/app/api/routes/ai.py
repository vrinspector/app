"""AI capture assistance (rebuild increment 15; PRD v2.62 Block 10A / 10B).

    GET  /ai/status                       → {enabled, model, daily_limit, used_today}
    POST /ai/photo-analysis   {photo_id}  → 201 draft (10A)
    POST /ai/voice-finding    {inspection_id, transcript, location_ref?}
                                          → 201 draft (10B)
    GET  /ai/suggestions/{id}             → the full log row (prompts, model, …)
    GET  /ai/suggestions?finding_id=N | photo_id=N
                                          → log rows behind a finding / photo
    POST /ai/suggestions/{id}/dismiss     → draft set aside

Nothing here writes a finding or files a photo. A draft becomes a record only
when the inspector saves it through the ordinary routes:

* ``POST /findings`` with ``ai_suggestion_id`` (10B, or "Log as finding" from
  a 10A photo draft) — the finding is created from what the inspector
  submitted, and the draft is marked ``confirmed`` with ``edited`` set when
  any field differs from what the model proposed;
* ``PUT /photos/{id}/tags`` with ``ai_suggestion_id`` (10A).

Authorization follows every other route: the photo / inspection must be in a
project the caller belongs to (404 otherwise); asking for a draft needs a
write role (owner / inspector) and an inspection that is not signed off,
because a draft only exists to be saved. Each call is logged in
``ai_suggestions`` — the draft or the error — before the response is sent.
"""

from datetime import UTC, datetime, time
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, col, func, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    ensure_inspection_open,
    get_authorized_finding,
    get_authorized_inspection,
    get_authorized_photo,
    not_found,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.core import ai as ai_core
from app.core.ai import AiError, AiResult, ai, prepare_image
from app.core.auth import AuthUser
from app.core.config import settings
from app.core.storage import storage
from app.models import (
    AiStatus,
    AiSuggestion,
    AiSuggestionLog,
    AiSuggestionPublic,
    Finding,
    Inspection,
    PhotoAnalysisRequest,
    VoiceFindingRequest,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def _used_today(session: Session, user: AuthUser) -> int:
    start = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)
    stmt = (
        select(func.count())
        .select_from(AiSuggestion)
        .where(AiSuggestion.requested_by_sub == user.sub)
        .where(col(AiSuggestion.created_at) >= start)
    )
    return int(session.exec(stmt).one())


def _ensure_available(session: Session, user: AuthUser) -> None:
    if not ai.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI assistance is not set up",
        )
    limit = settings.AI_DAILY_LIMIT_PER_USER
    if limit and _used_today(session, user) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily AI limit reached ({limit} drafts); fill this one in yourself",
        )


def _context(inspection: Inspection, location_ref: str | None) -> dict[str, str | None]:
    return {
        "inspection_type": inspection.inspection_type,
        "inspection_title": inspection.title,
        "location_ref": (location_ref or "").strip() or None,
    }


def _record(
    session: Session,
    *,
    kind: str,
    inspection: Inspection,
    user: AuthUser,
    system_prompt: str,
    user_prompt: str,
    prompt_version: str,
    photo_id: int | None = None,
    input_text: str | None = None,
    result: AiResult | None = None,
    error: AiError | None = None,
) -> AiSuggestion:
    assert inspection.id is not None
    row = AiSuggestion(
        kind=kind,
        status="draft" if result is not None else "failed",
        project_id=inspection.project_id,
        inspection_id=inspection.id,
        photo_id=photo_id,
        model=(result.model if result else (error.model if error else None))
        or settings.AI_MODEL,
        prompt_version=prompt_version,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        input_text=input_text,
        draft=result.draft if result else None,
        error=error.detail if error else None,
        input_tokens=result.input_tokens if result else None,
        output_tokens=result.output_tokens if result else None,
        requested_by=current_email(user),
        requested_by_sub=user.sub,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _raise(error: AiError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@router.get("/status", response_model=AiStatus)
def read_status(session: SessionDep, current_user: CurrentUser) -> Any:
    return AiStatus(
        enabled=ai.enabled,
        model=settings.AI_MODEL if ai.enabled else None,
        daily_limit=settings.AI_DAILY_LIMIT_PER_USER,
        used_today=_used_today(session, current_user),
    )


@router.post(
    "/photo-analysis",
    response_model=AiSuggestionPublic,
    status_code=status.HTTP_201_CREATED,
)
def analyze_photo(
    payload: PhotoAnalysisRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    """10A: categorise one inspection photo and list candidate defects."""
    photo = get_authorized_photo(
        session, payload.photo_id, current_user, roles=WRITE_ROLES
    )
    if photo.inspection_id is None:
        raise HTTPException(
            status_code=422,
            detail="Photo analysis is for inspection photos, not ITP line evidence",
        )
    inspection = get_authorized_inspection(
        session, photo.inspection_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    _ensure_available(session, current_user)

    data = storage.get_object(photo.s3_key)
    if data is None:
        raise not_found("The photo file could not be read")
    context = _context(inspection, None)
    user_prompt = ai_core.photo_user_prompt(context)
    common: dict[str, Any] = {
        "kind": "photo",
        "inspection": inspection,
        "user": current_user,
        "system_prompt": ai_core.PHOTO_SYSTEM_PROMPT,
        "user_prompt": user_prompt,
        "prompt_version": ai_core.PHOTO_PROMPT_VERSION,
        "photo_id": photo.id,
    }
    try:
        image = prepare_image(data, photo.content_type)
        result = ai.analyze_photo(image, context)
    except AiError as exc:
        _record(session, error=exc, **common)
        raise _raise(exc) from exc
    return _record(session, result=result, **common)


@router.post(
    "/voice-finding",
    response_model=AiSuggestionPublic,
    status_code=status.HTTP_201_CREATED,
)
def voice_finding(
    payload: VoiceFindingRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    """10B: structure a dictated observation into a draft finding."""
    inspection = get_authorized_inspection(
        session, payload.inspection_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    transcript = payload.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="Say or type the observation first")
    if len(transcript) > settings.AI_MAX_TRANSCRIPT_CHARS:
        raise HTTPException(
            status_code=422,
            detail=(
                "That note is too long to draft from "
                f"(over {settings.AI_MAX_TRANSCRIPT_CHARS} characters)"
            ),
        )
    _ensure_available(session, current_user)

    context = _context(inspection, payload.location_ref)
    common: dict[str, Any] = {
        "kind": "voice",
        "inspection": inspection,
        "user": current_user,
        "system_prompt": ai_core.VOICE_SYSTEM_PROMPT,
        "user_prompt": ai_core.voice_user_prompt(transcript, context),
        "prompt_version": ai_core.VOICE_PROMPT_VERSION,
        "input_text": transcript,
    }
    try:
        result = ai.structure_transcript(transcript, context)
    except AiError as exc:
        _record(session, error=exc, **common)
        raise _raise(exc) from exc
    if not result.draft.get("location_ref") and context["location_ref"]:
        result.draft["location_ref"] = context["location_ref"]
    return _record(session, result=result, **common)


def get_authorized_suggestion(
    session: Session, suggestion_id: int, user: AuthUser, *, write: bool = False
) -> AiSuggestion:
    row = session.get(AiSuggestion, suggestion_id)
    if row is None:
        raise not_found("Suggestion not found")
    require_project_member(
        session,
        row.project_id,
        user,
        roles=WRITE_ROLES if write else None,
        detail="Suggestion not found",
    )
    return row


def _log(session: Session, row: AiSuggestion) -> AiSuggestionLog:
    finding_id = session.exec(
        select(Finding.id).where(Finding.ai_suggestion_id == row.id)
    ).first()
    data = row.model_dump()
    data["finding_id"] = finding_id
    return AiSuggestionLog.model_validate(data)


@router.get("/suggestions", response_model=list[AiSuggestionLog])
def list_suggestions(
    session: SessionDep,
    current_user: CurrentUser,
    finding_id: int | None = Query(default=None),
    photo_id: int | None = Query(default=None),
) -> Any:
    """The log behind one finding or one photo (defensibility record)."""
    if (finding_id is None) == (photo_id is None):
        raise HTTPException(
            status_code=422, detail="Give exactly one of finding_id or photo_id"
        )
    if finding_id is not None:
        finding, _ = get_authorized_finding(session, finding_id, current_user)
        ids = [finding.ai_suggestion_id] if finding.ai_suggestion_id else []
        stmt = select(AiSuggestion).where(col(AiSuggestion.id).in_(ids))
    else:
        assert photo_id is not None
        get_authorized_photo(session, photo_id, current_user)
        stmt = select(AiSuggestion).where(AiSuggestion.photo_id == photo_id)
    stmt = stmt.order_by(
        col(AiSuggestion.created_at).desc(), col(AiSuggestion.id).desc()
    )
    return [_log(session, row) for row in session.exec(stmt).all()]


@router.get("/suggestions/{suggestion_id}", response_model=AiSuggestionLog)
def read_suggestion(
    suggestion_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return _log(
        session, get_authorized_suggestion(session, suggestion_id, current_user)
    )


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=AiSuggestionPublic)
def dismiss_suggestion(
    suggestion_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    row = get_authorized_suggestion(session, suggestion_id, current_user, write=True)
    if row.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This draft is already {row.status}",
        )
    row.status = "dismissed"
    row.decided_by = current_email(current_user)
    row.decided_at = datetime.now(UTC)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# --- confirmation helpers used by the findings and photos routes ---------------


def claim_suggestion(
    session: Session,
    suggestion_id: int,
    *,
    inspection_id: int,
    kinds: tuple[str, ...],
    photo_id: int | None = None,
) -> AiSuggestion:
    """Check that a draft can back the record being saved.

    The draft must be in the same inspection (404 otherwise — as if it did not
    exist), of an expected kind, still usable, and — for a photo draft being
    confirmed as tags — about that photo.
    """
    row = session.get(AiSuggestion, suggestion_id)
    if row is None or row.inspection_id != inspection_id:
        raise not_found("Suggestion not found")
    if row.kind not in kinds or (photo_id is not None and row.photo_id != photo_id):
        raise HTTPException(
            status_code=422, detail="That AI draft is for something else"
        )
    if row.status in ("failed", "dismissed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This draft is {row.status}",
        )
    return row


def mark_confirmed(row: AiSuggestion, *, user: AuthUser, edited: bool) -> None:
    """Record the confirmation. A photo draft can back both its tags and one
    finding; ``edited`` stays true once any confirmation changed the draft."""
    row.edited = bool(row.edited) or edited
    if row.status == "draft":
        row.status = "confirmed"
        row.decided_by = current_email(user)
        row.decided_at = datetime.now(UTC)


def finding_draft(row: AiSuggestion) -> dict[str, Any]:
    """The finding the draft proposed, in finding field names.

    A photo draft (10A) proposes a title, a description and a severity, which
    becomes the finding's priority (no defect → medium).
    """
    draft = dict(row.draft or {})
    if row.kind == "photo":
        return {
            "title": draft.get("title") or "",
            "description": draft.get("description") or "",
            "priority": draft.get("severity") or "medium",
        }
    return draft


def finding_differs(draft: dict[str, Any] | None, values: dict[str, Any]) -> bool:
    """Did the inspector change any drafted field before saving?"""
    draft = draft or {}
    pairs = (
        ("title", "title"),
        ("description", "description"),
        ("priority", "priority"),
        ("status", "status"),
        ("discipline", "discipline"),
        ("location_ref", "location_ref"),
    )
    for draft_key, value_key in pairs:
        if draft_key not in draft:
            continue
        proposed = draft.get(draft_key) or None
        saved = values.get(value_key) or None
        if proposed != saved:
            return True
    return False


def tags_differ(draft: dict[str, Any] | None, values: dict[str, Any]) -> bool:
    draft = draft or {}
    proposed_tags = sorted({d.get("type") for d in draft.get("defects") or []})
    return (
        draft.get("category") != values.get("category")
        or proposed_tags != sorted(set(values.get("defect_tags") or []))
        or (draft.get("severity") or None) != (values.get("severity") or None)
    )
