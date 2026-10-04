# Seat Reservation System - Complete Evaluator Guide

## 📋 Project Overview

**Live URL**: `https://seat-reservation-at-scale-n0bf.onrender.com`  
**Repository**: `https://github.com/maayaankk/seat-reservation-at-scale`  
**Branch**: `main` (production) / `dev` (development)

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Running with Docker](#running-with-docker)
4. [Running Locally Without Docker](#running-locally-without-docker)
5. [Running Tests](#running-tests)
6. [API Endpoint Testing](#api-endpoint-testing)
7. [Burst Testing (Load Testing)](#burst-testing-load-testing)
7. [Testing Live Endpoint](https://seat-reservation-at-scale-n0bf.onrender.com)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)

---

## ✅ Prerequisites

| Tool | Version | Install Command |
|------|---------|-----------------|
| **Node.js** | 22.x | `nvm install 22` or download from [nodejs.org](https://nodejs.org/) |
| **Docker** | Latest | [docker.com](https://docker.com) |
| **Docker Compose** | v2+ | Included with Docker Desktop |
| **PostgreSQL** | 16+ | `brew install postgresql@16` (macOS) / `apt install postgresql-16` (Ubuntu) |
| **Git** | Latest | `git --version` |
| **pnpm/npm** | 9+ / 10+ | Included with Node.js |

---

## 🏠 Local Development Setup

### Option 1: Running with Docker (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/maayaankk/seat-reservation-at-scale.git
cd seat-reservation-at-scale

# 3. Start all services (PostgreSQL + App)
docker compose up -d

# 4. Verify services are running
docker compose ps

# 5. Check logs
docker compose logs -f app
```

**Expected Output:**
```
NAME                     STATUS
seat-reservation-db      Up (healthy)
seat-reservation-app     Up (healthy)
```

### Access Points (Local Docker)
| Service | URL |
|---------|-----|
| API | `http://localhost:8080` |
| PostgreSQL | `localhost:5432` |
| Health Check | `http://localhost:8080/health/live` |

### Option 2: Build & Run Standalone Container

```bash
# Build image
docker build -t seat-reservation:local .

# Run with external PostgreSQL (replace with your DB URL)
docker run -d --name seat-reservation \
  -p 8080:8080 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e DATABASE_DIRECT_URL=postgres://user:pass@host:5432/dbname \
  -e JWT_SECRET=your-32-char-secret \
  -e ADMIN_TOKEN=your-admin-token \
  -e ENABLE_DEV_AUTH=true \
  -e NODE_ENV=production \
  -e PORT=8080 \
  seat-reservation:latest
```

### Option 3: Download Pre-built Docker Image from GitHub Actions (No Local Build Required)

The GitHub Actions CI pipeline builds and publishes a Docker image as an artifact on every push to `dev` and `main` branches. You can download and run the pre-built image without building locally:

```bash
# 1. Go to the GitHub Actions page:
# https://github.com/maayaankk/seat-reservation-at-scale/actions

# 2. Click on the latest successful "CI" workflow run (from dev or main branch)

# 3. Download the "seat-reservation-image" artifact (seat-reservation.tar.gz)

# 4. Extract and load the image
gunzip -c seat-reservation.tar.gz | docker load

# 5. Verify the image is loaded
docker images | grep seat-reservation

# 6. Run the container (with your environment variables)
docker run -d --name seat-reservation \
  -p 8080:8080 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e DATABASE_DIRECT_URL=postgres://user:pass@host:5432/dbname \
  -e JWT_SECRET=your-32-char-secret \
  -e ADMIN_TOKEN=your-admin-token \
  -e ENABLE_DEV_AUTH=true \
  -e NODE_ENV=production \
  -e PORT=8080 \
  seat-reservation:ci
```

**Alternative: One-liner download and run**
```bash
# Download and run in one go (requires gh CLI authenticated)
gh run download -R maayaankk/seat-reservation-at-scale -n seat-reservation-image
gunzip -c seat-reservation.tar.gz | docker load
docker run -d -p 8080:8080 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e DATABASE_DIRECT_URL=postgres://user:pass@host:5432/dbname \
  -e JWT_SECRET=your-32-char-secret \
  -e ADMIN_TOKEN=your-admin-token \
  -e ENABLE_DEV_AUTH=true \
  -e NODE_ENV=production \
  seat-reservation:ci
```

---

## 💻 Running Locally Without Docker

### Prerequisites
- PostgreSQL 16 running locally
- Node.js 22+

### Setup Steps

```bash
# 1. Clone and install
git clone https://github.com/maayaankk/seat-reservation-at-scale.git
cd seat-reservation-at-scale
npm ci

# 2. Create .env file
cp .env.example .env
# Edit .env with your local PostgreSQL credentials:
# DATABASE_URL=postgres://user:pass@localhost:5432/seat_reservation
# DATABASE_DIRECT_URL=postgres://user:pass@localhost:5432/seat_reservation
# JWT_SECRET=your-32-char-secret
# ADMIN_TOKEN=your-admin-token
# ENABLE_DEV_AUTH=true
# NODE_ENV=development

# 3. Run migrations
npm run migrate

# 4. Start development server
npm run dev

# Server runs at http://localhost:8080
```

### Quick Start Script
```bash
#!/bin/bash
# quick-start.sh
set -e

echo "🚀 Starting Seat Reservation System..."

# Check PostgreSQL
if ! pg_isready -q; then
  echo "❌ PostgreSQL not running. Start with: brew services start postgresql@16"
  exit 1
fi

# Create database if not exists
createdb seat_reservation 2>/dev/null || true

# Run migrations
npm run migrate

# Start server
echo "🚀 Starting server on http://localhost:8080"
npm run dev
```

---

## 🧪 Running Tests

### All Tests
```bash
# Run all tests (66 tests)
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test test/load.test.ts
npm test test/chaos.test.ts
npm test test/concurrency.test.ts
```

### Expected Output
```
Test Files  13 passed (13)
Tests       66 passed (66)
```

### Test Categories
| Test File | Tests | Coverage |
|-----------|-------|----------|
| `auth.test.ts` | 6 | JWT, auth, admin guard |
| `shows.test.ts` | 11 | CRUD, validation |
| `concurrency.test.ts` | 3 | Hot seat, multi-seat, all-or-nothing |
| `idempotency.test.ts` | 3 | Replay, conflict, cross-user |
| `limits.test.ts` | 3 | Per-user limit, cancel frees slot |
| `cancel.test.ts` | 4 | Owner cancel, idempotent, rebooking |
| `invariants.test.ts` | 3 | Reconciliation invariant |
| `metrics.test.ts` | 9 | Counters, gauges, reconciliation |
| `migration.test.ts` | 4 | Idempotent, constraints, indexes |

---

## 🧪 API Endpoint Testing

### Base URLs
| Environment | Base URL |
|-------------|----------|
| Local | `http://localhost:8080` |
| Docker | `http://localhost:8080` |
| **Live (Render)** | `https://seat-reservation-at-scale-n0bf.onrender.com` |

---

## 🧪 API Endpoint Testing

### 1. Health Endpoints

```bash
# Liveness probe (always 200)
curl -s https://seat-reservation-at-scale-n0bf.onrender.com/health/live
# Response: {"status":"ok"}

# Readiness probe (checks DB)
curl https://seat-reservation-at-scale-n0bf.onrender.com/health/ready
# {"status":"ready"} or {"status":"not ready","reason":"db unavailable"}
```

### 2. Authentication

```bash
# Get dev token (requires ENABLE_DEV_AUTH=true)
curl -s -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test-user"}'

# Response:
# {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","expires_in":86400}
```

**Save token for subsequent requests:**
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test-user"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
```

### 2. Admin Endpoints (Require `X-Admin-Token`)

#### Create Show
```bash
curl -s -X POST http://localhost:8080/shows \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: dev-admin-token-change-in-production" \
  -d '{"name":"friday-night","seats":["A1","A2","A3","A12"],"price_paise":25000,"per_user_limit":4}'
```

**Response:**
```json
{
  "id": "uuid",
  "name": "friday-night",
  "price_paise": 25000,
  "per_user_limit": 4,
  "total_seats": 4,
  "available": 4,
  "held": 0,
  "confirmed": 0,
  "seats": [
    {"label":"A1","status":"available"},
    {"label":"A2","status":"available"}
  ]
}
```

#### Get Show (Full)
```bash
curl -s "http://localhost:8080/shows/{show_id}"
```

#### Get Show (Counts Only - Fast)
```bash
curl "https://seat-reservation-at-scale-n0bf.onrender.com/shows/{show_id}?include_seats=false"
```

### 3. Reservation Endpoints (Authenticated)

#### Reserve Seats
```bash
TOKEN="your-jwt-token"
SHOW_ID="your-show-id"

curl -s -X POST "http://localhost:8080/shows/${SHOW_ID}/reserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Idempotency-Key: unique-key-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"seats":["A1","A2"]}'
```

**Success Response (201):**
```json
{
  "reservation_id": "uuid",
  "show_id": "uuid",
  "user_id": "test-user",
  "seats": ["A1","A2"],
  "amount_paise": 50000,
  "status": "confirmed"
}
```

**Error Responses:**
| Code | Error | Reason |
|------|-------|--------|
| 409 | `SEAT_TAKEN` | Seat already reserved |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key, different seats |
| 409 | `USER_LIMIT_EXCEEDED` | Exceeds per_user_limit |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key, different seats |
| 404 | `SEAT_NOT_FOUND` | Seat doesn't exist |
| 409 | `PER_USER_LIMIT_EXCEEDED` | Exceeds limit |

#### Idempotent Retry (Same Key)
```bash
# First request
curl -X POST ... -H "Idempotency-Key: key-1" -d '{"seats":["A1"]}'
# Response: 201 with reservation

# Retry with SAME key
curl -X POST ... -H "Idempotency-Key: same-key" -d '{"seats":["A1"]}'
# Returns 201 with SAME reservation (isReplay: true)
```

**Same key, different seats → 409 IDEMPOTENCY_CONFLICT**

#### Cancel Reservation
```bash
curl -s -X POST http://localhost:8080/reservations/${RESERVATION_ID}/cancel \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

**Response (200):**
```json
{
  "reservation_id": "uuid",
  "show_id": "uuid",
  "user_id": "test-user",
  "seats": ["A1"],
  "amount_paise": 25000,
  "status": "cancelled"
}
```

---

## 🔥 Burst Testing (Load Testing)

### Local Burst Test

```bash
# Small test (1000 requests)
./scripts/burst.sh http://localhost:8080 dev-admin-token \
  --users 100 --requests 5000 \
  --hot-seats "A12,A13" --retry-rate 0.1 --concurrency 100

# Full 25k test (matches requirements)
./scripts/burst.sh http://localhost:8080 dev-admin-token \
  --users 1000 --requests 25000 \
  --hot-seats "A12,A13,A14,A15,A16" \
  --retry-rate 0.15 --concurrency 500
```

### Live Burst Test (Against Render)

```bash
# Get admin token from Render dashboard
ADMIN_TOKEN="your-admin-token-from-render-dashboard"

./scripts/burst.sh https://seat-reservation-at-scale-n0bf.onrender.com \
  <ADMIN_TOKEN> \
  --users 1000 --requests 25000 \
  --hot-seats "A12,A13,A14,A15,A16" \
  --retry-rate 0.15 --concurrency 500 --timeout-ms 30000
```

### Burst Script Options
```bash
./scripts/burst.sh <BASE_URL> <ADMIN_TOKEN> [OPTIONS]

Options:
  --users N           Number of simulated users (default: 5000)
  --requests N        Total reservation attempts (default: 20000)
  --hot-seats "A1,A2" Comma-separated hot seats (default: "A12")
  --retry-rate FLOAT  Retry probability 0-1 (default: 0.15)
  --concurrency N     Max concurrent requests (default: 500)
  --timeout-ms N      Request timeout ms (default: 30000)
  --json-out FILE     Save results to JSON file
```

### Expected Burst Test Output
```
=== BURST TEST SUMMARY ===
Total requests: 25000
201 (new): 935
201 (replay): 142
409: 24065
  SEAT_TAKEN: 17498
  USER_LIMIT_EXCEEDED: 1191
  IDEMPOTENCY_CONFLICT: 1193
5xx: 0
Client timeouts: 0
Latency p50: 2130ms, p95: 3865ms, p99: 7473ms

Hot seat winners:
  A12: user_7
  A13: user_4
  A14: user_2
  A15: user_1
  A15: user_5

Invariant check: PASSED
  available=65, held=0, confirmed=935, total=1000

Metrics reconciliation: PASSED
  Expected 201: 935, Actual: 935

Health ready: OK

=== BURST TEST PASSED ===
```

---

## 🌐 Testing Live Endpoint

### Live URL
```
https://seat-reservation-at-scale-n0bf.onrender.com
```

### Pre-Deployment Checklist
- [ ] Render PostgreSQL created and attached
- [ ] Environment variables set in Render dashboard
- [ ] Auto-deploy from `main` branch enabled
- [ ] Health checks passing

### Live Endpoint Testing

```bash
# Set live URL
LIVE_URL="https://seat-reservation-at-scale-n0bf.onrender.com"
ADMIN_TOKEN="your-admin-token-from-render-dashboard"

# 1. Health checks
curl -s https://seat-reservation-at-scale-n0bf.onrender.com/health/live
curl https://seat-reservation-at-scale-n0bf.onrender.com/health/ready

# 2. Create show (admin)
curl -s -X POST "https://seat-reservation-at-scale-n0bf.onrender.com/shows" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: YOUR_ADMIN_TOKEN" \
  -d '{"name":"live-test","seats":["A1","A2","A12"],"price_paise":25000,"per_user_limit":4}'

# 3. Get token
TOKEN=$(curl -s -X POST "https://seat-reservation-at-scale-n0bf.onrender.com/auth/token" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test-user"}' | jq -r .token)

# 4. Reserve seat
curl -s -X POST "https://seat-reservation-at-scale-n0bf.onrender.com/shows/${SHOW_ID}/reserve" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"seats":["A1"]}'

# 4. Verify idempotency
curl -X POST ... -H "Idempotency-Key: same-key" -d '{"seats":["A1"]}'
# Should return SAME reservation (isReplay: true)

# 5. Test cancellation
curl -X POST "https://seat-reservation-at-scale-n0bf.onrender.com/reservations/${RES_ID}/cancel" \
  -H "Authorization: Bearer ${TOKEN}"

# 5. Check metrics
curl https://seat-reservation-at-scale-n0bf.onrender.com/metrics
```

### Live Burst Test
```bash
./scripts/burst.sh https://seat-reservation-at-scale-n0bf.onrender.com <ADMIN_TOKEN> \
  --users 1000 --requests 25000 \
  --hot-seats "A12,A13,A14,A15,A16" \
  --retry-rate 0.15 --concurrency 500 --timeout-ms 30000
```

### Expected Live Results
| Requirement | Expected |
|-------------|----------|
| No double-sell | ✅ Exactly 1 winner per hot seat |
| Zero 5xx | ✅ All declines are 4xx |
| Reconciliation | ✅ `available + held + confirmed == total_seats` |
| Idempotent retries | ✅ Same key = same reservation |
| Per-user limit | ✅ Enforced under concurrency |
| Identity | ✅ Token-derived only |

---

## 📚 API Reference

### Base URLs
| Environment | Base URL |
|-------------|----------|
| Local | `http://localhost:8080` |
| Docker | `http://localhost:8080` |
| **Live (Render)** | `https://seat-reservation-at-scale-n0bf.onrender.com` |

### Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health/live` | None | Liveness probe |
| GET | `/health/ready` | None | Readiness probe (DB check) |
| GET | `/metrics` | None | Prometheus metrics |
| POST | `/auth/token` | None | Get dev JWT (dev only) |
| POST | `/shows` | Admin | Create show |
| GET | `/shows/:id` | Public | Get show with seats |
| GET | `/shows/:id?include_seats=false` | Public | Get show counts only |
| POST | `/shows/:id/reserve` | User + Idempotency | Reserve seats |
| POST | `/reservations/:id/cancel` | Owner | Cancel reservation |
| GET | `/metrics` | None | Prometheus metrics |

### Request/Response Examples

#### Create Show (Admin)
```bash
POST /shows
Headers: Content-Type: application/json, X-Admin-Token: <token>
Body: {"name":"friday-night","seats":["A1","A2","A12"],"price_paise":25000,"per_user_limit":4}
```

#### Reserve Seats
```bash
POST /shows/:id/reserve
Headers: Authorization: Bearer <token>, Idempotency-Key: <key>, Content-Type: application/json
Body: {"seats":["A1","A12"]}
```

#### Cancel Reservation
```bash
POST /reservations/:id/cancel
Authorization: Bearer <token>
```

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` | Check PostgreSQL running, `DATABASE_URL` correct |
| `401 Unauthorized` | Check JWT_SECRET, token not expired |
| `409 SEAT_TAKEN` | Seat already reserved, try different seat |
| `409 IDEMPOTENCY_CONFLICT` | Same key, different seats |
| `409 USER_LIMIT_EXCEEDED` | User hit per-user limit |
| `503 /health/ready` | DB not ready, check `DATABASE_URL` |
| Docker build fails | Check Docker daemon running, `docker build --no-cache` |
| Tests timeout | Increase timeout in `vitest.config.ts` |

---

## 🚀 Quick Reference Card

```bash
# === QUICK START ===
git clone https://github.com/maayaankk/seat-reservation-at-scale.git
cd seat-reservation-at-scale
docker compose up -d
npm test

# === LIVE TESTING ===
LIVE_URL="https://seat-reservation-at-scale-n0bf.onfly.io"
ADMIN_TOKEN="your-admin-token"
USER_TOKEN=$(curl -s -X POST $LIVE_URL/auth/token \
  -H "Content-Type: application/json" -d '{"user_id":"test"}' | jq -r .token)

# Create show
curl -X POST $LIVE_URL/shows \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"name":"friday-night","seats":["A1","A2","A12"],"price_paise":25000}'

# Reserve
curl -X POST $LIVE_URL/shows/$SHOW_ID/reserve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: unique-key" \
  -d '{"seats":["A12"]}'

# Burst test
./scripts/burst.sh $LIVE_URL $ADMIN_TOKEN \
  --users 1000 --requests 25000 \
  --hot-seats "A12,A13" --retry-rate 0.2 --concurrency 500
```

---

## 🚀 Deployment (Render)

### Prerequisites
- Render account connected to GitHub
- Repository: `maayaankk/seat-reservation-at-scale`

### Deploy Steps
1. Go to [dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Web Service** → Connect GitHub repo
3. Render auto-detects `render.yaml` → Click **Apply**
4. **PostgreSQL**: New → PostgreSQL → Free tier → Name: `seat-reservation-db`
4. **Attach DB**: Web Service → Settings → Databases → Add `seat-reservation-db`
5. **Environment Variables** (in Render dashboard):
   ```
   JWT_SECRET=<32+ char secret>
   ADMIN_TOKEN=<secure-random-token>
   ENABLE_DEV_AUTH=false
   JWT_EXPIRES_IN=24h
   ```
6. **Deploy** → Auto-deploys on push to `main`

### Live URL
```
https://seat-reservation-at-scale-n0bf.onrender.com
```

---

## 📞 Support

- **Live URL**: https://seat-reservation-at-scale-n0bf.onrender.com
- **Repository**: https://github.com/maayaankk/seat-reservation-at-scale
- **Issues**: GitHub Issues
- **Postman Collection**: `Seat_Reservation_API.postman_collection.json` (import into Postman)

---

**Last Updated**: 2026-10-04  
**Version**: 1.0.0  
**Status**: ✅ Production Ready