# WRITEUP.md

## Atomic Decision

**Mechanism**: Single PostgreSQL transaction using `SELECT ... FOR UPDATE` with deterministic ordering (`ORDER BY seat_label COLLATE "C"`), followed by conditional `UPDATE seats SET status='confirmed', reservation_id=$1 WHERE id=ANY($2)`.

**Why Race-Free**: The `FOR UPDATE` lock is acquired in deterministic order (prevents deadlocks), and the subsequent `UPDATE` only succeeds for seats still in `'available'` state. The entire operation runs in a single transaction with `REPEATABLE READ` isolation. Concurrent requests for the same seat serialize on the row lock; only the first sees `status='available'` and proceeds.

**Multi-Seat**: All requested seats locked in deterministic order (`ORDER BY seat_label COLLATE "C"`). If any seat unavailable, entire transaction rolls back (all-or-nothing). No partial reservations.

## Idempotency

**Storage**: `idempotency_keys` table with composite PK `(user_id, key)` + `seats_hash` (SHA256 of sorted canonical seats) + `reservation_id` (FK, nullable).

**Exactly-Once Semantics**:
1. First request: Insert idempotency key with `reservation_id`, create reservation, return 201
2. Retry (same key, same seats): Key exists with `reservation_id` → return original 201
3. Retry (same key, different seats): Key exists, `seats_hash` mismatch → 409 `IDEMPOTENCY_CONFLICT`
4. Different user, same key: Composite PK `(user_id, key)` allows it

**No TTL**: Keys retained for reservation lifetime. Exercise requirement: "same idempotency key reserves exactly once" — TTL would violate this by allowing key reuse after expiry.

## Holds & Expiry

**Model**: Explicit cancel only (`POST /reservations/:id/cancel`). No TTL/auto-expiry.

**Release**: `POST /reservations/:id/cancel` (owner only) → `UPDATE seats SET status='available', reservation_id=NULL WHERE reservation_id=$1`. Seats immediately re-bookable.

**No Resurrection**: Cancel only affects seats with `reservation_id=$1`. Cannot resurrect seats already confirmed to another user.

## Consistency vs Availability

**Choice**: CP (Consistency over Availability)

**Reasoning**: 
- Double-booking is catastrophic (financial + reputational)
- Short unavailability during DB issues acceptable
- PostgreSQL primary is single writer; no split-brain risk
- Read replicas not used for mutations

**Trade-off**: During DB partition, writes unavailable but reads via `/health/live` still work. No split-brain possible.

## Observability

### Metrics (Prometheus `/metrics`)
- `reservations_confirmed_total{show_id}` - New reservations only
- `reservations_declined_total{show_id,reason}` - `seat_taken`, `per_user_limit`, `idempotent_replay`, `idempotency_conflict`, `seat_not_found`, `invalid_body`
- `reservations_cancelled_total{show_id}`
- `seats_confirmed_total{show_id}`, `seats_cancelled_total{show_id}`
- `seats_available{show_id}`, `seats_held{show_id}`, `seats_confirmed{show_id}` (DB-derived gauges)
- `http_request_duration_seconds`, `http_5xx_total`
- `reserve_queue_depth`, `reserve_inflight`, `db_pool_checked_out`, `db_pool_idle`
- `cleanup_job_duration_seconds`

**Reconciliation**: `201_count = reservations_confirmed_total + reservations_declined_total{reason="idempotent_replay"}`

### Logs
- Structured JSON to stdout with `request_id`, `user_id`, `show_id`, `outcome`
- Redacted: `password`, `secret`, `token`, `authorization`

### Health
- `/health/live` - Always 200 (liveness)
- `/health/ready` - 200 if DB reachable, 503 otherwise

### 2am Paging
- Any 5xx (`http_5xx_total > 0`)
- `/health/ready` failing
- `reserve_queue_depth` growing (backpressure)
- Pool saturation (`db_pool_checked_out` near max)
- p99 latency > 3s or event-loop lag > 100ms
- Invariant gauge drift (`available + held + confirmed != total`)

## AI Usage

**Directed**: Architecture design (atomic FOR UPDATE pattern, advisory locks for user limits, idempotency key schema), Docker/Render config, CI/CD pipeline, test strategy.

**Decided**: Stack (Node/Fastify/TypeScript/PostgreSQL), all-or-nothing multi-seat, explicit cancel model, no TTL, CP consistency, single-process with ops lane.

**Corrected**: 
- User preference for Node over Python
- 12 v3→v4 fixes incorporated (lanes, fast path, connection retry, metrics reconciliation, etc.)
- Fly.io → Render (cost)
- Fixed FK deferrability for idempotency/reservation race
- Migration deadlock in CI (global setup + test concurrency)

**Rejected**: 
- Redis/Kafka (PG owns seat state)
- SKIP LOCKED (FOR UPDATE simpler, deterministic)
- Idempotency TTL (violates exactly-once)
- Background cleanup job (not needed)
- Cluster mode (measure first)

## What's Next

1. **Time-boxed holds** with TTL + payment/confirm step (requires expiry sweeper)
2. **Best-effort partial booking** as request option
3. **Outbox pattern** for reliable booking events (email, tickets, payments)
4. **Admission control / waiting room** for 100k+ spikes
5. **Sharding by `show_id`** + PgBouncer + read replicas
6. **Real identity provider (OIDC)**, rotating JWT keys, rate limiting
7. **Distributed tracing** (OpenTelemetry) tied to `request_id`
8. **Automated chaos tests** in CI (kill DB, restart mid-burst)
9. **Load-test gate in CI** with burst script as non-zero exit check