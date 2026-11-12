"""Read model for ITPs: items, required roles, signatures, pins, hold points.

The routes in ``itps.py`` and ``areas.py`` both need "what state is this ITP
in": how many lines are recorded, which hold points are still waiting, and
what stops completion. ``load_itp_states`` answers that for many ITPs at once
in a fixed number of queries, so a 40-lot area list stays cheap.

Hold-point rule (PRD v2.63 §5, "work cannot be recorded past a hold point
until the required role signs"): lines are in ``sort_order``. A hold line is
*released* when every one of its required roles has signed it. Every line
after the first unreleased hold line is *blocked* — its result cannot be
recorded — and the ITP cannot be completed while any hold line is unreleased.

Photo evidence (13.6 / 13.8): a line is *evidenced* when its photo rule is
met — at least one photo for ``photo_required``, a photo in each of the three
slots for ``photo_set == "three_shot"``. An unevidenced line cannot pass and
cannot be signed.

Document numbers (13.8): each ITP's ``doc_number`` is
``ITP-<project code>-<seq>`` (``app/core/doc_numbers.py``).
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.doc_numbers import effective_project_code, itp_doc_number
from app.core.storage import storage
from app.models import (
    RELEASE_APPROVED_LABEL,
    RELEASE_CONDITIONAL_LABEL,
    RELEASE_REJECTED_LABEL,
    THREE_SHOT_SLOTS,
    Drawing,
    InspectionPin,
    ItpItem,
    ItpItemPublic,
    ItpItemRequiredRole,
    ItpPinRef,
    ItpRoleRef,
    ItpSignature,
    ItpSignaturePublic,
    Photo,
    Project,
    ProjectArea,
    ProjectItp,
    ProjectItpPublic,
    ProjectItpSummary,
    SignoffRole,
)


@dataclass
class ItemState:
    item: ItpItem
    roles: list[SignoffRole] = field(default_factory=list)
    signatures: list[ItpSignature] = field(default_factory=list)
    pins: list[ItpPinRef] = field(default_factory=list)
    blocked_by: ItpItem | None = None
    photo_count: int = 0
    shot_slots: set[str] = field(default_factory=set)

    @property
    def missing_roles(self) -> list[SignoffRole]:
        signed = {s.signoff_role_id for s in self.signatures if s.itp_item_id}
        return [r for r in self.roles if r.id not in signed]

    @property
    def released(self) -> bool:
        return self.item.classification != "hold" or not self.missing_roles

    @property
    def missing_shots(self) -> list[str]:
        if self.item.photo_set != "three_shot":
            return []
        return [s for s in THREE_SHOT_SLOTS if s not in self.shot_slots]

    @property
    def evidenced(self) -> bool:
        return evidence_met(self.item, self.photo_count, self.shot_slots)


SHOT_LABELS = {
    "context": "Context",
    "intermediate": "Intermediate",
    "closeup": "Close-up with scale",
}


def evidence_met(item: ItpItem, photo_count: int, shot_slots: set[str]) -> bool:
    """Is the line's photo rule met with these photos on file?"""
    if item.photo_set == "three_shot":
        return all(slot in shot_slots for slot in THREE_SHOT_SLOTS)
    if item.photo_required:
        return photo_count > 0
    return True


def evidence_gap(item: ItpItem, shot_slots: set[str]) -> str:
    """Plain-language "what photo evidence is missing" for an unevidenced line."""
    if item.photo_set == "three_shot":
        missing = [SHOT_LABELS[s] for s in THREE_SHOT_SLOTS if s not in shot_slots]
        return "the three-shot photo set (still missing: " + ", ".join(missing) + ")"
    return "a photo on file"


@dataclass
class ItpState:
    itp: ProjectItp
    area: ProjectArea | None
    items: list[ItemState] = field(default_factory=list)
    signature_count: int = 0
    project_code: str = ""

    @property
    def doc_number(self) -> str | None:
        return itp_doc_number(self.project_code, self.itp.seq)

    @property
    def done_count(self) -> int:
        return sum(1 for s in self.items if s.item.status != "pending")

    @property
    def fail_count(self) -> int:
        return sum(1 for s in self.items if s.item.status == "fail")

    @property
    def holds(self) -> list[ItemState]:
        return [s for s in self.items if s.item.classification == "hold"]

    @property
    def open_holds(self) -> list[ItemState]:
        return [s for s in self.holds if not s.released]

    def completion_blockers(self) -> list[str]:
        reasons: list[str] = []
        pending = len(self.items) - self.done_count
        if pending:
            reasons.append(
                f"{pending} line{'s' if pending != 1 else ''} still to record"
            )
        if self.fail_count:
            n = self.fail_count
            reasons.append(
                f"{n} line{'s' if n != 1 else ''} failed — fix and re-record"
            )
        for hold in self.open_holds:
            waiting = ", ".join(r.role_name for r in hold.missing_roles)
            reasons.append(
                f"Hold point “{hold.item.requirement}” is waiting for {waiting}"
            )
        return reasons

    def item(self, item_id: int) -> ItemState:
        for state in self.items:
            if state.item.id == item_id:
                return state
        raise KeyError(item_id)  # pragma: no cover - callers pass own items


def load_itp_states(db: Session, itps: Iterable[ProjectItp]) -> list[ItpState]:
    itps = list(itps)
    if not itps:
        return []
    itp_ids = [itp.id for itp in itps]
    area_ids = {itp.area_id for itp in itps if itp.area_id is not None}
    areas = (
        {
            a.id: a
            for a in db.exec(
                select(ProjectArea).where(col(ProjectArea.id).in_(area_ids))
            ).all()
        }
        if area_ids
        else {}
    )
    items = db.exec(
        select(ItpItem)
        .where(col(ItpItem.project_itp_id).in_(itp_ids))
        .order_by(col(ItpItem.sort_order), col(ItpItem.id))
    ).all()
    item_ids = [i.id for i in items]
    by_item: dict[int, ItemState] = {}
    project_ids = {itp.project_id for itp in itps}
    codes = {
        p.id: effective_project_code(p.code, p.name, p.id)
        for p in db.exec(select(Project).where(col(Project.id).in_(project_ids))).all()
    }
    states = {
        itp.id: ItpState(
            itp=itp,
            area=areas.get(itp.area_id),
            project_code=codes.get(itp.project_id, f"P{itp.project_id}"),
        )
        for itp in itps
    }
    for item in items:
        assert item.id is not None
        item_state = ItemState(item=item)
        by_item[item.id] = item_state
        states[item.project_itp_id].items.append(item_state)

    if item_ids:
        links = db.exec(
            select(ItpItemRequiredRole, SignoffRole)
            .join(
                SignoffRole,
                col(SignoffRole.id) == col(ItpItemRequiredRole.signoff_role_id),
            )
            .where(col(ItpItemRequiredRole.itp_item_id).in_(item_ids))
            .order_by(col(SignoffRole.id))
        ).all()
        for link, role in links:
            by_item[link.itp_item_id].roles.append(role)
        photo_counts = db.exec(
            select(col(Photo.itp_item_id), func.count(col(Photo.id)))
            .where(col(Photo.itp_item_id).in_(item_ids))
            .group_by(col(Photo.itp_item_id))
        ).all()
        for photo_item_id, count in photo_counts:
            if photo_item_id is not None:
                by_item[photo_item_id].photo_count = int(count)
        filled = db.exec(
            select(col(Photo.itp_item_id), col(Photo.shot_slot))
            .where(col(Photo.itp_item_id).in_(item_ids))
            .where(col(Photo.shot_slot).is_not(None))
            .distinct()
        ).all()
        for photo_item_id, slot in filled:
            if photo_item_id is not None and slot is not None:
                by_item[photo_item_id].shot_slots.add(slot)
        pins = db.exec(
            select(InspectionPin, Drawing)
            .join(Drawing, col(Drawing.id) == col(InspectionPin.drawing_id))
            .where(col(InspectionPin.itp_item_id).in_(item_ids))
            # Increment 14.5: a line's pins are the ones on current revisions;
            # old revisions keep their copies as history.
            .where(col(Drawing.superseded_at).is_(None))
            .order_by(col(InspectionPin.id))
        ).all()
        for pin, drawing in pins:
            assert pin.itp_item_id is not None and pin.id is not None
            by_item[pin.itp_item_id].pins.append(
                ItpPinRef(
                    id=pin.id,
                    drawing_id=pin.drawing_id,
                    drawing_title=drawing.title,
                    page_number=pin.page_number,
                    label=pin.label,
                    tag_number=pin.tag_number,
                    status=pin.status,
                )
            )

    signatures = db.exec(
        select(ItpSignature)
        .where(col(ItpSignature.project_itp_id).in_(itp_ids))
        .order_by(col(ItpSignature.signed_at), col(ItpSignature.id))
    ).all()
    for sig in signatures:
        states[sig.project_itp_id].signature_count += 1
        if sig.itp_item_id is not None and sig.itp_item_id in by_item:
            by_item[sig.itp_item_id].signatures.append(sig)

    for itp_state in states.values():
        gate: ItpItem | None = None
        for line in itp_state.items:
            line.blocked_by = gate
            if gate is None and not line.released:
                gate = line.item
    return [states[i] for i in itp_ids]


def load_itp_state(db: Session, itp: ProjectItp) -> ItpState:
    return load_itp_states(db, [itp])[0]


def out_of_tolerance(item: ItpItem) -> bool | None:
    """For a number line with a value and a min and / or max: outside them?"""
    if item.value_type != "number" or item.measured_value is None:
        return None
    if item.value_min is None and item.value_max is None:
        return None
    try:
        value = float(item.measured_value)
    except ValueError:  # pragma: no cover - normalised on save
        return None
    return (item.value_min is not None and value < item.value_min) or (
        item.value_max is not None and value > item.value_max
    )


def result_label(item: ItpItem) -> str | None:
    """A release line's result in words (13.9); null otherwise or while pending."""
    if item.result_scale != "release":
        return None
    if item.status == "pass":
        if item.conditions:
            return RELEASE_CONDITIONAL_LABEL
        return item.approved_label or RELEASE_APPROVED_LABEL
    if item.status == "fail":
        return RELEASE_REJECTED_LABEL
    return None


def item_public(state: ItemState) -> ItpItemPublic:
    item = state.item
    assert item.id is not None and item.public_id is not None
    assert item.updated_at is not None
    return ItpItemPublic(
        id=item.id,
        public_id=item.public_id,
        project_itp_id=item.project_itp_id,
        section=item.section,
        element_name=item.element_name,
        requirement=item.requirement,
        classification=item.classification,
        status=item.status,
        notes=item.notes,
        sort_order=item.sort_order,
        updated_at=item.updated_at,
        acceptance_criteria=item.acceptance_criteria,
        reference_doc=item.reference_doc,
        record_required=item.record_required,
        photo_required=item.photo_required,
        photo_count=state.photo_count,
        photo_set=item.photo_set,
        shot_slots=[s for s in THREE_SHOT_SLOTS if s in state.shot_slots],
        evidenced=state.evidenced,
        value_type=item.value_type,
        value_unit=item.value_unit,
        value_min=item.value_min,
        value_max=item.value_max,
        measured_value=item.measured_value,
        out_of_tolerance=out_of_tolerance(item),
        result_scale=item.result_scale,
        approved_label=item.approved_label,
        conditions=item.conditions,
        result_label=result_label(item),
        required_roles=[
            ItpRoleRef(
                id=r.id or 0,
                role_name=r.role_name,
                party=r.party,
                signer_email=r.signer_email,
            )
            for r in state.roles
        ],
        signatures=[signature_public(s) for s in state.signatures],
        released=state.released,
        blocked_by_item_id=state.blocked_by.id if state.blocked_by else None,
        pins=state.pins,
    )


def signature_public(sig: ItpSignature) -> ItpSignaturePublic:
    assert sig.id is not None and sig.signed_at is not None
    return ItpSignaturePublic(
        id=sig.id,
        itp_item_id=sig.itp_item_id,
        signoff_role_id=sig.signoff_role_id,
        role_name=sig.role_name,
        party=sig.party,
        signer_name=sig.signer_name,
        signer_email=sig.signer_email,
        method=sig.method,
        signed_at=sig.signed_at,
        gps_lat=float(sig.gps_lat) if sig.gps_lat is not None else None,
        gps_lng=float(sig.gps_lng) if sig.gps_lng is not None else None,
        weather=sig.weather,
        signature_url=storage.presign_get(sig.signature_s3_key)
        if sig.signature_s3_key
        else None,
    )


def _summary_fields(state: ItpState) -> dict[str, object]:
    itp = state.itp
    return {
        "id": itp.id,
        "public_id": itp.public_id,
        "project_id": itp.project_id,
        "area_id": itp.area_id,
        "area_name": state.area.name if state.area else None,
        "template_id": itp.template_id,
        "template_version": itp.template_version,
        "seq": itp.seq,
        "doc_number": state.doc_number,
        "title": itp.title,
        "status": itp.status,
        "item_count": len(state.items),
        "done_count": state.done_count,
        "fail_count": state.fail_count,
        "hold_count": len(state.holds),
        "open_hold_count": len(state.open_holds),
        "signature_count": state.signature_count,
        "created_by": itp.created_by,
        "created_at": itp.created_at,
        "updated_at": itp.updated_at,
    }


def itp_summary(state: ItpState) -> ProjectItpSummary:
    return ProjectItpSummary.model_validate(_summary_fields(state))


def itp_public(state: ItpState) -> ProjectItpPublic:
    return ProjectItpPublic.model_validate(
        {
            **_summary_fields(state),
            "body": state.itp.body,
            "items": [item_public(s) for s in state.items],
            "completion_blockers": state.completion_blockers(),
        }
    )


def states_by_area(states: Iterable[ItpState]) -> dict[int, list[ItpState]]:
    grouped: dict[int, list[ItpState]] = defaultdict(list)
    for state in states:
        if state.itp.area_id is not None:
            grouped[state.itp.area_id].append(state)
    return grouped
