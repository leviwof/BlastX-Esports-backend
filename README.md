# 🎮 BlastiX Esports Backend API

![NestJS](https://img.shields.io/badge/NestJS-v11.0-E0234E?style=flat-square&logo=nestjs)
![Prisma](https://img.shields.io/badge/Prisma-v6.19-2D3748?style=flat-square&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=flat-square&logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat-square&logo=redis)
![Socket.IO](https://img.shields.io/badge/Realtime-Socket.IO-010101?style=flat-square&logo=socket.io)

High-performance, production-grade NestJS backend for **BlastiX Esports**, powering Free Fire tournament management, team rosters, race-safe registrations, point calculations, dynamic leaderboards, realtime WebSockets, and background scheduling.

---

## 🌟 Key Features

### Phase 1: Authentication & Infrastructure
- 🔐 **OTP & JWT Authentication**: Email OTP login/registration and stateless JWT token verification.
- 🌐 **Google Social Login**: Verify Google OAuth ID tokens.
- ⚙️ **App Config**: Minimum app version, maintenance state, and dynamic update URLs.
- 🛡️ **Global Filters & Interceptors**: Standardized JSON response envelope (`{ status: "success", data: ... }`) and exception handling (`{ status: "error", message: "..." }`).

### Phase 2: Free Fire Esports Engine
- 👤 **Game Profiles**: User game profile linking (`in_game_uid` 8-12 digits and `in_game_name`). Mandatory check before tournament entry.
- 👥 **Teams & Rosters**: Team creation, invite code joining, captain controls, tag validations (`2-5 chars`), and max roster limits (5 members).
- 🏆 **Tournaments & State Machine**:
  - Lifecycle state machine: `DRAFT` ➔ `UPCOMING` ➔ `REGISTRATION_OPEN` ➔ `REGISTRATION_CLOSED` ➔ `LIVE` ➔ `COMPLETED` / `CANCELLED`.
  - **Race-Safe Slot Allocation**: DB transactional conditional increments preventing overbooking under high concurrency.
  - **Room Credentials Security**: `room_id` and `room_password` return `403 Forbidden` until user is confirmed registered AND room is released.
- 📊 **Matches, Points & Leaderboard**:
  - Auto-scoring for Battle Royale (placement points + kill points) and Clash Squad.
  - Leaderboard tie-breaker rules (`total_points` ➔ `booyahs` ➔ `total_kills` ➔ `last_match_placement`).
  - Redis Sorted Set caching (`lb:tournament:{id}`) with instant fallback to PostgreSQL.
- ⚡ **Realtime WebSockets**: Socket.IO gateway (`/live` namespace) emitting live `leaderboard_updated` and `status_changed` events.
- ⏰ **Automated Scheduling**: BullMQ worker automating status transitions & room releases (with fallback interval when Redis is offline).

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **npm**: `v10.x`
- **PostgreSQL Database** (Local or Supabase)

### 2. Installation & Setup

```bash
# Clone the repository
git clone https://github.com/leviwof/BlastiX-Esports-backend.git
cd BlastiX-Esports-backend

# Install dependencies
npm install

# Setup environment configuration
cp .env.example .env
```

### 3. Environment Variables Configuration (`.env`)

Configure your `.env` file with your credentials:

```env
NODE_ENV=development
PORT=3000

# Database & Redis Connection
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true"
REDIS_URL="redis://localhost:6379"

# Security Secrets
JWT_SECRET="replace-this-with-a-32-character-secret-key"
JWT_EXPIRES_IN="30d"
OTP_PEPPER="replace-this-with-a-random-pepper"
GOOGLE_CLIENT_IDS="your-android-client-id.apps.googleusercontent.com"

# Email Configuration
SMTP_HOST="localhost"
SMTP_PORT=1025
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@blastixesports.com"

# Phase 2 Feature Flags & Configs
PAID_TOURNAMENTS_ENABLED=false
ROOM_RELEASE_MINUTES=15
```

### 4. Database Setup & Seeding

```bash
# Generate Prisma Client
npm run prisma:generate

# Run DB Migrations & Seed Default Data
npm run prisma:seed
```

### 5. Start Application

```bash
# Development mode with hot-reload
npm run start:dev

# Production build
npm run build
npm run start:prod
```

---

## 📖 API Endpoint Reference & Curl Examples

All endpoints are prefixed with `/v1`.

### 1. Users & Game Profiles

```bash
# Get Current User Profile
curl -X GET http://localhost:3000/v1/users/me \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# Update User Profile Name & Avatar
curl -X PATCH http://localhost:3000/v1/users/me \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"name": "Pro Survivor", "profile_pic": "https://example.com/avatar.png"}'

# Set Free Fire Game Profile
curl -X PUT http://localhost:3000/v1/users/me/game-profile \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"game_slug": "free_fire", "in_game_uid": "1234567890", "in_game_name": "Viper_FF"}'

# Get Free Fire Game Profile
curl -X GET http://localhost:3000/v1/users/me/game-profile?game_slug=free_fire \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 2. Teams Management

```bash
# Create Team (Requires Game Profile)
curl -X POST http://localhost:3000/v1/teams \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"name": "Viper Esports", "tag": "VPR", "game_slug": "free_fire"}'

# Get My Teams
curl -X GET http://localhost:3000/v1/teams/me \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# Join Team via Invite Code
curl -X POST http://localhost:3000/v1/teams/join \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"invite_code": "INV12345"}'

# Regenerate Team Invite Code (Captain Only)
curl -X POST http://localhost:3000/v1/teams/<TEAM_ID>/regenerate-invite \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 3. Tournaments

```bash
# Get Paginated Tournaments (Public Filters)
curl -X GET "http://localhost:3000/v1/tournaments?status=REGISTRATION_OPEN&team_mode=SQUAD&page=1&limit=20"

# Get Tournament Details (with registration status)
curl -X GET http://localhost:3000/v1/tournaments/<TOURNAMENT_ID> \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# Register for SQUAD Tournament (Captain Only)
curl -X POST http://localhost:3000/v1/tournaments/<TOURNAMENT_ID>/register \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"team_id": "<TEAM_ID>"}'

# Unregister from Tournament
curl -X DELETE http://localhost:3000/v1/tournaments/<TOURNAMENT_ID>/register \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# Get Room Credentials (Registered users only, after room release)
curl -X GET http://localhost:3000/v1/tournaments/<TOURNAMENT_ID>/room \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# Get Tournament Leaderboard
curl -X GET http://localhost:3000/v1/tournaments/<TOURNAMENT_ID>/leaderboard
```

### 4. Admin Management

```bash
# Create Tournament (Admin Only)
curl -X POST http://localhost:3000/v1/admin/tournaments \
  -H 'Authorization: Bearer <ADMIN_JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Free Fire Grand Championship",
    "format": "BATTLE_ROYALE",
    "team_mode": "SQUAD",
    "map": "BERMUDA",
    "max_slots": 12,
    "entry_fee": 0,
    "prize_pool": 100000,
    "registration_opens_at": "2026-09-20T00:00:00Z",
    "registration_closes_at": "2026-09-25T00:00:00Z",
    "starts_at": "2026-09-26T00:00:00Z"
  }'

# Update Status Transition (Admin Only)
curl -X POST http://localhost:3000/v1/admin/tournaments/<TOURNAMENT_ID>/status \
  -H 'Authorization: Bearer <ADMIN_JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"status": "REGISTRATION_OPEN"}'

# Release Room Credentials (Admin Only)
curl -X POST http://localhost:3000/v1/admin/tournaments/<TOURNAMENT_ID>/room \
  -H 'Authorization: Bearer <ADMIN_JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"room_id": "889900", "room_password": "pass", "release_now": true}'

# Bulk Record Match Results (Admin Only)
curl -X POST http://localhost:3000/v1/admin/matches/<MATCH_ID>/results \
  -H 'Authorization: Bearer <ADMIN_JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "results": [
      {"registration_id": "<REG_1>", "placement": 1, "kills": 8},
      {"registration_id": "<REG_2>", "placement": 2, "kills": 3}
    ]
  }'

# Finalize Tournament Standings (Admin Only)
curl -X POST http://localhost:3000/v1/admin/tournaments/<TOURNAMENT_ID>/finalize \
  -H 'Authorization: Bearer <ADMIN_JWT_TOKEN>'
```

---

## 📡 Realtime WebSockets (Socket.IO)

- **Namespace**: `/live`
- **Authentication**: Pass JWT token in handshake (`Authorization: Bearer <JWT_TOKEN>`)
- **Join Room**: Emit `join_tournament` with `{ "tournament_id": "<TOURNAMENT_ID>" }`
- **Events Emitted**:
  - `leaderboard_updated`: Emitted when match results are recorded or finalized.
  - `status_changed`: Emitted when tournament status changes.

---

## 🧪 Testing

Run the automated Jest test suite covering state machine transitions, points calculation, leaderboard tie-breakers, registration rules, and room credentials visibility:

```bash
# Run unit & integration tests
npm test
```

---

## 📄 License

UNLICENSED - Private Repository for BlastiX Esports.
