# United Lane System

This repo is ready for a split deployment:

- `backend/` -> Railway
- `frontend/` -> Netlify
- `PostgreSQL` -> Railway managed database

## Stack

- `backend/`: FastAPI + SQLAlchemy + JWT auth
- `frontend/`: Vite + React
- `database`: PostgreSQL on Railway

## Local env

### Backend

Create `backend/.env` from `backend/.env.example`.

Required values:

```env
DATABASE_URL=postgresql://postgres:password@host:5432/railway
SECRET_KEY=replace-with-a-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://localhost:5173,https://your-netlify-site.netlify.app
TOMTOM_API_KEY=your-tomtom-api-key
```

### Frontend

Create `frontend/.env` from `frontend/.env.example`.

```env
VITE_API_URL=http://localhost:8000/api
VITE_TOMTOM_API_KEY=your-tomtom-api-key
```

## Local run

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend health check:

- `http://localhost:8000/api/health`
- `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend local URL:

- `http://localhost:5173`

## Railway backend deploy

The backend folder already includes:

- `Procfile`
- `runtime.txt`
- `railway.json`

### Steps

1. Push this repo to GitHub.
2. In Railway, create a new project.
3. Add a `PostgreSQL` service.
4. Add a second service from GitHub and set its root directory to `backend`.
5. In the backend Railway service variables, add a reference variable:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

6. In backend service settings, set the root directory to `/backend`.
7. If you use config-as-code, point Railway to `/backend/railway.json` because config files do not automatically follow the root directory.
8. Set the remaining backend env vars in Railway:

```env
SECRET_KEY=replace-with-a-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=https://your-netlify-site.netlify.app
TOMTOM_API_KEY=your-tomtom-api-key
```

9. Deploy.
10. Open `https://your-railway-backend-url/api/health` and confirm `{"status":"ok"}`.

Notes:

- Railway often gives a `postgresql://` URL; backend config normalizes it for SQLAlchemy automatically.
- Tables are created automatically on backend startup.
- If you use a custom Netlify domain, add it to `CORS_ORIGINS` too.
- Railway service-to-service startup ordering works best when the backend references Postgres with `DATABASE_URL=${{Postgres.DATABASE_URL}}`.

## Netlify frontend deploy

The repo root already includes `netlify.toml` configured to build the `frontend` app.

### Steps

1. In Netlify, import the GitHub repo.
2. Leave the repo root as-is.
3. Netlify will use:
   - base dir: `frontend`
   - build command: `npm run build`
   - publish dir: `dist`
4. Add frontend env vars in Netlify:

```env
VITE_API_URL=https://your-railway-backend-url/api
VITE_TOMTOM_API_KEY=your-tomtom-api-key
```

5. Deploy.

## Auth endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/health`

## Deployment checklist

1. Create Railway PostgreSQL.
2. Deploy backend from `backend/`.
3. Copy Railway backend URL.
4. Set `VITE_API_URL` in Netlify.
5. Set `CORS_ORIGINS` in Railway to the Netlify URL.
6. Redeploy both services after env changes.
