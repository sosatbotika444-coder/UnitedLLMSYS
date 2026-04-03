# Simple Full-Stack Auth Starter

This repository contains a minimal architecture with:

- `backend/`: FastAPI API with JWT auth and PostgreSQL support
- `frontend/`: React app with register/login screens

## Architecture

### Backend

- `app/config.py`: reads `.env` values and normalizes Railway PostgreSQL URLs
- `app/database.py`: SQLAlchemy engine and session setup
- `app/models.py`: `User` table
- `app/routes/auth.py`: register, login, and current-user endpoints
- `app/auth.py`: password hashing and JWT token helpers

### Frontend

- `src/App.jsx`: auth UI and token/session handling
- `src/styles.css`: simple responsive styling
- `VITE_API_URL`: frontend API base URL

## Backend setup

1. Create the backend env file:

```bash
cd backend
copy .env.example .env
```

2. Put your Railway PostgreSQL URL in `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:password@hostname:5432/railway
SECRET_KEY=replace-with-a-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://localhost:5173
```

3. Install dependencies and run the API:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API will run at `http://localhost:8000`.

## Frontend setup

1. Create the frontend env file:

```bash
cd frontend
copy .env.example .env
```

2. Install dependencies and run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at `http://localhost:5173`.

## Auth endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/health`

## Notes

- Tables are created automatically on backend startup.
- Railway often provides a `postgresql://` URL; the backend converts it automatically for SQLAlchemy.
- The frontend stores the JWT token in local storage for a simple starter implementation.
