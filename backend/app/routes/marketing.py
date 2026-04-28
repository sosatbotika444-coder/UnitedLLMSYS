from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CommercialLead
from app.schemas import CommercialLeadCreate, CommercialLeadResponse


router = APIRouter(prefix="/marketing", tags=["marketing"])


@router.post("/leads", response_model=CommercialLeadResponse, status_code=status.HTTP_201_CREATED)
def create_commercial_lead(
    payload: CommercialLeadCreate,
    db: Session = Depends(get_db),
):
    lead = CommercialLead(
        name=payload.name.strip(),
        email=str(payload.email).strip().lower(),
        fleet_size=payload.fleetSize,
        role=payload.role.strip(),
        priority=payload.priority.strip(),
        selected_plan=payload.selectedPlan.strip().lower(),
        landing_variant=payload.landingVariant.strip().lower(),
        estimated_annual_gain=payload.estimatedAnnualGain,
        source_page=payload.sourcePage.strip() or "commercial-landing",
        notes=payload.notes.strip(),
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return CommercialLeadResponse(
        id=lead.id,
        name=lead.name,
        email=lead.email,
        fleetSize=lead.fleet_size,
        role=lead.role,
        priority=lead.priority,
        selectedPlan=lead.selected_plan,
        landingVariant=lead.landing_variant,
        estimatedAnnualGain=lead.estimated_annual_gain,
        sourcePage=lead.source_page,
        status=lead.status,
        createdAt=lead.created_at,
    )
