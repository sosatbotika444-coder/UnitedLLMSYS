from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routes.auth import router as auth_router


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Simple Auth API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
#take the realy api to get the best accuracy for that in that are  to get anyway in that interseted gans

app.include_router(auth_router, prefix="/api")


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
    

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)


