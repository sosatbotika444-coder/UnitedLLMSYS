from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    department: Mapped[str] = mapped_column(String(32), default="fuel", nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)


class SafetyNote(Base):
    __tablename__ = "safety_notes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)



class SafetyDocument(Base):
    __tablename__ = "safety_documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    bucket: Mapped[str] = mapped_column(String(32), default="review", index=True, nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), default="other", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    issues: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, default="", nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class Load(Base):
    __tablename__ = "loads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    driver: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    truck: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    mpg: Mapped[str] = mapped_column(String(32), default="6.0", nullable=False)
    status: Mapped[str] = mapped_column(String(64), default="In Transit", nullable=False)
    miles_to_empty: Mapped[str] = mapped_column(String(32), default="1200", nullable=False)
    tank_capacity: Mapped[str] = mapped_column(String(32), default="200", nullable=False)
    fuel_level: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    pickup_city: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    stop1: Mapped[str] = mapped_column(Text, default="", nullable=False)
    stop2: Mapped[str] = mapped_column(Text, default="", nullable=False)
    stop3: Mapped[str] = mapped_column(Text, default="", nullable=False)
    delivery_city: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class RoutingRequest(Base):
    __tablename__ = "routing_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status: Mapped[str] = mapped_column(String(64), default="completed", nullable=False)
    origin_query: Mapped[str] = mapped_column(String(255), nullable=False)
    destination_query: Mapped[str] = mapped_column(String(255), nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(32), nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(32), nullable=False)
    sort_by: Mapped[str] = mapped_column(String(32), nullable=False)
    origin_label: Mapped[str] = mapped_column(String(512), nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False)
    origin_lon: Mapped[float] = mapped_column(Float, nullable=False)
    destination_label: Mapped[str] = mapped_column(String(512), nullable=False)
    destination_lat: Mapped[float] = mapped_column(Float, nullable=False)
    destination_lon: Mapped[float] = mapped_column(Float, nullable=False)
    map_link: Mapped[str] = mapped_column(Text, default="", nullable=False)
    station_map_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_source: Mapped[str] = mapped_column(Text, default="", nullable=False)
    price_support: Mapped[str] = mapped_column(Text, default="", nullable=False)
    assistant_message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    selected_stop_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_request: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class RoutingRoute(Base):
    __tablename__ = "routing_routes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    routing_request_id: Mapped[int] = mapped_column(ForeignKey("routing_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    route_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    distance_meters: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    travel_time_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    traffic_delay_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fuel_stop_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    points: Mapped[list] = mapped_column(JSON, default=list, nullable=False)


class RoutingFuelStop(Base):
    __tablename__ = "routing_fuel_stops"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    routing_request_id: Mapped[int] = mapped_column(ForeignKey("routing_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    route_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    route_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stop_rank: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stop_id: Mapped[str] = mapped_column(Text, nullable=False)
    is_top_stop: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    name: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    brand: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    city: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    address: Mapped[str] = mapped_column(Text, default="", nullable=False)
    state_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    detour_distance_meters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detour_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origin_miles: Mapped[float | None] = mapped_column(Float, nullable=True)
    off_route_miles: Mapped[float | None] = mapped_column(Float, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_less_tax: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_date: Mapped[str | None] = mapped_column(String(128), nullable=True)
    diesel_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    auto_diesel_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    unleaded_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    parking_spaces: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(128), nullable=True)
    fax: Mapped[str | None] = mapped_column(String(128), nullable=True)
    store_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    highway: Mapped[str | None] = mapped_column(String(128), nullable=True)
    exit_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    amenity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fuel_types: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    amenities: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    location_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    official_match: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

