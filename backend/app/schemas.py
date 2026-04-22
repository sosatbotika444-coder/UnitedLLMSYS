from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

DepartmentName = Literal["admin", "fuel", "safety", "driver"]


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    department: DepartmentName


class UserLogin(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    department: DepartmentName


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    username: str | None = None
    full_name: str
    department: DepartmentName
    is_banned: bool = False
    ban_reason: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class AdminUserCreate(BaseModel):
    email: EmailStr
    username: str | None = Field(default=None, max_length=80)
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    department: DepartmentName = "fuel"


class AdminUserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(default=None, max_length=80)
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    department: DepartmentName | None = None
    is_banned: bool | None = None
    ban_reason: str | None = Field(default=None, max_length=2000)


class AdminPasswordReset(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class AdminUserRow(UserResponse):
    load_count: int = 0
    routing_request_count: int = 0
    fuel_authorization_count: int = 0
    chat_message_count: int = 0


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class DriverVehicleMatch(BaseModel):
    vehicleId: int
    driverName: str = ""
    truckNumber: str = ""
    vehicleLabel: str = ""
    locationLabel: str = ""
    fuelLevelPercent: float | None = None
    status: str = ""
    matched: str = ""


class DriverAuthBase(BaseModel):
    truckNumber: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    vehicleId: int = Field(ge=1)


class DriverRegister(DriverAuthBase):
    pass


class DriverLogin(DriverAuthBase):
    pass


class DriverProfile(BaseModel):
    vehicleId: int
    driverName: str = ""
    truckNumber: str = ""
    match: DriverVehicleMatch
    vehicle: dict[str, Any] = Field(default_factory=dict)
    fleetSnapshot: dict[str, Any] = Field(default_factory=dict)


class SafetyNoteUpdate(BaseModel):
    content: str = Field(default="", max_length=12000)


class SafetyNoteResponse(BaseModel):
    content: str = ""
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}



class SafetyDocumentUpload(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="", max_length=128)
    data_url: str = Field(min_length=10, max_length=14_000_000)


class SafetyDocumentResponse(BaseModel):
    id: int
    file_name: str
    content_type: str
    bucket: Literal["approved", "review", "bad"]
    document_type: str
    summary: str
    issues: list[str] = Field(default_factory=list)
    recommended_action: str
    excerpt: str = ""
    created_at: datetime | None = None

    model_config = {"from_attributes": True}



class SafetyInvestigationBase(BaseModel):
    title: str = Field(default="New safety investigation", max_length=255)
    type: str = Field(default="Accident", max_length=80)
    status: str = Field(default="Intake", max_length=80)
    severity: str = Field(default="Elevated", max_length=80)
    owner: str = Field(default="Safety", max_length=255)
    dueDate: str = Field(default="", max_length=32)
    vehicleId: str = Field(default="", max_length=128)
    facts: str = Field(default="", max_length=30000)
    evidence: str = Field(default="", max_length=30000)
    questions: str = Field(default="", max_length=30000)
    actionPlan: str = Field(default="", max_length=30000)
    outcome: str = Field(default="", max_length=30000)


class SafetyInvestigationCreate(SafetyInvestigationBase):
    pass


class SafetyInvestigationUpdate(SafetyInvestigationBase):
    pass


class SafetyInvestigationResponse(SafetyInvestigationBase):
    id: int
    createdBy: str = ""
    createdByEmail: str = ""
    createdByDepartment: str = ""
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class SafetyBriefChecklistItem(BaseModel):
    id: str = Field(default="", max_length=128)
    label: str = Field(default="", max_length=500)
    done: bool = False


class SafetyBriefActionItem(BaseModel):
    id: str = Field(default="", max_length=128)
    source: str = Field(default="Manual", max_length=80)
    title: str = Field(default="", max_length=1000)
    queueId: str = Field(default="", max_length=80)
    queueLabel: str = Field(default="", max_length=120)
    driverName: str = Field(default="", max_length=255)
    contact: str = Field(default="", max_length=255)
    truckNumber: str = Field(default="", max_length=120)
    riskLevel: str = Field(default="", max_length=80)
    riskScore: str | int | float = ""
    status: str = Field(default="Open", max_length=80)
    owner: str = Field(default="Safety", max_length=255)
    dueDate: str = Field(default="Today", max_length=80)
    notes: str = Field(default="", max_length=12000)
    summary: str = Field(default="", max_length=12000)
    recommendedAction: str = Field(default="", max_length=12000)


class SafetyShiftBriefBase(BaseModel):
    title: str = Field(default="Shift Brief", max_length=255)
    shift: str = Field(default="Day Shift", max_length=120)
    status: str = Field(default="Open", max_length=80)
    owner: str = Field(default="Safety", max_length=255)
    handoffNote: str = Field(default="", max_length=30000)
    checklist: list[SafetyBriefChecklistItem] = Field(default_factory=list)
    actions: list[SafetyBriefActionItem] = Field(default_factory=list)
    snapshotAt: str = Field(default="", max_length=80)


class SafetyShiftBriefCreate(SafetyShiftBriefBase):
    pass


class SafetyShiftBriefUpdate(SafetyShiftBriefBase):
    pass


class SafetyShiftBriefResponse(SafetyShiftBriefBase):
    id: int
    createdBy: str = ""
    createdByEmail: str = ""
    createdByDepartment: str = ""
    createdAt: datetime | None = None
    updatedAt: datetime | None = None

class TeamChatAuthor(BaseModel):
    id: int
    fullName: str = ""
    email: str = ""
    department: DepartmentName


class TeamChatReplyPreview(BaseModel):
    id: int
    body: str = ""
    authorName: str = ""
    department: DepartmentName | str = "fuel"
    createdAt: datetime | None = None
    isDeleted: bool = False


class TeamChatMessageCreate(BaseModel):
    room: str = Field(default="general", min_length=1, max_length=64)
    body: str = Field(min_length=1, max_length=4000)
    replyToId: int | None = Field(default=None, ge=1)


class TeamChatMessageUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TeamChatMessageResponse(BaseModel):
    id: int
    room: str
    body: str
    author: TeamChatAuthor
    replyTo: TeamChatReplyPreview | None = None
    isOwn: bool = False
    isDeleted: bool = False
    createdAt: datetime | None = None
    updatedAt: datetime | None = None
    editedAt: datetime | None = None

class LoadBase(BaseModel):
    driver: str = Field(default="", max_length=255)
    truck: str = Field(default="", max_length=64)
    mpg: str = Field(default="6.0", max_length=32)
    status: str = Field(default="In Transit", max_length=64)
    miles_to_empty: str = Field(default="1200", max_length=32)
    tank_capacity: str = Field(default="200", max_length=32)
    fuel_level: int = Field(default=50, ge=0, le=100)
    pickup_city: str = Field(default="", max_length=255)
    stop1: str = ""
    stop2: str = ""
    stop3: str = ""
    delivery_city: str = Field(default="", max_length=255)
    customer_name: str = Field(default="", max_length=255)
    broker_name: str = Field(default="", max_length=255)
    load_number: str = Field(default="", max_length=128)
    pickup_appt_at: str = Field(default="", max_length=64)
    delivery_appt_at: str = Field(default="", max_length=64)
    rate_total: str = Field(default="0", max_length=32)
    driver_pay_total: str = Field(default="0", max_length=32)
    detention_free_minutes: str = Field(default="120", max_length=32)
    detention_rate_per_hour: str = Field(default="50", max_length=32)
    lumper_cost: str = Field(default="0", max_length=32)
    toll_cost: str = Field(default="0", max_length=32)
    other_accessorials: str = Field(default="0", max_length=32)
    manual_fuel_cost: str = Field(default="0", max_length=32)
    manual_total_miles: str = Field(default="0", max_length=32)
    manual_deadhead_miles: str = Field(default="0", max_length=32)
    manual_loaded_miles: str = Field(default="0", max_length=32)


class LoadCreate(LoadBase):
    pass


class LoadUpdate(LoadBase):
    pass


class LoadResponse(LoadBase):
    id: int
    user_id: int

    model_config = {"from_attributes": True}


class FullRoadTripBase(BaseModel):
    loadId: int | None = Field(default=None, ge=1)
    vehicleId: int | None = Field(default=None, ge=1)
    truckNumber: str = Field(default="", max_length=128)
    driverName: str = Field(default="", max_length=255)
    pickup: str = Field(default="", max_length=512)
    delivery: str = Field(default="", max_length=512)
    stage: str = Field(default="enroute_pickup", max_length=64)
    tankCapacityGallons: float = Field(default=0, ge=0)
    mpg: float = Field(default=0, ge=0)
    currentFuelGallons: float = Field(default=0, ge=0)
    fuelPercent: float | None = Field(default=None, ge=0, le=100)
    toPickupPlan: dict[str, Any] = Field(default_factory=dict)
    toDeliveryPlan: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    live: dict[str, Any] = Field(default_factory=dict)


class FullRoadTripCreate(FullRoadTripBase):
    pass


class FullRoadTripUpdate(FullRoadTripBase):
    pass


class FullRoadTripResponse(FullRoadTripBase):
    id: int
    userId: int
    isArchived: bool = False
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class RouteAssistantRequest(BaseModel):
    origin: str = Field(min_length=2, max_length=255)
    destination: str = Field(min_length=2, max_length=255)
    vehicle_id: int | None = None
    vehicle_number: str = Field(default="", max_length=128)
    driver_name: str = Field(default="", max_length=255)
    vehicle_type: str = Field(default="Truck", max_length=32)
    fuel_type: str = Field(default="Auto Diesel", max_length=32)
    current_fuel_gallons: float | None = Field(default=None, ge=0)
    tank_capacity_gallons: float | None = Field(default=None, gt=0)
    mpg: float | None = Field(default=None, gt=0)
    allow_no_fuel: bool = False
    allow_missing_cost: bool = True
    allow_unattended: bool = False
    sort_by: str = Field(default="distance", max_length=32)
    price_target: float | None = Field(default=None, gt=0)
    start_range: str = Field(default="", max_length=8)
    full_range: str = Field(default="", max_length=8)
    amenities: list[str] = []
    affiliations: list[str] = []


class RoutePoint(BaseModel):
    lat: float
    lon: float


class GeocodedPoint(BaseModel):
    label: str
    lat: float
    lon: float


class LocationSuggestion(BaseModel):
    id: str
    label: str
    secondary_text: str = ""
    lat: float
    lon: float
    type: str | None = None


class LocationSuggestionResponse(BaseModel):
    query: str
    suggestions: list[LocationSuggestion] = Field(default_factory=list)


class FuelStop(BaseModel):
    id: str
    name: str
    brand: str
    city: str = ""
    address: str
    state_code: str | None = None
    postal_code: str | None = None
    lat: float
    lon: float
    detour_distance_meters: int | None = None
    detour_time_seconds: int | None = None
    origin_miles: float | None = None
    off_route_miles: float | None = None
    fuel_types: list[str] = []
    price: float | None = None
    price_less_tax: float | None = None
    price_source: str | None = None
    price_date: str | None = None
    price_status: str | None = None
    price_updated_at: str | None = None
    diesel_price: float | None = None
    auto_diesel_price: float | None = None
    unleaded_price: float | None = None
    parking_spaces: str | None = None
    phone: str | None = None
    fax: str | None = None
    store_number: str | None = None
    highway: str | None = None
    exit_number: str | None = None
    amenity_score: float | None = None
    overall_score: float | None = None
    source_url: str | None = None
    amenities: list[str] = []
    location_type: str | None = None
    official_match: bool = False


class RouteOption(BaseModel):
    id: str
    label: str
    distance_meters: int
    travel_time_seconds: int
    traffic_delay_seconds: int
    points: list[RoutePoint]
    fuel_stops: list[FuelStop]


class FuelStrategyStop(BaseModel):
    sequence: int
    stop: FuelStop
    route_miles: float
    miles_to_next: float
    gallons_to_buy: float
    estimated_cost: float
    fuel_before_gallons: float
    fuel_after_gallons: float
    auto_diesel_price: float
    safety_buffer_miles: float = 0
    reason: str
    next_target_label: str


class FuelStrategy(BaseModel):
    status: str
    route_id: str | None = None
    route_label: str | None = None
    total_route_miles: float = 0
    current_fuel_gallons: float = 0
    tank_capacity_gallons: float = 0
    mpg: float = 0
    starting_range_miles: float = 0
    full_tank_range_miles: float = 0
    required_purchase_gallons: float = 0
    estimated_fuel_cost: float = 0
    estimated_detour_time_seconds: int = 0
    estimated_service_time_seconds: int = 0
    estimated_total_time_seconds: int = 0
    decision_score: float = 0
    stop_count: int = 0
    max_stop_count: int = 3
    price_target: float | None = None
    price_target_breach_count: int = 0
    price_target_total_overage: float = 0
    price_target_max_overage: float = 0
    stops: list[FuelStrategyStop] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    map_link: str | None = None
    safety_buffer_policy: str = ""


class RouteAssistantResponse(BaseModel):
    routing_request_id: int | None = None
    origin: GeocodedPoint
    destination: GeocodedPoint
    routes: list[RouteOption]
    top_fuel_stops: list[FuelStop]
    selected_stop: FuelStop | None = None
    fuel_strategy: FuelStrategy | None = None
    assistant_name: str = "UnitedLane"
    assistant_message: str = ""
    price_support: str
    map_link: str
    station_map_link: str | None = None
    data_source: str = "FindFuelStops"


class RouteHistoryUser(BaseModel):
    id: int
    full_name: str
    email: str
    username: str | None = None
    department: DepartmentName


class RouteHistoryRoute(BaseModel):
    id: int
    route_id: str
    label: str
    distance_meters: int
    travel_time_seconds: int
    traffic_delay_seconds: int
    fuel_stop_count: int


class RouteHistoryFuelStop(BaseModel):
    id: int
    stop_id: str
    route_id: str | None = None
    route_label: str | None = None
    stop_rank: int
    is_top_stop: bool = False
    is_selected: bool = False
    name: str = ""
    brand: str = ""
    city: str = ""
    address: str = ""
    state_code: str | None = None
    lat: float
    lon: float
    off_route_miles: float | None = None
    auto_diesel_price: float | None = None
    diesel_price: float | None = None
    price: float | None = None
    price_date: str | None = None
    source_url: str | None = None


class RouteHistoryItem(BaseModel):
    id: int
    created_at: datetime
    status: str
    user: RouteHistoryUser
    origin_query: str
    destination_query: str
    origin_label: str
    destination_label: str
    vehicle_id: int | None = None
    vehicle_number: str = ""
    driver_name: str = ""
    vehicle_type: str = ""
    fuel_type: str = ""
    sort_by: str = ""
    current_fuel_gallons: float | None = None
    tank_capacity_gallons: float | None = None
    mpg: float | None = None
    map_link: str = ""
    station_map_link: str | None = None
    data_source: str = ""
    price_support: str = ""
    assistant_message: str = ""
    selected_stop_id: str | None = None
    route_count: int = 0
    top_fuel_stop_count: int = 0
    routes: list[RouteHistoryRoute] = Field(default_factory=list)
    top_fuel_stops: list[RouteHistoryFuelStop] = Field(default_factory=list)
    selected_stop: RouteHistoryFuelStop | None = None
    fuel_strategy: dict[str, Any] | None = None


class RouteHistoryResponse(BaseModel):
    total: int
    returned: int
    items: list[RouteHistoryItem] = Field(default_factory=list)

class ApiCapability(BaseModel):
    id: str
    name: str
    category: str
    status: str
    description: str


class TomTomCapabilityCatalog(BaseModel):
    total: int
    live: int
    ready: int
    requires_access: int
    capabilities: list[ApiCapability]


class UnitedLaneChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: str = Field(default="", max_length=4000)
    image_name: str = Field(default="", max_length=255)
    image_data_url: str = Field(default="", max_length=8_000_000)


class UnitedLaneChatResponse(BaseModel):
    assistant_name: str = "Safety Team"
    message: str


class MotiveIntegrationStatus(BaseModel):
    configured: bool
    api_base_url: str
    oauth_base_url: str
    has_refresh_credentials: bool
    metric_units: bool
    time_zone: str
    fleet_user_id: int | None = None


class MotiveCompanySummary(BaseModel):
    id: int | None = None
    name: str
    dot_number: str | None = None
    time_zone: str | None = None
    address: str | None = None


class MotiveUserSummary(BaseModel):
    id: int | None = None
    full_name: str
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    status: str | None = None
    duty_status: str | None = None
    time_zone: str | None = None


class MotiveVehicleLocation(BaseModel):
    lat: float | None = None
    lon: float | None = None
    city: str | None = None
    state: str | None = None
    address: str | None = None
    located_at: str | None = None
    age_minutes: float | None = None
    speed_kph: float | None = None
    speed_mph: float | None = None
    bearing: float | None = None
    engine_state: str | None = None


class MotiveVehicleSummary(BaseModel):
    id: int | None = None
    number: str
    status: str | None = None
    make: str | None = None
    model: str | None = None
    year: str | None = None
    vin: str | None = None
    fuel_type: str | None = None
    driver: MotiveUserSummary | None = None
    location: MotiveVehicleLocation | None = None
    is_moving: bool = False
    is_stale: bool = True
    location_source: str = "unavailable"
    vehicle_state: str | None = None


class MotiveFleetMetrics(BaseModel):
    total_vehicles: int = 0
    located_vehicles: int = 0
    moving_vehicles: int = 0
    stopped_vehicles: int = 0
    online_vehicles: int = 0
    stale_vehicles: int = 0
    vehicles_with_driver: int = 0
    active_drivers: int = 0


class MotiveFleetSnapshot(BaseModel):
    configured: bool
    fetched_at: str
    location_source: str
    company: MotiveCompanySummary | None = None
    metrics: MotiveFleetMetrics
    drivers: list[MotiveUserSummary] = Field(default_factory=list)
    vehicles: list[MotiveVehicleSummary] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


FuelAuthorizationStatus = Literal["approved", "sent", "used", "expired", "violated", "cancelled"]


class FuelAuthorizationCreate(BaseModel):
    routing_request_id: int | None = Field(default=None, ge=1)
    vehicle_id: int | None = Field(default=None, ge=1)
    vehicle_number: str = Field(default="", max_length=128)
    driver_name: str = Field(default="", max_length=255)
    origin_label: str = Field(default="", max_length=512)
    destination_label: str = Field(default="", max_length=512)
    route_id: str = Field(default="", max_length=64)
    route_label: str = Field(default="", max_length=128)
    station_id: str = Field(min_length=1, max_length=512)
    station_name: str = Field(default="", max_length=512)
    station_brand: str = Field(default="", max_length=255)
    station_address: str = Field(default="", max_length=2000)
    station_city: str = Field(default="", max_length=255)
    station_state: str = Field(default="", max_length=32)
    station_postal_code: str = Field(default="", max_length=32)
    station_lat: float | None = None
    station_lon: float | None = None
    station_source_url: str = Field(default="", max_length=3000)
    station_map_link: str = Field(default="", max_length=3000)
    fuel_type: str = Field(default="Auto Diesel", max_length=64)
    planned_gallons: float = Field(default=0, ge=0)
    max_gallons: float | None = Field(default=None, ge=0)
    planned_amount: float = Field(default=0, ge=0)
    max_amount: float | None = Field(default=None, ge=0)
    planned_price_per_gallon: float | None = Field(default=None, ge=0)
    max_price_per_gallon: float | None = Field(default=None, ge=0)
    price_target: float | None = Field(default=None, ge=0)
    fuel_before_gallons: float | None = Field(default=None, ge=0)
    fuel_after_gallons: float | None = Field(default=None, ge=0)
    route_miles: float | None = Field(default=None, ge=0)
    miles_to_next: float | None = Field(default=None, ge=0)
    safety_buffer_miles: float | None = Field(default=None, ge=0)
    dispatcher_note: str = Field(default="", max_length=4000)
    driver_message: str = Field(default="", max_length=8000)
    source: str = Field(default="route_assistant", max_length=64)
    status: FuelAuthorizationStatus = "approved"
    expires_at: datetime | None = None
    policy_snapshot: dict[str, Any] = Field(default_factory=dict)
    station_snapshot: dict[str, Any] = Field(default_factory=dict)
    strategy_snapshot: dict[str, Any] = Field(default_factory=dict)


class FuelAuthorizationUpdate(BaseModel):
    status: FuelAuthorizationStatus | None = None
    max_gallons: float | None = Field(default=None, ge=0)
    max_amount: float | None = Field(default=None, ge=0)
    max_price_per_gallon: float | None = Field(default=None, ge=0)
    expires_at: datetime | None = None
    dispatcher_note: str | None = Field(default=None, max_length=4000)
    driver_message: str | None = Field(default=None, max_length=8000)


class FuelAuthorizationAction(BaseModel):
    note: str = Field(default="", max_length=4000)


class FuelAuthorizationResponse(BaseModel):
    id: int
    user_id: int
    routing_request_id: int | None = None
    approval_code: str
    status: FuelAuthorizationStatus | str
    source: str = "route_assistant"
    vehicle_id: int | None = None
    vehicle_number: str = ""
    driver_name: str = ""
    origin_label: str = ""
    destination_label: str = ""
    route_id: str = ""
    route_label: str = ""
    station_id: str = ""
    station_name: str = ""
    station_brand: str = ""
    station_address: str = ""
    station_city: str = ""
    station_state: str = ""
    station_postal_code: str = ""
    station_lat: float | None = None
    station_lon: float | None = None
    station_source_url: str = ""
    station_map_link: str = ""
    fuel_type: str = "Auto Diesel"
    planned_gallons: float = 0
    max_gallons: float = 0
    planned_amount: float = 0
    max_amount: float = 0
    planned_price_per_gallon: float | None = None
    max_price_per_gallon: float | None = None
    price_target: float | None = None
    fuel_before_gallons: float | None = None
    fuel_after_gallons: float | None = None
    route_miles: float | None = None
    miles_to_next: float | None = None
    safety_buffer_miles: float | None = None
    dispatcher_note: str = ""
    driver_message: str = ""
    policy_snapshot: dict[str, Any] = Field(default_factory=dict)
    station_snapshot: dict[str, Any] = Field(default_factory=dict)
    strategy_snapshot: dict[str, Any] = Field(default_factory=dict)
    matched_purchase_id: str | None = None
    actual_purchased_at: str | None = None
    actual_vendor: str = ""
    actual_city: str = ""
    actual_state: str = ""
    actual_gallons: float | None = None
    actual_amount: float | None = None
    actual_price_per_gallon: float | None = None
    reconciliation_details: dict[str, Any] = Field(default_factory=dict)
    violation_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    approved_at: datetime | None = None
    sent_at: datetime | None = None
    expires_at: datetime | None = None
    reconciled_at: datetime | None = None

    model_config = {"from_attributes": True}


class FuelAuthorizationReconcileResult(BaseModel):
    authorization: FuelAuthorizationResponse
    status_before: str
    status_after: str
    matched: bool = False
    issues: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FuelAuthorizationBulkReconcileResponse(BaseModel):
    checked: int = 0
    matched: int = 0
    violated: int = 0
    expired: int = 0
    results: list[FuelAuthorizationReconcileResult] = Field(default_factory=list)
