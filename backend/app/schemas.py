from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


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


class LoadCreate(LoadBase):
    pass


class LoadUpdate(LoadBase):
    pass


class LoadResponse(LoadBase):
    id: int
    user_id: int

    model_config = {"from_attributes": True}


class RouteAssistantRequest(BaseModel):
    origin: str = Field(min_length=2, max_length=255)
    destination: str = Field(min_length=2, max_length=255)
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
    assistant_name: str = "UnitedLane"
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

