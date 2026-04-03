from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)


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
