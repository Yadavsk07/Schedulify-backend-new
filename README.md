# Schedulify Backend (Node.js + Express)

Backend implementation of the Schedulify timetable system using:
- Node.js
- Express.js
- MongoDB (Mongoose)
- JWT auth
- BCrypt password hashing

## Setup

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

## CP-SAT Solver Setup (OR-Tools)

Timetable generation now uses a CP-SAT solver (Python OR-Tools) first, then falls back to heuristic if unavailable.

Install OR-Tools in your Python environment:
```bash
python -m pip install ortools
```

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
