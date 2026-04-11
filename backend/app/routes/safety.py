from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.config import get_settings
from app.database import get_db
from app.models import SafetyDocument, SafetyInvestigationCase, SafetyNote, SafetyShiftBrief, User
from app.motive import MotiveClient
from app.safety_documents import SafetyDocumentError, analyze_uploaded_safety_document
from app.safety_fleet import build_safety_fleet_snapshot
from app.safety_service_map import build_service_map_snapshot
from app.schemas import (
    SafetyDocumentResponse,
    SafetyDocumentUpload,
    SafetyInvestigationCreate,
    SafetyInvestigationResponse,
    SafetyInvestigationUpdate,
    SafetyNoteResponse,
    SafetyNoteUpdate,
    SafetyShiftBriefCreate,
    SafetyShiftBriefResponse,
    SafetyShiftBriefUpdate,
)


router = APIRouter(prefix="/safety", tags=["safety"])
settings = get_settings()
motive_client = MotiveClient(settings)

QUEUE_LABELS = {
    "critical": "Immediate Action",
    "maintenance": "Maintenance",
    "coaching": "Coaching",
    "compliance": "Compliance",
    "watch": "Watchlist",
}


def _investigation_response(case: SafetyInvestigationCase) -> SafetyInvestigationResponse:
    return SafetyInvestigationResponse(
        id=case.id,
        title=case.title,
        type=case.case_type,
        status=case.status,
        severity=case.severity,
        owner=case.owner,
        dueDate=case.due_date,
        vehicleId=case.vehicle_id,
        facts=case.facts,
        evidence=case.evidence,
        questions=case.questions,
        actionPlan=case.action_plan,
        outcome=case.outcome,
        createdAt=case.created_at,
        updatedAt=case.updated_at,
    )


def _apply_investigation_payload(case: SafetyInvestigationCase, payload: SafetyInvestigationCreate | SafetyInvestigationUpdate) -> None:
    case.title = payload.title.strip() or "Untitled safety investigation"
    case.case_type = payload.type.strip() or "Accident"
    case.status = payload.status.strip() or "Intake"
    case.severity = payload.severity.strip() or "Elevated"
    case.owner = payload.owner.strip() or "Safety"
    case.due_date = payload.dueDate.strip()
    case.vehicle_id = payload.vehicleId.strip()
    case.facts = payload.facts
    case.evidence = payload.evidence
    case.questions = payload.questions
    case.action_plan = payload.actionPlan
    case.outcome = payload.outcome


def _shift_brief_response(brief: SafetyShiftBrief) -> SafetyShiftBriefResponse:
    return SafetyShiftBriefResponse(
        id=brief.id,
        title=brief.title,
        shift=brief.shift,
        status=brief.status,
        owner=brief.owner,
        handoffNote=brief.handoff_note,
        checklist=brief.checklist or [],
        actions=brief.actions or [],
        snapshotAt=brief.snapshot_at,
        createdAt=brief.created_at,
        updatedAt=brief.updated_at,
    )


def _apply_shift_brief_payload(brief: SafetyShiftBrief, payload: SafetyShiftBriefCreate | SafetyShiftBriefUpdate) -> None:
    brief.title = payload.title.strip() or "Shift Brief"
    brief.shift = payload.shift.strip() or "Day Shift"
    brief.status = payload.status.strip() or "Open"
    brief.owner = payload.owner.strip() or "Safety"
    brief.handoff_note = payload.handoffNote
    brief.checklist = [item.model_dump() for item in payload.checklist]
    brief.actions = [item.model_dump() for item in payload.actions]
    brief.snapshot_at = payload.snapshotAt.strip()


def _excel_response(rows: list[dict], file_name: str, sheet_name: str) -> StreamingResponse:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = sheet_name[:31] or "Safety Export"
    safe_rows = rows or [{"Message": "No rows available"}]
    columns: list[str] = []
    for row in safe_rows:
        for key in row.keys():
            if key not in columns:
                columns.append(key)

    worksheet.append(columns)
    for row in safe_rows:
        worksheet.append([row.get(column, "") for column in columns])

    for column_cells in worksheet.columns:
        header = str(column_cells[0].value or "")
        max_length = min(48, max(len(str(cell.value or "")) for cell in column_cells))
        worksheet.column_dimensions[column_cells[0].column_letter].width = max(12, max(len(header), max_length) + 2)

    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


def _risk_export_rows(fleet_data: dict, source: str = "Safety") -> list[dict]:
    risky_levels = {"Critical", "High", "Medium"}
    risky_queues = {"critical", "maintenance", "coaching", "compliance"}
    rows = []
    for vehicle in fleet_data.get("vehicles") or []:
        queue_ids = set(vehicle.get("queue_ids") or [])
        risk_score = vehicle.get("risk_score") or 0
        if vehicle.get("risk_level") not in risky_levels and risk_score < 50 and not queue_ids.intersection(risky_queues):
            continue
        rows.append({
            "Driver": vehicle.get("driver_name") or "Unassigned",
            "Contact": vehicle.get("driver_contact") or "",
            "Truck": vehicle.get("number") or vehicle.get("vehicle_label") or "",
            "Vehicle": vehicle.get("vehicle_label") or "",
            "Risk Level": vehicle.get("risk_level") or "",
            "Risk Score": vehicle.get("risk_score") or "",
            "Queue": QUEUE_LABELS.get(vehicle.get("primary_queue"), vehicle.get("primary_queue") or ""),
            "Location": vehicle.get("location_label") or "",
            "Faults": vehicle.get("active_faults") or 0,
            "Pending Events": vehicle.get("pending_events") or 0,
            "Fuel %": vehicle.get("fuel_level_percent") if vehicle.get("fuel_level_percent") is not None else "",
            "Telemetry Age Minutes": vehicle.get("age_minutes") if vehicle.get("age_minutes") is not None else "",
            "Risk Factors": " | ".join(f"{factor.get('label')}: {factor.get('detail')}" for factor in vehicle.get("risk_factors") or []) or vehicle.get("headline") or vehicle.get("summary") or "",
            "Recommended Actions": " | ".join(vehicle.get("recommended_actions") or []),
            "Snapshot": fleet_data.get("fetched_at") or "",
            "Source": source,
        })
    return sorted(rows, key=lambda row: row.get("Risk Score") or 0, reverse=True)


def _case_export_rows(cases: list[SafetyInvestigationCase]) -> list[dict]:
    return [
        {
            "Case ID": case.id,
            "Title": case.title,
            "Type": case.case_type,
            "Status": case.status,
            "Severity": case.severity,
            "Owner": case.owner,
            "Due Date": case.due_date,
            "Vehicle ID": case.vehicle_id,
            "Facts": case.facts,
            "Evidence": case.evidence,
            "Questions": case.questions,
            "Action Plan": case.action_plan,
            "Outcome": case.outcome,
            "Created": case.created_at.isoformat() if case.created_at else "",
            "Updated": case.updated_at.isoformat() if case.updated_at else "",
        }
        for case in cases
    ]


def _brief_export_rows(brief: SafetyShiftBrief) -> list[dict]:
    rows = [
        {"Category": "Brief", "Item": "Title", "Status": brief.status, "Owner": brief.owner, "Detail": brief.title, "Notes": brief.handoff_note},
        {"Category": "Brief", "Item": "Shift", "Status": brief.status, "Owner": brief.owner, "Detail": brief.shift, "Notes": f"Snapshot {brief.snapshot_at}"},
    ]
    for index, item in enumerate(brief.checklist or [], start=1):
        rows.append({
            "Category": "Checklist",
            "Item": f"{index}. {item.get('label') or ''}",
            "Status": "Done" if item.get("done") else "Open",
            "Owner": brief.owner,
            "Detail": "First action",
            "Notes": "",
        })
    for action in brief.actions or []:
        rows.append({
            "Category": "Action",
            "Item": action.get("title") or "",
            "Status": action.get("status") or "",
            "Owner": action.get("owner") or "",
            "Due Date": action.get("dueDate") or "",
            "Driver": action.get("driverName") or "",
            "Truck": action.get("truckNumber") or "",
            "Queue": action.get("queueLabel") or "",
            "Risk Level": action.get("riskLevel") or "",
            "Risk Score": action.get("riskScore") if action.get("riskScore") is not None else "",
            "Detail": action.get("recommendedAction") or action.get("summary") or "",
            "Notes": action.get("notes") or "",
        })
    return rows


@router.get("/notes", response_model=SafetyNoteResponse)
def get_safety_notes(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    note = db.scalar(select(SafetyNote).where(SafetyNote.user_id == current_user.id))
    if not note:
        return SafetyNoteResponse(content="", updated_at=None)
    return note


@router.put("/notes", response_model=SafetyNoteResponse)
def save_safety_notes(payload: SafetyNoteUpdate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    note = db.scalar(select(SafetyNote).where(SafetyNote.user_id == current_user.id))
    if not note:
        note = SafetyNote(user_id=current_user.id, content=payload.content)
        db.add(note)
    else:
        note.content = payload.content

    db.commit()
    db.refresh(note)
    return note


@router.get("/documents", response_model=list[SafetyDocumentResponse])
def list_safety_documents(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    return db.scalars(select(SafetyDocument).where(SafetyDocument.user_id == current_user.id).order_by(SafetyDocument.created_at.desc(), SafetyDocument.id.desc())).all()


@router.post("/documents", response_model=SafetyDocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_safety_document(payload: SafetyDocumentUpload, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    try:
        analysis = analyze_uploaded_safety_document(
            file_name=payload.file_name,
            content_type=payload.content_type,
            data_url=payload.data_url,
        )
    except SafetyDocumentError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    document = SafetyDocument(
        user_id=current_user.id,
        file_name=payload.file_name,
        content_type=payload.content_type,
        bucket=analysis.bucket,
        document_type=analysis.document_type,
        summary=analysis.summary,
        issues=analysis.issues,
        recommended_action=analysis.recommended_action,
        excerpt=analysis.excerpt,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/investigations", response_model=list[SafetyInvestigationResponse])
def list_safety_investigations(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    cases = db.scalars(
        select(SafetyInvestigationCase)
        .where(SafetyInvestigationCase.user_id == current_user.id)
        .order_by(SafetyInvestigationCase.updated_at.desc(), SafetyInvestigationCase.id.desc())
    ).all()
    return [_investigation_response(case) for case in cases]


@router.post("/investigations", response_model=SafetyInvestigationResponse, status_code=status.HTTP_201_CREATED)
def create_safety_investigation(payload: SafetyInvestigationCreate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    case = SafetyInvestigationCase(user_id=current_user.id)
    _apply_investigation_payload(case, payload)
    db.add(case)
    db.commit()
    db.refresh(case)
    return _investigation_response(case)


@router.put("/investigations/{case_id}", response_model=SafetyInvestigationResponse)
def update_safety_investigation(case_id: int, payload: SafetyInvestigationUpdate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    case = db.scalar(select(SafetyInvestigationCase).where(SafetyInvestigationCase.id == case_id, SafetyInvestigationCase.user_id == current_user.id))
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Investigation case not found")

    _apply_investigation_payload(case, payload)
    db.commit()
    db.refresh(case)
    return _investigation_response(case)


@router.delete("/investigations/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_safety_investigation(case_id: int, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    case = db.scalar(select(SafetyInvestigationCase).where(SafetyInvestigationCase.id == case_id, SafetyInvestigationCase.user_id == current_user.id))
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Investigation case not found")

    db.delete(case)
    db.commit()


@router.get("/investigations/export")
def export_safety_investigations(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    cases = db.scalars(
        select(SafetyInvestigationCase)
        .where(SafetyInvestigationCase.user_id == current_user.id)
        .order_by(SafetyInvestigationCase.updated_at.desc(), SafetyInvestigationCase.id.desc())
    ).all()
    return _excel_response(_case_export_rows(cases), "safety_investigations.xlsx", "Investigations")


@router.get("/shift-briefs", response_model=list[SafetyShiftBriefResponse])
def list_safety_shift_briefs(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    briefs = db.scalars(
        select(SafetyShiftBrief)
        .where(SafetyShiftBrief.user_id == current_user.id)
        .order_by(SafetyShiftBrief.updated_at.desc(), SafetyShiftBrief.id.desc())
    ).all()
    return [_shift_brief_response(brief) for brief in briefs]


@router.post("/shift-briefs", response_model=SafetyShiftBriefResponse, status_code=status.HTTP_201_CREATED)
def create_safety_shift_brief(payload: SafetyShiftBriefCreate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    brief = SafetyShiftBrief(user_id=current_user.id)
    _apply_shift_brief_payload(brief, payload)
    db.add(brief)
    db.commit()
    db.refresh(brief)
    return _shift_brief_response(brief)


@router.put("/shift-briefs/{brief_id}", response_model=SafetyShiftBriefResponse)
def update_safety_shift_brief(brief_id: int, payload: SafetyShiftBriefUpdate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    brief = db.scalar(select(SafetyShiftBrief).where(SafetyShiftBrief.id == brief_id, SafetyShiftBrief.user_id == current_user.id))
    if not brief:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift brief not found")

    _apply_shift_brief_payload(brief, payload)
    db.commit()
    db.refresh(brief)
    return _shift_brief_response(brief)


@router.delete("/shift-briefs/{brief_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_safety_shift_brief(brief_id: int, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    brief = db.scalar(select(SafetyShiftBrief).where(SafetyShiftBrief.id == brief_id, SafetyShiftBrief.user_id == current_user.id))
    if not brief:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift brief not found")

    db.delete(brief)
    db.commit()


@router.get("/shift-briefs/{brief_id}/export")
def export_safety_shift_brief(brief_id: int, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    brief = db.scalar(select(SafetyShiftBrief).where(SafetyShiftBrief.id == brief_id, SafetyShiftBrief.user_id == current_user.id))
    if not brief:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift brief not found")

    return _excel_response(_brief_export_rows(brief), f"safety_shift_brief_{brief.id}.xlsx", "Shift Brief")


@router.get("/risky-people/export")
def export_safety_risky_people(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch before exporting risky people."),
    current_user: User = Depends(require_user_department("safety")),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh)
    fleet_data = build_safety_fleet_snapshot(snapshot)
    return _excel_response(_risk_export_rows(fleet_data, "Safety"), "safety_risky_people.xlsx", "Risky People")


@router.get("/fleet")
def get_safety_fleet(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch instead of the cached safety fleet snapshot."),
    current_user: User = Depends(require_user_department("safety")),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh)
    return build_safety_fleet_snapshot(snapshot)


@router.get("/services")
def get_safety_services(
    mode: str = Query(default="service", description="service or emergency"),
    vehicle_id: int | None = Query(default=None, ge=1),
    radius_miles: int = Query(default=80, ge=10, le=180),
    category_id: str = Query(default="all"),
    scenario_id: str = Query(default="mechanical"),
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch before building the service map."),
    current_user: User = Depends(require_user_department("safety")),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh)
    return build_service_map_snapshot(
        snapshot,
        settings,
        mode=mode,
        vehicle_id=vehicle_id,
        radius_miles=radius_miles,
        category_id=category_id,
        scenario_id=scenario_id,
    )