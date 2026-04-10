from __future__ import annotations

from datetime import datetime, timezone

from app.motive import parse_datetime


RISK_BEHAVIOR_LABELS = {
    "tailgating": "Tailgating",
    "stop_sign_violation": "Stop sign violation",
    "unsafe_lane_change": "Unsafe lane change",
    "unsafe_parking": "Unsafe parking",
    "hard_brake": "Hard brake",
    "aggregated_lane_swerving": "Lane swerving",
    "cell_phone": "Cell phone use",
    "driver_facing_cam_obstruction": "Driver camera obstruction",
    "distraction": "Driver distraction",
    "alert_driving": "Alert driving",
    "following_distance": "Following distance",
}
RISK_BEHAVIORS = set(RISK_BEHAVIOR_LABELS.keys())
QUEUE_META = {
    "critical": {
        "label": "Immediate Action",
        "description": "Units that should be checked by safety right now.",
    },
    "maintenance": {
        "label": "Maintenance Queue",
        "description": "Fault-driven units that likely need mechanical follow-up.",
    },
    "coaching": {
        "label": "Coaching Queue",
        "description": "Drivers and trucks with pending safety behavior follow-up.",
    },
    "compliance": {
        "label": "Compliance Queue",
        "description": "Telemetry freshness, inspections, registration, and documentation checks.",
    },
    "watch": {
        "label": "Watchlist",
        "description": "Units to monitor before they become urgent.",
    },
}
QUEUE_ORDER = ["critical", "maintenance", "coaching", "compliance", "watch"]
RISK_LEVELS = ["All", "Critical", "High", "Medium", "Low"]
FOCUS_OPTIONS = ["All", "Faults", "Coaching", "Compliance", "Stale", "Low Fuel"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_number(value: object) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "0"


def _days_until(value: object) -> int | None:
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return (parsed.date() - _utc_now().date()).days


def _location_label(vehicle: dict) -> str:
    location = vehicle.get("location") or {}
    return (
        _clean_text(location.get("address"))
        or ", ".join(part for part in [_clean_text(location.get("city")), _clean_text(location.get("state"))] if part)
        or "Location unavailable"
    )


def _vehicle_label(vehicle: dict) -> str:
    parts = [
        _clean_text(vehicle.get("year")),
        _clean_text(vehicle.get("make")),
        _clean_text(vehicle.get("model")),
    ]
    label = " ".join(part for part in parts if part)
    return label or "Truck details unavailable"


def _registration_status(value: object, *, registration_dates_live: bool) -> dict:
    days = _days_until(value)
    if days is None:
        return {
            "date": _clean_text(value),
            "days_until": None,
            "tone": "unknown",
            "label": "No registration date" if registration_dates_live else "Registration date not tracked",
        }
    if days < 0:
        tone = "critical"
        label = f"Expired {_format_number(abs(days))} day(s) ago"
    elif days <= 30:
        tone = "high"
        label = f"Expires in {_format_number(days)} day(s)"
    elif days <= 60:
        tone = "medium"
        label = f"Expires in {_format_number(days)} day(s)"
    else:
        tone = "good"
        label = f"Valid for {_format_number(days)} day(s)"
    return {
        "date": _clean_text(value),
        "days_until": days,
        "tone": tone,
        "label": label,
    }


def _top_risk_behaviors(behaviors: list[str]) -> list[str]:
    labels: list[str] = []
    for behavior in behaviors:
        key = _clean_text(behavior).lower()
        if key in RISK_BEHAVIORS:
            labels.append(RISK_BEHAVIOR_LABELS.get(key, behavior.replace("_", " ").title()))
    deduped: list[str] = []
    for label in labels:
        if label not in deduped:
            deduped.append(label)
    return deduped[:5]


def _score_vehicle(vehicle: dict, coverage: dict[str, bool]) -> dict:
    fault_summary = vehicle.get("fault_summary") or {}
    performance_summary = vehicle.get("performance_summary") or {}
    inspection_summary = vehicle.get("inspection_summary") or {}
    idle_summary = vehicle.get("idle_summary") or {}
    driver_scorecard = vehicle.get("driver_scorecard") or {}
    location = vehicle.get("location") or {}

    active_faults = int(fault_summary.get("active_count") or 0)
    severe_faults = int(fault_summary.get("severe_count") or 0)
    pending_events = int(performance_summary.get("pending_review_count") or 0)
    performance_events = int(performance_summary.get("count") or 0)
    unsafe_inspections = int(inspection_summary.get("unsafe_count") or 0)
    inspection_count = int(inspection_summary.get("count") or 0)
    idle_hours = round((idle_summary.get("duration_seconds") or 0) / 3600, 1)
    fuel_level = location.get("fuel_level_percent")
    age_minutes = location.get("age_minutes")
    behaviors = performance_summary.get("behaviors") or []
    risky_behaviors = _top_risk_behaviors(behaviors)
    driver_score = driver_scorecard.get("score")
    registration = _registration_status(vehicle.get("registration_expiry_date"), registration_dates_live=coverage["registration_dates_live"])

    score = 0
    factors: list[dict] = []
    actions: list[str] = []
    queue_ids: list[str] = []
    tags: list[str] = []

    def add_factor(points: int, label: str, detail: str, *, queue_id: str | None = None, tag: str | None = None, action: str | None = None):
        nonlocal score
        if points <= 0:
            return
        score += points
        factors.append({"label": label, "detail": detail, "points": points})
        if queue_id and queue_id not in queue_ids:
            queue_ids.append(queue_id)
        if tag and tag not in tags:
            tags.append(tag)
        if action and action not in actions:
            actions.append(action)

    if severe_faults:
        add_factor(
            40 + min(15, severe_faults * 5),
            "Severe fault exposure",
            f"{severe_faults} severe fault code(s) reported by Motive.",
            queue_id="critical",
            tag="Severe faults",
            action="Pull this unit into immediate maintenance review.",
        )

    if active_faults:
        add_factor(
            min(34, active_faults * 10),
            "Active fault codes",
            f"{active_faults} active fault code(s) need maintenance review.",
            queue_id="maintenance",
            tag="Faults",
            action="Create or confirm a maintenance work order.",
        )

    if unsafe_inspections:
        add_factor(
            32 + min(16, unsafe_inspections * 6),
            "Unsafe inspection results",
            f"{unsafe_inspections} inspection report(s) marked unsafe.",
            queue_id="critical",
            tag="Unsafe inspection",
            action="Do not release the truck until the unsafe inspection is cleared.",
        )
    elif coverage["inspection_records_live"] and inspection_count == 0:
        add_factor(
            8,
            "No recent inspection record",
            "No safety inspection reports were returned for this truck in the current Motive window.",
            queue_id="compliance",
            tag="No inspection",
            action="Verify the latest inspection paperwork or DVIR status.",
        )

    if pending_events:
        add_factor(
            min(30, 6 + pending_events * 2),
            "Pending coaching events",
            f"{pending_events} safety/performance event(s) still need review.",
            queue_id="coaching",
            tag="Pending coaching",
            action="Review camera events and complete coaching follow-up.",
        )
    elif performance_events >= 8:
        add_factor(
            8,
            "High safety event volume",
            f"{performance_events} total safety/performance events were logged recently.",
            queue_id="coaching",
            tag="Event volume",
            action="Review the recent event trend with the driver.",
        )

    if risky_behaviors:
        behavior_points = min(15, len(risky_behaviors) * 4)
        add_factor(
            behavior_points,
            "Risky driving behaviors",
            ", ".join(risky_behaviors),
            queue_id="coaching",
            tag=risky_behaviors[0],
            action="Target coaching around the listed behaviors.",
        )

    if age_minutes is None and vehicle.get("is_stale"):
        add_factor(
            8,
            "No current telemetry",
            "This truck did not return a usable live location in the latest snapshot.",
            queue_id="compliance",
            tag="No telemetry",
            action="Confirm whether the truck is offline, parked, or missing a device ping.",
        )
    elif isinstance(age_minutes, (int, float)):
        if age_minutes > 240:
            add_factor(
                22,
                "Telemetry is very stale",
                f"Last Motive ping was {round(age_minutes, 1)} minutes ago.",
                queue_id="compliance",
                tag="Very stale GPS",
                action="Call the driver or dispatcher and confirm current truck status.",
            )
        elif age_minutes > 60:
            add_factor(
                12,
                "Telemetry is stale",
                f"Last Motive ping was {round(age_minutes, 1)} minutes ago.",
                queue_id="compliance",
                tag="Stale GPS",
                action="Check connectivity and refresh the truck status.",
            )
        elif age_minutes > 30:
            add_factor(
                6,
                "Telemetry aging",
                f"Last Motive ping was {round(age_minutes, 1)} minutes ago.",
                queue_id="watch",
                tag="Aging GPS",
                action="Watch the next location update for this truck.",
            )

    if isinstance(fuel_level, (int, float)):
        if fuel_level <= 10:
            add_factor(
                18,
                "Fuel is critical",
                f"Fuel level is {round(fuel_level, 1)}%.",
                queue_id="critical",
                tag="Fuel critical",
                action="Coordinate fueling before the truck becomes roadside risk.",
            )
        elif fuel_level <= 25:
            add_factor(
                8,
                "Fuel is low",
                f"Fuel level is {round(fuel_level, 1)}%.",
                queue_id="watch",
                tag="Low fuel",
                action="Confirm the next fueling stop with dispatch.",
            )

    if registration["days_until"] is not None:
        if registration["days_until"] < 0:
            add_factor(
                28,
                "Registration expired",
                registration["label"],
                queue_id="critical",
                tag="Registration expired",
                action="Resolve the expired registration before dispatching the truck.",
            )
        elif registration["days_until"] <= 30:
            add_factor(
                14,
                "Registration expiring soon",
                registration["label"],
                queue_id="compliance",
                tag="Registration soon",
                action="Start the renewal workflow now.",
            )
        elif registration["days_until"] <= 60:
            add_factor(
                6,
                "Registration planning window",
                registration["label"],
                queue_id="watch",
                tag="Registration watch",
                action="Queue the registration renewal follow-up.",
            )

    if coverage["driver_scores_live"] and isinstance(driver_score, (int, float)):
        if driver_score < 60:
            add_factor(
                18,
                "Driver score is low",
                f"Scorecard is {round(driver_score, 1)}.",
                queue_id="coaching",
                tag="Low scorecard",
                action="Escalate coaching cadence for this driver.",
            )
        elif driver_score < 75:
            add_factor(
                8,
                "Driver score needs improvement",
                f"Scorecard is {round(driver_score, 1)}.",
                queue_id="coaching",
                tag="Score watch",
                action="Review scorecard details with the driver.",
            )

    if idle_hours >= 18:
        add_factor(
            8,
            "High idle time",
            f"Truck accumulated {idle_hours:.1f} idle hours in the current Motive window.",
            queue_id="watch",
            tag="High idle",
            action="Confirm whether the idle pattern needs an operational follow-up.",
        )

    if coverage["eld_records_live"] and not vehicle.get("eld_device") and vehicle.get("location"):
        add_factor(
            6,
            "No ELD mapped",
            "Truck is reporting activity but no ELD device summary is attached.",
            queue_id="compliance",
            tag="ELD check",
            action="Verify the device mapping for this truck in Motive.",
        )

    score = max(0, min(100, score))
    if score >= 75:
        risk_level = "Critical"
    elif score >= 50:
        risk_level = "High"
    elif score >= 25:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    if not queue_ids:
        queue_ids = ["watch"]

    primary_queue = next((queue_id for queue_id in QUEUE_ORDER if queue_id in queue_ids), "watch")
    headline = factors[0]["label"] if factors else "Stable safety profile"
    summary = factors[0]["detail"] if factors else "No significant safety signals were detected in the latest Motive snapshot."

    if not actions:
        actions = ["Keep monitoring this truck in the next Motive refresh."]

    search_terms = " ".join(
        value
        for value in [
            _clean_text(vehicle.get("number")),
            _clean_text(vehicle.get("vin")),
            _clean_text(vehicle.get("license_plate_number")),
            _clean_text(vehicle.get("fuel_type")),
            _location_label(vehicle),
            " ".join(tags),
            " ".join(item["label"] for item in factors),
            " ".join(item["detail"] for item in factors),
            " ".join(risky_behaviors),
            " ".join(actions),
        ]
        if value
    ).lower()

    return {
        "id": vehicle.get("id"),
        "number": _clean_text(vehicle.get("number")) or f"Truck {vehicle.get('id')}",
        "driver_name": _clean_text((vehicle.get("driver") or {}).get("full_name")) or _clean_text((vehicle.get("permanent_driver") or {}).get("full_name")) or "Unassigned",
        "driver_contact": _clean_text((vehicle.get("driver") or {}).get("phone")) or _clean_text((vehicle.get("driver") or {}).get("email")) or _clean_text((vehicle.get("permanent_driver") or {}).get("phone")) or _clean_text((vehicle.get("permanent_driver") or {}).get("email")),
        "vehicle_label": _vehicle_label(vehicle),
        "vin": _clean_text(vehicle.get("vin")),
        "status": _clean_text(vehicle.get("status")) or _clean_text(vehicle.get("availability_status")) or "Unknown",
        "location_label": _location_label(vehicle),
        "city": _clean_text(location.get("city")),
        "state": _clean_text(location.get("state")),
        "is_moving": bool(vehicle.get("is_moving")),
        "is_stale": bool(vehicle.get("is_stale")),
        "age_minutes": age_minutes,
        "speed_mph": location.get("speed_mph"),
        "fuel_level_percent": fuel_level,
        "active_faults": active_faults,
        "severe_faults": severe_faults,
        "pending_events": pending_events,
        "performance_events": performance_events,
        "unsafe_inspections": unsafe_inspections,
        "inspection_count": inspection_count,
        "idle_hours_7d": idle_hours,
        "drive_miles_7d": round(vehicle.get("driving_summary", {}).get("distance_miles") or 0, 1),
        "registration": registration,
        "eld_connected": bool(vehicle.get("eld_device")),
        "risk_score": score,
        "risk_level": risk_level,
        "primary_queue": primary_queue,
        "queue_ids": queue_ids,
        "headline": headline,
        "summary": summary,
        "tags": tags[:5],
        "risk_factors": factors[:6],
        "recommended_actions": actions[:5],
        "top_behaviors": risky_behaviors,
        "last_location_at": _clean_text(location.get("located_at")),
        "search_terms": search_terms,
    }


def _build_queues(vehicles: list[dict]) -> list[dict]:
    queue_items: dict[str, list[dict]] = {queue_id: [] for queue_id in QUEUE_ORDER}
    for vehicle in vehicles:
        item = {
            "vehicle_id": vehicle.get("id"),
            "number": vehicle.get("number"),
            "risk_score": vehicle.get("risk_score"),
            "risk_level": vehicle.get("risk_level"),
            "headline": vehicle.get("headline"),
            "summary": vehicle.get("summary"),
            "location_label": vehicle.get("location_label"),
            "reasons": [factor.get("label") for factor in vehicle.get("risk_factors") or []][:3],
            "actions": vehicle.get("recommended_actions") or [],
            "tags": vehicle.get("tags") or [],
        }
        for queue_id in vehicle.get("queue_ids") or [vehicle.get("primary_queue")]:
            if queue_id in queue_items:
                queue_items[queue_id].append(item)

    queues: list[dict] = []
    for queue_id in QUEUE_ORDER:
        items = sorted(queue_items[queue_id], key=lambda item: (item.get("risk_score") or 0, item.get("number") or ""), reverse=True)
        meta = QUEUE_META[queue_id]
        queues.append(
            {
                "id": queue_id,
                "label": meta["label"],
                "description": meta["description"],
                "count": len(items),
                "items": items[:18],
            }
        )
    return queues


def _build_algorithm_summary(metrics: dict, queues: list[dict], coverage: dict[str, bool]) -> dict:
    queue_map = {queue["id"]: queue for queue in queues}
    focus: list[str] = []
    if metrics["critical_units"]:
        focus.append(f"{metrics['critical_units']} truck(s) need immediate same-day safety action.")
    if metrics["maintenance_units"]:
        focus.append(f"{metrics['maintenance_units']} truck(s) have active fault pressure for maintenance.")
    if metrics["coaching_units"]:
        focus.append(f"{metrics['coaching_units']} truck(s) are in the coaching queue from Motive events.")
    if metrics["compliance_units"]:
        focus.append(f"{metrics['compliance_units']} truck(s) need compliance or telemetry follow-up.")
    if not focus:
        focus.append("No urgent safety priorities were detected in the current Motive snapshot.")

    active_signals = [
        label
        for key, label in [
            ("locations_live", "GPS telemetry"),
            ("fault_records_live", "fault codes"),
            ("performance_records_live", "safety events"),
            ("inspection_records_live", "inspections"),
            ("registration_dates_live", "registration dates"),
            ("eld_records_live", "ELD device data"),
            ("driver_scores_live", "driver scorecards"),
        ]
        if coverage.get(key)
    ]

    return {
        "name": "Safety Triage Engine",
        "version": "1.0",
        "summary": "Scores each truck from Motive safety events, fault pressure, telemetry freshness, fuel state, and compliance signals.",
        "focus": focus,
        "rules": [
            "Active fault codes raise maintenance priority.",
            "Pending coaching events and risky behaviors raise driver coaching priority.",
            "Stale telemetry, missing inspections, or registration deadlines raise compliance priority.",
            "Critical fuel levels and severe issues push trucks into immediate action.",
        ],
        "active_signals": active_signals,
        "queue_snapshot": {
            "critical": queue_map["critical"]["count"],
            "maintenance": queue_map["maintenance"]["count"],
            "coaching": queue_map["coaching"]["count"],
            "compliance": queue_map["compliance"]["count"],
            "watch": queue_map["watch"]["count"],
        },
    }


def build_safety_fleet_snapshot(snapshot: dict) -> dict:
    source_vehicles = snapshot.get("vehicles") or []
    coverage = {
        "locations_live": any(vehicle.get("location") for vehicle in source_vehicles),
        "fault_records_live": any((vehicle.get("fault_summary") or {}).get("count") for vehicle in source_vehicles),
        "performance_records_live": any((vehicle.get("performance_summary") or {}).get("count") for vehicle in source_vehicles),
        "inspection_records_live": any((vehicle.get("inspection_summary") or {}).get("count") for vehicle in source_vehicles),
        "registration_dates_live": any(_clean_text(vehicle.get("registration_expiry_date")) for vehicle in source_vehicles),
        "eld_records_live": any(vehicle.get("eld_device") for vehicle in source_vehicles),
        "driver_scores_live": any((vehicle.get("driver_scorecard") or {}).get("score") is not None for vehicle in source_vehicles),
    }

    vehicles = [_score_vehicle(vehicle, coverage) for vehicle in source_vehicles]
    vehicles.sort(key=lambda vehicle: (vehicle.get("risk_score") or 0, vehicle.get("number") or ""), reverse=True)
    queues = _build_queues(vehicles)

    queue_counts = {queue["id"]: queue["count"] for queue in queues}
    critical_units = queue_counts.get("critical", 0)
    high_risk_units = sum(1 for vehicle in vehicles if vehicle.get("risk_level") in {"Critical", "High"})
    maintenance_units = queue_counts.get("maintenance", 0)
    coaching_units = queue_counts.get("coaching", 0)
    compliance_units = queue_counts.get("compliance", 0)
    low_fuel_units = sum(1 for vehicle in vehicles if isinstance(vehicle.get("fuel_level_percent"), (int, float)) and (vehicle.get("fuel_level_percent") or 0) <= 25)
    stale_units = sum(1 for vehicle in vehicles if vehicle.get("is_stale"))
    active_fault_units = sum(1 for vehicle in vehicles if (vehicle.get("active_faults") or 0) > 0)
    event_review_units = sum(1 for vehicle in vehicles if (vehicle.get("pending_events") or 0) > 0)
    average_risk_score = round(sum(vehicle.get("risk_score") or 0 for vehicle in vehicles) / len(vehicles), 1) if vehicles else 0.0

    metrics = {
        "total_units": len(vehicles),
        "critical_units": critical_units,
        "high_risk_units": high_risk_units,
        "maintenance_units": maintenance_units,
        "coaching_units": coaching_units,
        "compliance_units": compliance_units,
        "low_fuel_units": low_fuel_units,
        "stale_units": stale_units,
        "active_fault_units": active_fault_units,
        "event_review_units": event_review_units,
        "average_risk_score": average_risk_score,
    }

    return {
        "company": snapshot.get("company") or {},
        "fetched_at": snapshot.get("fetched_at"),
        "metrics": metrics,
        "vehicles": vehicles,
        "queues": queues,
        "algorithm": _build_algorithm_summary(metrics, queues, coverage),
        "filters": {
            "risk_levels": RISK_LEVELS,
            "queue_ids": ["All", *QUEUE_ORDER],
            "focus_options": FOCUS_OPTIONS,
        },
        "warnings": snapshot.get("warnings") or [],
    }


