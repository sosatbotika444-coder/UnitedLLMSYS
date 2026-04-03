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
    fuel_type: str = Field(default="Diesel", max_length=32)


class RoutePoint(BaseModel):
    lat: float
    lon: float


class GeocodedPoint(BaseModel):
    label: str
    lat: float
    lon: float


class FuelStop(BaseModel):
    id: str
    name: str
    brand: str
    address: str
    state_code: str | None = None
    lat: float
    lon: float
    detour_distance_meters: int | None = None
    detour_time_seconds: int | None = None
    fuel_types: list[str] = []
    price: float | None = None
    price_source: str | None = None


class RouteOption(BaseModel):
    id: str
    label: str
    distance_meters: int
    travel_time_seconds: int
    traffic_delay_seconds: int
    points: list[RoutePoint]
    fuel_stops: list[FuelStop]


class RouteAssistantResponse(BaseModel):
    origin: GeocodedPoint
    destination: GeocodedPoint
    routes: list[RouteOption]
    top_fuel_stops: list[FuelStop]
    price_support: str
    map_link: str


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