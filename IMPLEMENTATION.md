# Seat Reservation System: IMPLEMENTATION Plan v5 (Node.js + TypeScript)

Atomic seat reservation API under extreme concurrency, deployed with observability.

---

## 0. What Changed in v4

| # Change Where  |                                                                                                                                                                 |          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A               | Stack: Python/FastAPI/asyncpg → **Node 22 LTS, TypeScript (strict), Fastify, node-postgres (`pg`), zod, pino, prom-client**                                     | §3, §13  |
| 1               | Separate **write / read / ops lanes** (own pool + own semaphore each); semaphore sized to pool; `?include_seats=false`                                          | §4, §6.4 |
| 2               | **Simplified transactional reservation path**: ordered `FOR UPDATE` row locks; no `SKIP LOCKED`, deferred FK, or decline fast path | §5, §6.1 |
| 3               | **Transient DB errors retried** with a fresh connection; unrecoverable infrastructure failure may return 503 | §6.2 |
| 4               | **Replay vs confirmed metric rule** (`201 = confirmed_total + idempotent_replay`), label `per_user_limit`, series pre-initialised                               | §9       |
| 5               | Throughput: **measure first**, optional Node `cluster` with prom-client aggregation                                                                             | §11      |
| 6               | Fly checks on `/health/live` and graceful shutdown; deployment strategy is not part of correctness | §16 |
| 7               | App and Postgres in **same region**                                                                                                                             | §16      |
| 8               | Pinned deps, compose healthcheck, `.env.example`, non-root Docker user, `make up/test/burst`                                                                    | §16      |
| 9               | Malformed path IDs → 404 `NOT_FOUND`                                                                                                                            | §6.6     |
| 10              | **Time cut-line**: correctness/deployment/observability first; cluster/cleanup are optional | §2 |
| 11              | **`AI_LOG.md`** kept while building | §16 |
| 12              | `/auth/token` documented as a grader convenience, disabled in production                                                                                        | §1, §17  |

Additional gaps closed while porting (not in the fix list, but required for correctness):

- `reservations.seat_labels TEXT[]` is stored so a **replay of a cancelled reservation still returns the original seats** (seats are released on cancel, so they cannot be joined back).
- `price_paise` is capped at `1e12` and validated with `Number.isSafeInteger`, and BIGINT columns are parsed to `number`. This avoids silent precision loss in JavaScript (`amount = price × seats ≤ 5e13 < 2^53`).
- The `pg` pool's `error` event is handled. In Node an unhandled idle-client error **crashes the process**.
- Show metadata (price, limit, total) is immutable, so it is cached in memory. This removes one DB round trip per reserve.

---

## 1. How Graders Authenticate (put this at the top of README.md)

```bash
# 1. Mint a user token (dev auth is explicitly enabled for the grading environment)
curl -s -X POST $BASE/auth/token -H 'content-type: application/json' -d '{"user_id":"alice"}'
# -> {"token":"<jwt>","expires_in":86400}

# 2. Create a show (admin token provided in the submission email)
curl -s -X POST $BASE/shows -H "X-Admin-Token: $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"friday-night","seats":["A1","A2","A12"],"price_paise":25000}'

# 3. Reserve
curl -s -X POST $BASE/shows/$SHOW/reserve -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: k1' -H 'content-type: application/json' -d '{"seats":["A12"]}'

# 4. Light state check (counts only, cheap during a burst)
curl -s "$BASE/shows/$SHOW?include_seats=false"

```

- Graders may mint their own HS256 tokens with the shared `JWT_SECRET`. Identity claim is `sub`; `user_id` is accepted as a fallback.
- **`/auth/token` is a grader convenience.** It is gated by `ENABLE_DEV_AUTH` and would be disabled in production, where tokens come from a real identity provider. State this in README and WRITEUP.
- Submission includes: live URL, admin token, JWT secret (if sharing), `/metrics` URL, logs recording link.
- README states: **graded burst should run against the single deployed machine** (§9, §11).

---

## 2. Time Cut-line (build in this order)

The plan is large for about one day. Build **must-haves** first and do not start nice-to-haves until the must-haves are deployed and burst-tested.

| Must-have (build first) Nice-to-have (only if time remains)   |                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| §6.1 Reserve (atomic transaction + idempotency + limit) | §11 Cluster mode / optional cleanup policy |
| §6.3 Cancel                                                   | Additional resilience/contended-rollback tests |
| §6.4 Show state (incl. `include_seats=false`)                 | `test_contention.py`-style rollback test, extra tests                   |
| §6.5 Create show                                              | Cluster mode (§11), only if measurement demands it                      |
| §7 API, unified error format                                  | Metrics label cap, 1s scrape cache polish                               |
| Health live/ready                                             | Event-loop-lag dashboards                                               |
| Metrics (counters + DB-derived gauges)                        |                                                                         |
| Burst script                                                  |                                                                         |
| Dockerfile, compose, fly.toml, deploy                         |                                                                         |
| README grader section, WRITEUP, AI_LOG                        |                                                                         |

---

## Source of Truth

**PostgreSQL is the sole source of truth for reservation ownership.** In-memory caches, metrics, logs, and HTTP responses never determine whether a seat is available. The authoritative state is the `seats` table; `reservations` stores reservation history/ownership and `idempotency_keys` stores request identity.

## 3. Architecture Decisions

| Component Choice Rationale  |                                                                                                                                   |                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Runtime                     | **Node 22 LTS**, TypeScript `strict`, ESM                                                                                         | Event-loop I/O suits many concurrent short DB calls                                              |
| HTTP                        | **Fastify**                                                                                                                       | Low overhead, hooks for request-id/metrics, graceful `close()`, `backlog` and keep-alive control |
| Validation                  | **zod** (not Fastify's JSON-schema errors)                                                                                        | Full control of the `{error,message,code}` format                                                |
| DB driver                   | **`pg`** (node-postgres) with raw SQL                                                                                             | Atomic paths are hand-written SQL; no ORM in the hot path                                        |
| DB                          | PostgreSQL 16, managed, **same region as the app**                                                                                | Row locks, constraints, advisory locks, transactional integrity                              |
| DB URLs                     | `DATABASE_URL` (app, may be pooled), `DATABASE_DIRECT_URL` (init/migrations, direct)                                              | Poolers break session-level features                                                             |
| Prepared statements         | Never use named statements (`name:` option unset)                                                                                 | Safe behind PgBouncer / Neon pooled in transaction mode                                          |
| Workers                     | **1 Node process, 1 machine** for the graded burst; cluster only if §11 measurement demands                                       | Counters stay simple and correct                                                                 |
| Hold model                  | Reserve = `confirmed` immediately; cancel is the only release; no TTL                                                             | Matches the 201 `status: confirmed` contract                                                     |
| Partial seats               | All-or-nothing                                                                                                                    | Atomic, documented                                                                               |
| Auth                        | HS256 JWT via `jsonwebtoken` with `algorithms: ['HS256']` pinned (no alg confusion); `X-Admin-Token` via `crypto.timingSafeEqual` | Secrets via env                                                                                  |
| Idempotency                 | Separate `idempotency_keys` table, per-user, **retained for the lifetime of the reservation/show**                                                                              | No cross-user replay; cleanup never touches bookings                                             |
| Idempotency key             | Header `Idempotency-Key` or body `idempotency_key`; header wins; mismatch → 400; length 1 to 255                                  | Spec allows both                                                                                 |
| Errors                      | `{error, message, code}` for every response including validation, 404, and unhandled                                              | One format                                                                                       |
| Metrics                     | **prom-client**                                                                                                                   | Standard; default metrics include event-loop lag                                                 |
| Logging                     | **pino** JSON to stdout, `AsyncLocalStorage` for request id                                                                       | Cheap, structured                                                                                |
| Migrations                  | Idempotent `init.sql`, one transaction on the **direct** URL under `pg_advisory_xact_lock`                                        | Safe with multiple machines and poolers                                                          |
| Shutdown                    | SIGTERM → stop accepting, drain 30s, close pools                                                                                  | Graceful deployment; correctness does not depend on deployment strategy                                                                               |
| Tests                       | **vitest** against a real Postgres (compose)                                                                                      | Concurrency tests must hit the real DB                                                           |

---

## 4. Concurrency Lanes (Fix 1)

Each lane has its own pool **and** its own semaphore, so polling and health never queue behind thousands of reserves.

| Lane Used by Pool `max` Semaphore Notes  |                                          |    |                             |                                                                                   |
| ---------------------------------------- | ---------------------------------------- | -- | --------------------------- | --------------------------------------------------------------------------------- |
| **Write**                                | reserve, cancel, create show             | 30 | **30** (= pool)             | `connect()` never queues in the pool; waiting happens in memory, in the semaphore |
| **Read**                                 | `GET /shows/{id}`                        | 6  | 6                           | Never blocked by reserves                                                         |
| **Ops**                                  | `/health/ready`, `/metrics` scrape query | 2  | none (1s timeout, 1s cache) | Readiness uses its own client; liveness touches no DB                             |

Postgres connection arithmetic (write in WRITEUP): `machines × (30 + 6 + 2) = 38` per machine. This must stay under the DB `max_connections` with headroom for admin and migrations.

```ts
// lib/semaphore.ts
export class Semaphore {
  private free: number;
  private waiters: Array<() => void> = [];
  constructor(private readonly size: number) { this.free = size; }
  get queued() { return this.waiters.length; }
  get inflight() { return this.size - this.free; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>(res => this.waiters.push(res));
    try { return await fn(); }
    finally {
      const next = this.waiters.shift();
      if (next) next(); else this.free++;
    }
  }
}

```

Pool settings (all three pools):

```ts
new Pool({
  connectionString, max, connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000, keepAlive: true,
});
pool.on('error', err => log.error({ err }, 'idle pg client error')); // REQUIRED: prevents process crash

```

Do **not** use Fastify/uvicorn-style "max connections" limits that return 503. Excess requests wait in the semaphore queue and are exposed as the `reserve_queue_depth` gauge.

---

## 5. Data Model

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0 AND price_paise <= 1000000000000),
  per_user_limit INTEGER NOT NULL DEFAULT 4 CHECK (per_user_limit > 0),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  seat_count INTEGER NOT NULL,
  seat_labels TEXT[] NOT NULL,                  -- canonical sorted unique labels; original seats survive cancel
  CHECK (seat_count = cardinality(seat_labels))
  amount_paise BIGINT NOT NULL,                 -- BIGINT; parsed to JS number (bounded <= 5e13)
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
         CHECK (status IN ('confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_label VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
         CHECK (status IN ('available','held','confirmed')),
  reservation_id UUID REFERENCES reservations(id),
  UNIQUE (show_id, seat_label),
  CHECK ((status = 'available') = (reservation_id IS NULL))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL,
  show_id UUID NOT NULL,
  seats_hash TEXT NOT NULL,                     -- sha256 of sorted, de-duplicated labels
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_seats_show_status ON seats(show_id, status);
CREATE INDEX IF NOT EXISTS idx_res_user_show ON reservations(user_id, show_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS idx_seats_res ON seats(reservation_id) WHERE reservation_id IS NOT NULL;

```

`held` stays in the CHECK so the three-state invariant from the spec is representable, but the reserve path never produces it.

---

## 6. Core Flows

### 6.1 Reserve (all-or-nothing)

The reservation path deliberately keeps the correctness mechanism simple. **PostgreSQL is the sole source of truth for seat ownership.** In-memory caches, metrics, and pre-checks never decide whether a seat can be sold.

Pre-checks in TypeScript, no DB:

- JWT valid (401); key present and ≤ 255 chars (400); header/body key mismatch (400); body valid via zod (400).
- `seats`: non-empty, labels match `^[A-Za-z0-9_-]{1,50}$`, de-duplicated, count ≤ 50.
- `:id` is a UUID, otherwise 404 `NOT_FOUND`.
- Show lookup from the in-memory cache (miss → one SELECT; unknown → 404; never cache negatives).
- `seats.length > per_user_limit` → 409 `USER_LIMIT_EXCEEDED`.

The authoritative decision happens in **one PostgreSQL transaction**. Multi-seat requests lock requested seat rows in deterministic `seat_label` order. We intentionally do **not** use `SKIP LOCKED`: waiting for a conflicting row is simpler and lets the second transaction observe the committed state and return a deterministic 409.

```sql
BEGIN;

1. SELECT pg_advisory_xact_lock(hashtextextended($user_id || ':' || $show_id, 0));

2. Idempotency:
   SELECT user_id, key, show_id, seats_hash, reservation_id
   FROM idempotency_keys
   WHERE user_id=$u AND key=$k
   FOR UPDATE;

   - existing + same show + same canonical seats + reservation_id set
       → COMMIT and return original reservation (201 replay)
   - existing + different request
       → ROLLBACK and return 409 IDEMPOTENCY_CONFLICT
   - absent
       → continue

3. Limit:
   SELECT COALESCE(SUM(seat_count),0)
   FROM reservations
   WHERE user_id=$u AND show_id=$show AND status='confirmed';

   used + n > limit
       → ROLLBACK and return 409 USER_LIMIT_EXCEEDED

4. Lock the requested seats in deterministic order:
   SELECT id, seat_label, status
   FROM seats
   WHERE show_id=$show
     AND seat_label = ANY($labels::text[])
   ORDER BY seat_label COLLATE "C"
   FOR UPDATE;

5. Validate the locked rows:
   - missing label → ROLLBACK, 404 SEAT_NOT_FOUND
   - any requested seat is not `available`
       → ROLLBACK, 409 SEAT_TAKEN
   - otherwise continue

6. Generate reservation id and insert idempotency row:
   INSERT INTO idempotency_keys
     (user_id,key,show_id,seats_hash,reservation_id)
   VALUES ($u,$k,$show,$hash,$rid);

7. Claim all seats:
   UPDATE seats
   SET status='confirmed', reservation_id=$rid
   WHERE id = ANY($seat_ids);

8. Insert reservation:
   INSERT INTO reservations
     (id,show_id,user_id,seat_count,seat_labels,amount_paise,status)
   VALUES ($rid,$show,$u,$n,$labels,$n*$price,'confirmed');

9. COMMIT → 201
```

### Why this is race-free

For a hot seat such as `A12`, concurrent transactions serialize on the same PostgreSQL row lock. The first transaction that obtains the lock sees `available`, changes it to `confirmed`, inserts its reservation, and commits. The next transaction waits, then reads the now-committed `confirmed` state and returns 409. There is no read-then-write race.

For multi-seat requests, every transaction locks requested seats in the same deterministic order. This avoids lock-order inversion and therefore avoids the deadlock pattern where transaction A locks A12 then waits for A13 while transaction B locks A13 then waits for A12.

The idempotency key is created inside the same transaction as the reservation. If anything fails before commit, both the reservation and idempotency record roll back. A successful key is retained and is never silently reused for a different request.

**Canonical request identity:** `canonical_seats = sort(unique(seats))`; `seats_hash = SHA256(JSON.stringify(canonical_seats))`. Therefore `['A2','A1']` and `['A1','A2']` are the same reservation request.

There is intentionally **no idempotency-key TTL in the correctness path**. The exercise says the same idempotency key reserves exactly once. Retaining the key avoids a later key-reuse ambiguity. A cleanup policy can be introduced only if the API contract explicitly defines an expiration window.

### 6.2 Contention policy and error classes

Normal seat contention is a **domain outcome**, not an infrastructure error. A conflicting request waits for the row lock, observes the committed seat state, and returns 409 `SEAT_TAKEN`. No `SKIP LOCKED` classification or contention retry is required.

Transient PostgreSQL failures such as serialization/deadlock errors can be retried with a new transaction and fresh connection. Connection failures destroy the broken client before retrying.

```text
40P01 / 40001
    → rollback if possible
    → retry transaction with jitter

connection failure
    → do not reuse broken client
    → obtain fresh connection
    → retry transaction

retry budget exhausted / dependency unavailable
    → 503 TRY_AGAIN is an infrastructure fallback
```

The graded hot-seat burst should produce **zero 5xx under normal operation**. A 503 is not a valid response for ordinary seat contention; it is reserved for genuine infrastructure failure that could not be recovered within the request's retry/deadline policy.

A retry helper must treat transaction rollback as best-effort when the connection itself has failed:

```ts
try {
  // BEGIN ... COMMIT
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  if (connectionIsBroken(e)) client.release(true);
  else client.release();
  throw e;
}
```

### 6.3 Cancel

```
BEGIN;
SELECT id,user_id,status FROM reservations WHERE id=$1 FOR UPDATE;   -- absent: 404
user_id != token user: 403 FORBIDDEN
UPDATE reservations SET status='cancelled', cancelled_at=NOW()
  WHERE id=$1 AND user_id=$2 AND status='confirmed';                 -- rowcount tells us if WE cancelled
UPDATE seats SET status='available', reservation_id=NULL
  WHERE reservation_id=$1 AND status='confirmed';                    -- only this reservation's seats
COMMIT;

```

- Repeat cancel returns 200 with `status: cancelled` and **does not** increment cancel counters (counters bump only when the first UPDATE's rowcount is 1).
- A cancelled reservation's idempotency key still replays the original record, shown as `cancelled`. The original seats come from `seat_labels`. Document this.
- The user-limit count excludes cancelled reservations, so cancelled seats free quota.

### 6.4 Show state

Default (full) runs in a `REPEATABLE READ READ ONLY` transaction on the **read lane**:

```sql
SELECT seat_label, status FROM seats WHERE show_id=$1 ORDER BY seat_label;

```

Counts are computed from the same rows:

```json
{ "id": "...", "name": "friday-night", "price_paise": 25000, "per_user_limit": 4,
  "total_seats": 3, "available": 3, "held": 0, "confirmed": 0,
  "seats": [ {"label":"A1","status":"available"} ] }

```

**`?include_seats=false` (Fix 1)** returns the same object **without `seats`**. It is a single statement (one snapshot) and a 50k-seat show costs one tiny `GROUP BY`:

```sql
SELECT status, COUNT(*) FROM seats WHERE show_id=$1 GROUP BY status;

```

Any value other than `false`/`0` for the flag keeps the full list (the default stays unchanged). Missing statuses are reported as 0.

### 6.5 Create show

- Request: `{name, seats[], price_paise, per_user_limit?}`.
- Validation (zod, `.strict()`): seats non-empty, **max 50,000**, unique, each matching `^[A-Za-z0-9_-]{1,50}$`; `price_paise` is an integer, `Number.isSafeInteger`, `0 ≤ x ≤ 1e12` (reject floats, strings, `NaN`); `per_user_limit` positive int, default 4.
- Insert show and seats in one transaction using `INSERT ... SELECT unnest($labels::text[])`.
- Duplicate name: 409 `SHOW_EXISTS`. Missing or bad `X-Admin-Token`: 401 (`timingSafeEqual` over equal-length buffers).
- **Initialise all metric reason series for the new show** (§9).
- **Response 201:** same shape as GET /shows/{id}, every seat `available`.

### 6.6 Malformed path IDs (Fix 9)

Before any DB call, validate `:id` against a UUID regex. Non-UUID show or reservation id → **404 `NOT_FOUND`**, never 422 and never a Postgres `22P02` error leaking as a 500. A global `setNotFoundHandler` returns the same format for unknown routes.

---

## 7. API

| Method Path Auth Notes  |                           |                 |                                                                 |
| ----------------------- | ------------------------- | --------------- | --------------------------------------------------------------- |
| POST                    | /auth/token               | dev flag        | `{user_id}` returns JWT (grader convenience)                    |
| POST                    | /shows                    | `X-Admin-Token` | 201 with full show and seats                                    |
| GET                     | /shows/{id}               | public          | Snapshot with counts; `?include_seats=false` for counts only    |
| POST                    | /shows/{id}/reserve       | User JWT        | Key in header or body                                           |
| POST                    | /reservations/{id}/cancel | Owner JWT       | 403 non-owner                                                   |
| GET                     | /health/live              | public          | Always 200, never touches DB                                    |
| GET                     | /health/ready             | public          | Own connection, 1s timeout, 503 when DB down or init incomplete |
| GET                     | /metrics                  | public          | Prometheus                                                      |

Spoofed body fields (`user_id`, etc.) are never read; identity comes only from the token. Tests assert this.

**Error codes:** `SEAT_TAKEN` (409), `SEAT_NOT_FOUND` (404), `USER_LIMIT_EXCEEDED` (409), `IDEMPOTENCY_CONFLICT` (409), `INVALID_BODY` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `SHOW_EXISTS` (409), `TRY_AGAIN` (503, last resort).

---

## 8. Zero-5xx Hardening

| Risk Mitigation                                                          |                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fly proxy sheds load with its own 503**                                | `[http_service.concurrency] type="requests" hard_limit=25000 soft_limit=20000`; VM ≥ 1 GB, 2 shared vCPU                                                                                                                                          |
| **Connection backlog / file descriptors**                                | `fastify.listen({ port, host:'0.0.0.0', backlog: 8192 })`; `ulimit -n 65536` in entrypoint; `keepAliveTimeout=75_000`, `headersTimeout=76_000`, `requestTimeout=0`                                                                                |
| Pool exhaustion                                                          | Lanes (§4): semaphore = pool size; excess waits in memory. No limiter that returns 503                                                                                                                                                            |
| **Dropped DB connections**                                               | Retry class `conn` (§6.2); pool `error` handler; `keepAlive: true`                                                                                                                                                                                |
| Postgres `max_connections`                                               | `machines × 38` below the DB limit; document in WRITEUP                                                                                                                                                                                           |
| Pooler compatibility (Neon pooled / PgBouncer transaction mode)          | No named prepared statements; only `pg_advisory_xact_lock` (never session locks); no `SET` outside `SET LOCAL`                                                                                                                                    |
| Deadlock / serialization                                                 | Retry loop (§6.2)                                                                                                                                                                                                                                 |
| Validation, 404, 405, body-parse, oversized body, unsupported media type | `setErrorHandler` + `setNotFoundHandler` map **everything** (including Fastify's own 400/404/413/415 errors) into the standard format; catch-all returns 500 `INTERNAL` and is counted in `http_5xx_total` (should stay 0)                        |
| Process-level crash                                                      | `process.on('unhandledRejection'/'uncaughtException')` log fatally and begin graceful drain; Fly restarts the machine                                                                                                                             |
| Readiness during burst                                                   | Ops pool (size 2), 1s timeout; liveness never touches DB; **Fly check targets `/health/live`**                                                                                                                                                    |
| **Cold start / DB asleep**                                               | `min_machines_running=1`, `auto_stop_machines` off. On startup connect to the DB with exponential backoff (\~60s) instead of crashing. `/health/live` is 200 immediately; `/health/ready` is 503 until the DB is reachable and init has completed |
| Init races                                                               | `init.sql` in one transaction on `DATABASE_DIRECT_URL` with `pg_advisory_xact_lock`; all statements idempotent                                                                                                                                    |
| Slow or oversized requests                                               | `bodyLimit: 65536`; seats list ≤ 50 (reserve)                                                                                                                                                                                                     |
| Event-loop starvation                                                    | Keep handlers free of sync CPU work; pino async destination; watch `nodejs_eventloop_lag_seconds`                                                                                                                                                 |

---

## 9. Metrics and Logs

### 9.1 Reconciliation rules (state in README and WRITEUP)

- **Replays count separately (Fix 4).** `reservations_confirmed_total` counts **new reservations only**. A replay returns 201 but increments `reservations_declined_total{reason="idempotent_replay"}`. Therefore, for any observation window on one machine:

  **`(# of 201 responses) = reservations_confirmed_total + reservations_declined_total{reason="idempotent_replay"}`**
- `seats_available/held/confirmed{show_id}` are **DB-derived gauges**. Each scrape is an internally consistent snapshot of the `seats` table; a separately timed GET may legitimately observe a different state while writes are occurring.
- Event counters are **application-event counters** and reset on process restart. They are not used as a source of truth for current seat state. Current seat ownership always comes from DB-derived gauges.
- **Run a single machine for the graded burst.** With several machines (or cluster workers), sum counters.
- Scrape query uses the **ops pool** and a **1-second result cache**, so scraping never competes with the burst.
- Limit seat-gauge labels to the 50 most recent shows to bound cardinality.
- **Pre-initialise series.** Prometheus labelled counters do not exist until first use, which makes zero look like "missing". On show creation (and at startup for the 50 most recent shows) call `.inc(0)` / `.labels(...)` for every reason series.

### 9.2 Metric set

| Metric Type Labels                                 |                                 |                                                                                                                                       |
| -------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `reservations_confirmed_total`                     | Counter (new reservations only) | show_id                                                                                                                               |
| `reservations_declined_total`                      | Counter                         | show_id, reason ∈ {`seat_taken`, **`per_user_limit`**, `idempotent_replay`, `idempotency_conflict`, `seat_not_found`, `invalid_body`} |
| `reservations_cancelled_total`                     | Counter                         | show_id                                                                                                                               |
| `seats_confirmed_total`, `seats_cancelled_total`   | Counter (seat units)            | show_id                                                                                                                               |
| `seats_available`, `seats_held`, `seats_confirmed` | Gauge (DB-derived)              | show_id                                                                                                                               |
| `http_request_duration_seconds`                    | Histogram                       | method, route template (`unmatched` for 404s), status                                                                                 |
| `http_5xx_total`                                   | Counter                         | route                                                                                                                                 |
| `db_retries_total`                                 | Counter                         | reason ∈ {`tx_conflict`, `connection`, `contention`}                                                                                  |
| `reserve_queue_depth`, `reserve_inflight`          | Gauge                           | none                                                                                                                                  |
| `db_pool_checked_out`, `db_pool_idle`              | Gauge                           | pool ∈ {write, read, ops}                                                                                                             |
| `cleanup_job_duration_seconds`                     | Histogram                       | job_type                                                                                                                              |
| `nodejs_eventloop_lag_seconds`, `process_*`        | prom-client defaults            | none                                                                                                                                  |

`fly.toml` includes `[metrics] port=8080 path="/metrics"`.

### 9.3 Logging

A Fastify `onRequest` hook accepts or generates `X-Request-ID`, echoes it back, stores it in `AsyncLocalStorage`, and pino emits JSON lines to stdout:
`{ts, level, request_id, method, route, status, duration_ms, user_id, show_id, outcome}`.

Fly logs are not public: deliver a screen recording of `fly logs` during the burst plus `logs/sample-burst.jsonl` (committed excerpt).

---

## 10. Background Jobs

No background job is required for the core IMPLEMENTATION. Idempotency records are retained for the lifetime of the reservation/show so a previously successful key cannot later create a second reservation.

Do not add a cleanup worker for this take-home. A future production API may define an explicit idempotency retention period, but that would be a separate API contract and would need carefully defined key-reuse semantics.

---

## 11. Throughput Decision: One Process or Cluster (Fix 5)

One Node process does JWT verify, zod parse, JSON logging, metrics, and pg protocol parsing for 20k requests on one core. Settle this **with a measurement, not a guess**.

1. Deploy single process, run `make burst` with the full 20k profile against the live URL.
2. Record p50/p95/p99, `nodejs_eventloop_lag_seconds`, and CPU.
3. **Decision rule:** if p99 > about 3s, or event-loop lag p99 > 100ms, or client timeouts appear, enable cluster mode. Otherwise stay single-process and say so in WRITEUP.

Cluster mode (`WEB_CONCURRENCY=2`, VM with 2 vCPU):

- Use Node's `cluster` module; the primary serves `/metrics` via prom-client `AggregatorRegistry.clusterMetrics()` so counters sum correctly across workers.
- **DB-derived gauges must use `aggregator: 'first'`**, otherwise they would be summed ×N. Event counters keep `sum`.
- Divide pool/semaphore sizes by worker count so `workers × 38` stays under the DB limit.
- The in-memory show cache is per worker and safe because shows are immutable. Idempotency and seat correctness live in Postgres, so extra workers do not weaken any guarantee.
- This **partly reverses the v3 "one worker" advice**. Record the measurement that drove the decision in WRITEUP.

---

## 12. Burst Script

`scripts/burst.ts` (compiled to `dist/scripts/burst.js`) using **undici** `Pool` (`connections: 256`), wrapped by `scripts/burst.sh` and `make burst BASE_URL=... ADMIN_TOKEN=...`.

Flags: `--users`, `--requests`, `--hot-seats`, `--retry-rate`, `--concurrency`, `--seats-per-request`, `--json-out`, `--admin-token`, `--secret`, `--timeout-ms`.

Steps:

1. Mint tokens via `/auth/token` (or locally with `--secret`).
2. Create a fresh show (with `--admin-token`).
3. Fire M requests: 70% on hot seats round-robin, 30% random; `retry-rate` fraction replay an earlier key with identical seats; about 1% reuse a key with different seats (expect 409).
4. Extra probes: one user firing 10 parallel reserves (limit 4); spoofed `user_id` body probe; cancel another user's reservation (expect 403); cancel then rebook a seat; malformed show id (expect 404).
5. During the burst, **poll `GET /shows/{id}?include_seats=false` and `/health/ready` every 500ms** and assert they always answer fast (this verifies the lanes).
6. Report: 201 count (split into new vs replay), 409 by code, other 4xx, **5xx count**, client timeouts, p50/p95/p99, **per-hot-seat winner count (must be exactly 1)**, final `GET /shows/{id}` invariant, and a comparison of `/metrics` with the API including **`201 count == confirmed_total + idempotent_replay`**.
7. Exit non-zero if any assertion fails (any 5xx, any timeout, any hot seat with winners ≠ 1, invariant violated, gauge or counter mismatch). Print JSON summary.

---

## 13. Project Structure

```
seat-reservation/
  src/
    server.ts            # bootstrap, backoff connect, listen, graceful shutdown, optional cluster
    app.ts               # Fastify instance, hooks, handlers
    config.ts            # env parsing with zod
    db/
      pools.ts           # write / read / ops pools + error handlers
      retry.ts           # classify(), jitter, attempt loop helper
      migrate.ts         # runs sql/init.sql on DIRECT url
      sql/init.sql
    http/
      errors.ts          # AppError, error codes, setErrorHandler, notFound
      auth.ts            # jwt verify, admin guard, /auth/token
      context.ts         # AsyncLocalStorage request context
      routes/ shows.ts  reservations.ts  health.ts  metrics.ts  auth.ts
    services/ show.service.ts  reservation.service.ts
    observability/ metrics.ts  logger.ts
    lib/ semaphore.ts  uuid.ts  hash.ts  showCache.ts
  scripts/ burst.ts  burst.sh
  test/
    concurrency.test.ts    # 500 racers on one seat = 1 winner; multi-seat no-deadlock
    idempotency.test.ts    # replay, different seats 409, cross-user isolation, header+body key, replay after cancel
    limits.test.ts         # 10 parallel reserves, limit 4 = at most 4 seats
    auth.test.ts           # spoofed body user_id; cancel other's reservation 403
    invariants.test.ts     # available+held+confirmed == total during load
    contention.test.ts     # multi-seat rollback does not strand a seat      (nice-to-have)
    contract.test.ts       # shapes, error format, malformed ids, BIGINT amounts, include_seats=false
    metrics.test.ts        # 201 == confirmed + replay; gauges == API; series pre-initialised
    resilience.test.ts     # transient DB failure: no duplicate/partial booking; 503 allowed only after recovery budget
  logs/sample-burst.jsonl
  Dockerfile  docker-compose.yml  fly.toml  Makefile  .env.example  .dockerignore
  package.json  package-lock.json  tsconfig.json  vitest.config.ts
  .github/
    workflows/ci.yml
  README.md  WRITEUP.md  AI_LOG.md

```

---

## 14. IMPLEMENTATION Order (commit after each step)

Must-haves first (see §2). Each step ends with a commit.

1. Foundation: `package.json` (exact-pinned deps), tsconfig strict, config, pools with error handlers, `init.sql`, startup connect-with-backoff.
2. Errors and middleware: unified format, request id, pino JSON logging, UUID path validation, not-found handler.
3. Auth: JWT dependency (`sub` or `user_id`), admin guard, `/auth/token` behind `ENABLE_DEV_AUTH`.
4. Shows: create (validation, bulk insert), get (snapshot + `include_seats=false`), show cache.
5. Reserve: semaphore lane, advisory lock, idempotency, limit, ordered `FOR UPDATE` seat locking, atomic claim + reservation insert, transient-error retry.
6. Cancel with conditional updates.
7. Health, metrics (pre-initialised series, DB-derived gauges via ops pool + 1s cache).
8. Burst script and Makefile. **Burst locally against compose first.**
9. Dockerfile (non-root, ulimit), compose with healthcheck, fly.toml. **Deploy.**
10. Burst the live URL, record p99 and event-loop lag, apply the §11 decision rule. Record logs.
11. Tests (§13), starting with concurrency, idempotency, limits, auth.
12. Add GitHub Actions CI and branch/PR protection rules; verify CI passes on a clean checkout.
13. Nice-to-haves: contention/resilience tests beyond the core suite, cluster mode only if measurement demonstrates a need.
14. README (grader auth section first) and WRITEUP.md; finalise AI_LOG.md.

---

## 15. GitHub Development Strategy and CI/CD

The GitHub workflow is part of the development practice, not part of the seat-reservation correctness mechanism. It should demonstrate disciplined engineering without adding unnecessary process overhead for a one-day take-home.

### 15.1 Branching strategy

Use the following branch model:

```text
main
  │
  ├── protected: no direct pushes
  │
  └── develop
        │
        ├── feature/foundation
        ├── feature/reservation
        ├── feature/idempotency
        ├── feature/cancel
        ├── feature/observability
        └── test/concurrency
```

Rules:

1. **No direct pushes to `main`.**
2. `main` represents the deployable/submission state.
3. `develop` is the integration branch while the exercise is being built.
4. Work is done on short-lived `feature/*`, `fix/*`, or `test/*` branches.
5. Changes enter `develop` through Pull Requests (PRs).
6. `develop` enters `main` through a final PR after the full test suite, local burst, deployment checks, and review pass.
7. For a one-person repository, the PR/code-review step is still useful as an auditable engineering checkpoint; do not create artificial reviewers or approvals that do not exist.

### 15.2 Pull Request / Merge Request standard

Every PR should contain:

- What changed
- Why it changed
- Tests added/updated
- Concurrency or correctness impact
- Any deployment/configuration impact
- AI assistance used, where relevant

PR title examples:

```text
feat: implement atomic seat reservation
test: add concurrent hot-seat coverage
fix: make idempotency replay atomic
feat: add Prometheus reservation metrics
ci: add GitHub Actions validation pipeline
```

A PR must not be merged when required CI checks fail.

### 15.3 Code review

For this take-home, code review should focus on the areas that can break correctness:

- Can two transactions confirm the same seat?
- Is the multi-seat lock order deterministic?
- Can a failed transaction leave a partially claimed request?
- Can the same idempotency key create two reservations?
- Can a user exceed the per-show limit under concurrency?
- Can cancellation resurrect ownership incorrectly?
- Are 4xx domain declines distinguished from infrastructure failures?
- Are tests exercising the real PostgreSQL transaction behaviour?

Optional automated review bots may be enabled for:

- dependency/security alerts
- lint/type errors
- test failures
- obvious code-quality issues

Bot comments are advisory unless converted into an explicit CI requirement. Do not spend significant time configuring multiple review bots for this one-day exercise.

### 15.4 Test branch

Use a dedicated `test/*` branch only when testing a risky change independently, for example:

```text
test/concurrency
test/db-retry
test/load-burst
```

The branch can be used to experiment with load/concurrency behaviour without destabilising `develop`. Once the behaviour is validated, merge the useful test/code changes through a normal PR.

Do **not** maintain a permanent `test` branch unless the project actually needs one. The automated test suite and CI pipeline are the primary test gate.

### 15.5 CI pipeline

Use GitHub Actions with a small, deterministic pipeline:

```text
Pull Request / Push
        │
        ▼
  Install dependencies
        │
        ▼
     TypeScript
       typecheck
        │
        ▼
        Lint
        │
        ▼
   Unit tests
        │
        ▼
 PostgreSQL service
        │
        ▼
 Integration + concurrency tests
        │
        ▼
   Build Docker image
        │
        ▼
   CI PASS / FAIL
```

Recommended commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
docker build -t seat-reservation:ci .
```

The CI database should be an ephemeral PostgreSQL service/container. Tests must not depend on the live production database.

### 15.6 Main branch protection

Configure GitHub branch protection for `main` with:

- Require Pull Request before merge
- Require successful CI checks
- Require branch to be up to date before merge, if practical
- Disable direct pushes for normal development
- Allow repository owner/admin override only for exceptional recovery situations

For a one-day take-home, do not require a large number of approvals or elaborate release gates. The purpose is to prevent accidental untested code from becoming the submitted/deployed state.

### 15.7 Deployment from GitHub

CI and deployment should remain separate initially:

```text
feature branch
    ↓ PR
GitHub Actions
    ↓
 tests + build
    ↓
develop
    ↓
final PR
    ↓
main
    ↓
manual/controlled deploy
    ↓
live service
```

For this take-home, **automatic production deployment on every push is not required**. A manual deployment from a known-good `main` commit is safer because the graders will hit the live URL.

If time permits, a deploy workflow may be added that requires successful CI and an explicit manual approval/environment gate. Never deploy untested feature branches to the graded production URL.

### 15.8 Commit strategy

Commit incrementally so the repository history demonstrates the actual engineering process. Prefer small, meaningful commits:

```text
chore: initialize TypeScript Fastify service
feat: add PostgreSQL schema
feat: implement show creation
feat: implement atomic reservation transaction
test: add hot-seat concurrency test
feat: add idempotency handling
feat: add cancellation
feat: add health and readiness checks
feat: add Prometheus metrics
test: add 20k burst harness
ci: add GitHub Actions pipeline
docs: add deployment and correctness writeup
```

Avoid one giant final commit. The exercise explicitly asks for the full commit history.

### 15.9 What is required vs best practice

| Practice | Required by exercise? | Recommendation |
|---|---:|---|
| Git repository + full commit history | Yes | **Must have** |
| Incremental commits | Yes / strongly implied | **Must have** |
| No direct push to `main` | No | **Recommended** |
| `develop` branch | No | **Recommended, but optional** |
| Feature branches | No | **Recommended** |
| Pull Requests | No | **Recommended** |
| Code review | No | **Recommended checkpoint** |
| Review bots | No | **Optional** |
| Dedicated permanent `test` branch | No | **Not necessary** |
| GitHub Actions CI | No | **Strongly recommended** |
| Automated production deployment | No | **Not necessary** |
| Docker build in CI | No | **Recommended** |
| Security/dependency bot | No | **Optional** |

The goal is to demonstrate **professional engineering discipline without turning a one-day take-home into a DevOps project**.

---

## 16. Deployment Notes

### 16.1 fly.toml

```toml
app = "seat-reservation"
primary_region = "bom"          # same region as Postgres AND near the graders; verify provider availability
kill_signal = "SIGTERM"
kill_timeout = 35               # > 30s app drain

[build]

[deploy]
  strategy = "bluegreen"        # single machine: no downtime on deploy

[env]
  PORT = "8080"
  ENABLE_DEV_AUTH = "true"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false    # check current fly.toml schema for the exact value type
  auto_start_machines = false
  min_machines_running = 1

  [http_service.concurrency]
    type = "requests"
    hard_limit = 25000
    soft_limit = 20000

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    timeout = "5s"
    method = "GET"
    path = "/health/live"       # liveness only: a readiness blip must not pull the machine

[[vm]]
  size = "shared-cpu-2x"
  memory = "1gb"

[metrics]
  port = 8080
  path = "/metrics"

```

- Blue/green briefly runs two machines, so per-process counters reset after a deploy. **Do not deploy during the graded burst.** If two machines are kept, "zero 5xx on deploy" applies to that setup, and counters must be summed.
- Fly Postgres availability and pricing change; check current options first. Fallbacks: Render or Railway with managed Postgres. Keep app and DB in the **same region**, since each reserve makes several round trips.

### 16.2 Dockerfile (shape)

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && cp src/db/sql/init.sql dist/src/db/sql/init.sql && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json docker-entrypoint.sh ./
USER node                       # non-root
EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]   # ulimit -n 65536; exec node --max-old-space-size=768 dist/src/server.js

```

### 16.3 docker-compose.yml (shape)

```yaml
services:
  db:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: seats }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d seats"]
      interval: 2s
      timeout: 3s
      retries: 30
  app:
    build: .
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
    ports: ["8080:8080"]

```

### 16.4 Hygiene and config

- **Pin dependency versions**: `npm install --save-exact`, commit `package-lock.json`, build with `npm ci`, set `"engines": {"node": ">=22 <23"}`.
- `.env.example` lists: `DATABASE_URL`, `DATABASE_DIRECT_URL`, `JWT_SECRET`, `ADMIN_TOKEN`, `ENABLE_DEV_AUTH`, `PORT`, `WRITE_POOL_MAX`, `READ_POOL_MAX`, `WEB_CONCURRENCY`, `LOG_LEVEL`. Never commit real secrets.
- Makefile targets: `make up` (compose up --build), `make test`, `make burst BASE_URL=... ADMIN_TOKEN=...`, `make build`, `make down`.
- Secrets on Fly: `fly secrets set DATABASE_URL=... DATABASE_DIRECT_URL=... JWT_SECRET=... ADMIN_TOKEN=...`.
- Keep one machine for the graded burst. Verify `docker compose up` and `fly deploy` from a **fresh clone**.
- If using Neon free tier: expect auto-suspend; the startup backoff handles it, but warm the DB with a request before graders run.

---

## 17. AI_LOG.md (Fix 11)

Keep a running log **while building** (append after each commit). Writing it from memory at the end will not be honest, and you will extend this service live in the interview. Each entry:

```
## <date/time> - <step name>
Directed (what I asked AI to do):
Decided by me (and why):
Corrected (what the AI got wrong, how I caught it):
Verified by (test / burst / reading the SQL):

```

Examples of things worth recording: the choice of lock order, the decision to add `seat_labels`, any SQL the AI wrote that you changed, the cluster-vs-single decision and the measurement behind it.

---

## 18. WRITEUP.md Outline

1. **Atomic decision:** PostgreSQL transaction with ordered `SELECT ... FOR UPDATE`; why race-free; multi-seat requests use deterministic `seat_label` order; lock order (user/show serialization if used → idempotency → seats); normal contention becomes 409 rather than a server error; no `SKIP LOCKED` or deferred FK is required.
2. **Idempotency:** `idempotency_keys` PK `(user_id,key)`; checked and written inside the reservation transaction; same canonical seats returns original, different seats 409; successful keys are retained so the same key cannot later create another reservation; replay of a cancelled reservation; replay metric rule.
3. **Holds and expiry:** confirm-on-reserve, cancel-only release, no TTL in this exercise because the API requires same-key exactly-once semantics; how an explicit future retention contract could be added later.
4. **Consistency vs availability under partition:** single-primary Postgres, CP choice; readiness fails closed; one writer so no split-brain.
5. **Observability and 2am paging:** any 5xx, readiness failing, pool saturation or `reserve_queue_depth` growth, p99 latency, event-loop lag, invariant gauge drift, `TRY_AGAIN` / `db_retries_total{reason="connection"}` above zero, infrastructure retry rate and dependency health.
6. **Throughput decision:** the single-vs-cluster measurement and result.
7. **Dev auth note:** `/auth/token` is a grader convenience, disabled in production.
8. **AI usage:** directed vs decided, specific and honest, including bugs caught in review (pull from `AI_LOG.md`).
9. **Next steps:** TTL holds with a payment/confirm step, sharding by show, admission control queue, read replicas for state reads, multi-machine metric aggregation.

---

## 19. Validation Checklist

- [ ] `docker compose up` and `fly deploy` both work from a clean clone; container runs as non-root
- [ ] Cold start with DB asleep: app stays up, `/health/ready` 503 then 200
- [ ] `/health/ready` 503 when DB down; `/health/live` always 200; Fly check uses `/health/live`
- [ ] 500 racers on one seat give exactly one 201, the rest 409 `SEAT_TAKEN`; losers produce no reservation or idempotency rows
- [ ] 20k burst: zero 5xx (including zero proxy 503), zero client timeouts, only 201 and 4xx
- [ ] `GET /shows/{id}?include_seats=false` and `/health/ready` stay fast **during** the burst
- [ ] A transient Postgres failure causes no duplicate/partial booking; retries use a fresh connection and an unrecoverable dependency outage may return 503
- [ ] `available + held + confirmed == total_seats` during and after the burst
- [ ] Same key + same seats returns original; same key + different seats gives 409; key accepted in header and in body; replay after cancel returns original seats
- [ ] `201 count == reservations_confirmed_total + idempotent_replay` for the observation window; current seat gauges are DB-derived and remain the source of truth; label is `per_user_limit`; all reason series exist at 0 right after show creation
- [ ] Another user cannot replay your key or read your reservation
- [ ] 10 parallel reserves with limit 4: at most 4 seats owned
- [ ] Spoofed `user_id` ignored; cancelling another's reservation gives 403
- [ ] Cancelled seat is re-bookable; cancel never frees a seat owned by someone else; repeat cancel does not move counters
- [ ] Non-UUID show or reservation id gives 404 `NOT_FOUND`; unknown route and malformed JSON use the standard error format
- [ ] `/metrics` seat gauges equal `GET /shows/{id}`; `seats_confirmed = seats_confirmed_total − seats_cancelled_total` on a single machine
- [ ] `amount_paise` correct for large `price × seats`; `price_paise > 1e12` or non-integer rejected
- [ ] Single-vs-cluster decision recorded with burst numbers
- [ ] README opens with grader authentication steps; logs recording and sample logs included
- [ ] WRITEUP.md and AI_LOG.md complete; commit history incremental