# Seat Reservation at Scale

A high-concurrency seat reservation API with atomic correctness guarantees under extreme load.

## Features

- **Atomic Seat Reservation**: Uses PostgreSQL `SELECT ... FOR UPDATE` with deterministic ordering to prevent double-booking
- **Idempotency**: Client-provided idempotency keys ensure exactly-once semantics
- **Per-User Limits**: Enforces configurable per-user seat limits under concurrency
- **Cancellation**: Owners can release reservations, returning seats to available pool
- **Observability**: Prometheus metrics, structured JSON logs, health endpoints
- **Burst Testing**: Built-in load testing script for validation

## API Endpoints

### Public
- `GET /health/live` - Liveness probe (always 200)
- `GET /health/ready` - Readiness probe (checks DB connectivity)
- `GET /metrics` - Prometheus metrics endpoint
- `GET /shows/:id?include_seats=false` - Show state (counts only or full seat list)

### Authenticated (Bearer JWT)
- `POST /auth/token` - Get dev token (dev only, `ENABLE_DEV_AUTH=true`)
- `POST /shows/:id/reserve` - Reserve seats
  - Body: `{ "seats": ["A1", "A2"], "idempotency_key": "optional" }`
  - Header: `Idempotency-Key` (or in body)
- `POST /reservations/:id/cancel` - Cancel reservation (owner only)

### Admin (X-Admin-Token header)
- `POST /shows` - Create show
  - Body: `{ "name": "friday-night", "seats": ["A1","A2"], "price_paise": 25000, "per_user_limit": 4 }`

## Quick Start

### Local Development
```bash
# Start services
docker compose up -d

# Run tests
npm test

# Start dev server
npm run dev
```

### Burst Test
```bash
# Local
./scripts/burst.sh http://localhost:8080 dev-admin-token-change-in-production \
  --users 1000 --requests 20000 --hot-seats "A12,A13" --retry-rate 0.15 --concurrency 500
```

## Architecture

- **Runtime**: Node.js 22 + Fastify + TypeScript
- **Database**: PostgreSQL 16 with advisory locks + row-level locks
- **Concurrency**: `SELECT ... FOR UPDATE` with deterministic ordering
- **Idempotency**: Composite unique key `(user_id, key)` + seats hash
- **Metrics**: Prometheus (`/metrics`) + structured JSON logs

## Deployment

### Render (Auto-deploy)
1. Connect GitHub repo to Render
2. Add `render.yaml` (auto-detected)
2. Set secrets: `JWT_SECRET`, `ADMIN_TOKEN`, `ENABLE_DEV_AUTH=false`
3. Push to `main` → auto-deploys

### Local + Cloudflare Tunnel
```bash
docker compose up -d
brew install cloudflared
cloudflared tunnel --url http://localhost:8080
# → https://random-name.trycloudflare.com
```

## Burst Test Validation

The burst script validates all 6 correctness requirements:
1. **No double-sell** - Exactly 1 winner per hot seat
2. **Zero 5xx** - All declines are 4xx domain outcomes
3. **Reconciliation** - `available + held + confirmed == total_seats`
4. **Idempotent retries** - Same key = same reservation, different seats = 409
5. **Per-user limit** - Enforced under concurrency
6. **Token-derived identity** - Spoofed body `user_id` ignored

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | 32+ char secret for JWT signing | Required |
| `ADMIN_TOKEN` | Admin API token | Required |
| `DATABASE_URL` | Pooled PostgreSQL connection | Required |
| `DATABASE_DIRECT_URL` | Direct PostgreSQL connection | Required |
| `ENABLE_DEV_AUTH` | Enable `/auth/token` endpoint | `false` |
| `JWT_EXPIRES_IN` | JWT expiration | `24h` |
| `METRICS_LOG_FILE` | Metrics log file path | `/tmp/metrics.log` |
| `METRICS_LOG_INTERVAL_MS` | Log interval | `30000` |