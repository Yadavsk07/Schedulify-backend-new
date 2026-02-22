# Schedulify Backend (Node.js + Express)

Backend implementation of the Schedulify timetable system using:
- Node.js
- Express.js
- MongoDB (Mongoose)
- JWT auth
- BCrypt password hashing

## Local Setup

1. Copy env file:
```bash
cp .env.example .env
```

2. Install:
```bash
npm install
```

3. Run:
```bash
npm run dev
```

## Render Deployment (No Docker)

Use a Render **Web Service** with:
- Environment: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: `schedulify-backend` (if monorepo)

Set environment variables in Render dashboard:
- `PORT=8080` (Render also injects `PORT`; app supports it)
- `MONGO_URI=...`
- `JWT_SECRET=...`
- `JWT_EXPIRES_IN=7d`
- `CORS_ORIGIN=https://<your-frontend-domain>`
- `ENABLE_CP_SAT=false`

## CP-SAT (Optional)

If you want CP-SAT solver:
- set `ENABLE_CP_SAT=true`
- ensure Python + `ortools` is installed in runtime

Without CP-SAT, backend uses the built-in heuristic solver.

## API Base

`/api`

## Main Endpoint Groups

- `POST /api/auth/admin/register`
- `POST /api/auth/admin/login`
- `POST /api/auth/teacher/login`
- `GET/POST/PUT/DELETE /api/teachers/:schoolId`
- `GET/POST/PUT/DELETE /api/subjects/:schoolId`
- `GET/POST/PUT/DELETE /api/classes/:schoolId`
- `GET/POST/PUT/DELETE /api/labs/:schoolId`
- `GET/POST/DELETE /api/class-subjects/:schoolId`
- `GET/PUT/POST /api/settings/:schoolId`
- `GET /api/admin/stats/:schoolId`
- `POST /api/upload/:schoolId/master`
- `POST /api/timetable/generate/school/:schoolId`
- `GET /api/timetable/class/:schoolId/:classId/:sectionId`
- `GET /api/timetable/teacher/:schoolId/:teacherId`
- `GET /api/timetable/teacher/:schoolId/:teacherId/csv`
- `GET /api/pdf/teacher/:schoolId/:teacherId`
- `GET /api/pdf/class/:schoolId/:classId/:sectionId`
- `GET /api/meta/:schoolId`
