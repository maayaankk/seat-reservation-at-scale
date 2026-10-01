# SKILLS.md — Engineering Operating Standards

## Purpose

This document defines the engineering standards used by the AGENTS while working on the Seat Reservation at Scale take-home.

The AGENTS operates through five roles:

1. Developer
2. QA Tester
3. Code Reviewer
4. Systems Architect
5. DevOps Engineer

These standards complement `TASK.md` and `IMPLEMENTATION.md`.

---

# 1. Developer

## Core responsibility

Implement the requested behavior correctly, minimally, and in a way that can be defended during a technical interview.

## Standards

- Read `TASK.md` and `IMPLEMENTATION.md` before IMPLEMENTATION.
- Inspect existing code before adding new code.
- Prefer small, composable functions.
- Use strict TypeScript.
- Use parameterized SQL.
- Keep transaction boundaries explicit.
- Never move correctness into an in-memory cache.
- Never use application-level read-then-write logic as the final seat-ownership decision.
- Avoid speculative abstractions.
- Avoid unnecessary infrastructure.

## Reservation-specific standard

The database is authoritative.

A reservation must have a clear transaction:

```text
BEGIN
  ↓
idempotency decision
  ↓
quota decision
  ↓
deterministically lock requested seats
  ↓
validate availability
  ↓
update ownership
  ↓
insert reservation
  ↓
COMMIT
```

The exact IMPLEMENTATION must follow `IMPLEMENTATION.md`.

## Code quality

Prefer:

```text
clear > clever
explicit > implicit
simple > over-engineered
transactional > distributed coordination
testable > tightly coupled
```

---

# 2. QA Tester

## Core responsibility

Find defects before the grader does.

Testing must cover both:

```text
correctness
+
failure/concurrency behavior
```

## Test pyramid

```text
Unit
  ↓
Integration with real PostgreSQL
  ↓
Concurrency
  ↓
Load/burst
  ↓
Deployment smoke tests
```

## Mandatory scenarios

### Seat correctness

- One seat, one request.
- Multiple seats, all available.
- Multiple seats, one unavailable.
- 500 concurrent requests for one seat.
- Many users competing for a small hot-seat set.
- Concurrent cancellation/rebooking.

### Idempotency

- Same key + same body.
- Same key + different seats.
- Same key from another user.
- Concurrent identical requests with same key.
- Replay after cancellation.

### User limit

- Exactly at limit.
- One above limit.
- Multiple parallel requests crossing the limit.
- Cancellation freeing quota.

### Identity

- Valid token.
- Missing token.
- Invalid token.
- Spoofed body `user_id`.
- Non-owner cancellation.

### Reconciliation

Always verify:

```text
available + held + confirmed = total
```

from authoritative DB state.

### Failure

Test:

- DB unavailable.
- transient connection failure where practical.
- transaction rollback.
- broken connection returned to pool.
- application restart.
- cold start with sleeping/unavailable DB.

Do not incorrectly require zero 5xx when the dependency itself is genuinely unavailable. The zero-5xx requirement applies to the normal graded concurrency burst.

---

# 3. Code Reviewer

## Review priority

### P0 — Data correctness

Ask:

- Can two users ever own the same seat?
- Can a failed transaction leave partial state?
- Can cancellation free another user's seat?
- Can user quota be exceeded?
- Can idempotency create two reservations?
- Can a replay change state?

### P1 — Concurrency

Ask:

- Where is the atomic decision?
- What rows are locked?
- Are requested seats locked deterministically?
- Can transactions deadlock?
- What happens when two requests target the same seat?
- Are retries safe?

### P2 — Security

Ask:

- Is identity token-derived?
- Are body identity fields ignored?
- Is authorization checked before cancellation?
- Are credentials/secrets protected?

### P3 — Reliability

Ask:

- What happens if PostgreSQL disconnects?
- Is the broken connection destroyed?
- Are retryable SQL states narrowly classified?
- Can an unhandled error crash Node?
- Is there a bounded retry policy?

### P4 — Observability

Ask:

- Can a production failure be diagnosed from logs?
- Is there a request/correlation ID?
- Are domain declines distinguishable from infrastructure errors?
- Can the burst outcome be reconciled?

## Review output

When finding an issue, report:

```text
Severity
Location
Problem
Failure scenario
Why it matters
Recommended fix
Test required
```

Do not hide P0/P1 defects behind stylistic feedback.

---

# 4. Systems Architect

## Core responsibility

Protect the system's correctness boundary and prevent unnecessary complexity.

## Architecture rule

Use the smallest architecture that satisfies the TASK.

Default:

```text
Fastify
   ↓
Reservation service
   ↓
PostgreSQL
```

Supporting:

```text
Docker
Prometheus metrics
Structured logging
CI/CD
```

## Kafka

Kafka is not required for the reservation decision.

Do not introduce it unless there is a documented requirement for:

- asynchronous event processing,
- durable event streams,
- independent consumers,
- decoupling that cannot reasonably be handled synchronously.

Never make Kafka the authority for seat ownership.

## Redis

Redis is not required.

Do not use Redis as a distributed seat lock when PostgreSQL already owns the seat state.

Redis may be considered later for:

- caching,
- rate limiting,
- non-authoritative acceleration,

but it must not replace PostgreSQL correctness.

## Architectural decision checklist

Before adding infrastructure, ask:

```text
1. What requirement needs it?
2. Can PostgreSQL solve it?
3. Does it create another source of truth?
4. What happens if it fails?
5. Does it introduce eventual consistency?
6. Does it complicate the one-day exercise?
7. Can the developer explain it during the interview?
```

If there is no strong answer, don't add it.

---

# 5. DevOps

## Core responsibility

Make the service reproducible, observable, and deployable.

## Local reproducibility

A clean checkout should support:

```bash
npm ci
npm run build
npm test
docker compose up --build
```

Use pinned dependencies and commit the lockfile.

## Docker

The image should:

- build deterministically,
- run as a non-root user,
- expose the correct port,
- receive configuration through environment variables,
- handle SIGTERM,
- not contain secrets.

## Health

### Liveness

Must answer whether the application process is alive.

It should not depend on PostgreSQL.

### Readiness

Must verify required dependencies, especially PostgreSQL.

When PostgreSQL is unavailable:

```text
/health/live  → healthy
/health/ready → 503
```

unless the approved IMPLEMENTATION specifies otherwise.

## Deployment

Before claiming deployment success:

```text
build
→ deploy
→ health check
→ readiness
→ smoke test
```

Do not deploy during the graded burst.

## CI/CD

Minimum PR pipeline:

```text
npm ci
↓
lint
↓
typecheck
↓
unit tests
↓
PostgreSQL integration tests
↓
concurrency tests
↓
build
↓
Docker build
```

Main branch:

```text
merge
↓
CI
↓
deploy
↓
health check
↓
smoke test
```

Keep the pipeline simple enough to be reliable.

---

# 6. GitHub / Code Review

## Branch policy

Do not push directly to `main`.

Use:

```text
feature/*
fix/*
test/*
```

and Pull Requests.

Recommended:

```text
feature branch
    ↓
PR
    ↓
CI
    ↓
review
    ↓
develop
    ↓
final PR
    ↓
main
```

A permanent `test` branch is optional and not required.

Use temporary test branches for experiments.

## Commit quality

Commits should be:

- incremental,
- focused,
- understandable,
- buildable where practical.

Good examples:

```text
feat(db): add show and seat schema
feat(reservation): implement transactional seat claim
test(reservation): add hot-seat concurrency coverage
feat(idempotency): enforce request replay semantics
feat(observability): add reservation metrics
ci: add postgres integration workflow
```

Avoid one giant final commit.

---

# 7. Code Review Bots

Bots are useful for:

- static analysis,
- security checks,
- style issues,
- obvious bugs,
- dependency checks.

They are advisory.

They cannot replace human reasoning about:

- race conditions,
- PostgreSQL locks,
- transaction isolation,
- idempotency,
- reservation invariants.

Do not over-invest in bot configuration for this take-home.

---

# 8. Observability

## Logs

Use structured JSON logs.

Every request should have a correlation/request ID.

Useful fields:

```text
request_id
method
route
status
duration_ms
show_id
reservation_id
user_id where appropriate
error_code
```

Never log secrets.

## Metrics

Use Prometheus-compatible metrics.

At minimum track:

```text
reservations_confirmed_total
reservations_declined_total{reason}
reservations_idempotent_replay_total
db_retries_total{reason}
seat state gauges where defined
```

Metrics observe the database state; they do not determine it.

---

# 9. Performance

Performance work must be evidence-driven.

Do not prematurely add:

- Redis,
- Kafka,
- cluster mode,
- multiple database writers,
- queues,
- sharding.

First measure:

```text
latency
throughput
DB contention
connection usage
event-loop lag
error rate
```

Then optimize the demonstrated bottleneck.

---

# 10. Failure Engineering

Every retry must answer:

```text
Is this operation safe to retry?
```

Safe transaction retries require:

- rollback,
- fresh connection when required,
- bounded attempts,
- deterministic behavior,
- idempotency protection.

Do not retry arbitrary failures indefinitely.

A domain conflict such as:

```text
seat already taken
```

is not a system failure.

It is a valid:

```text
409 Conflict
```

---

# 11. Documentation

When IMPLEMENTATION changes:

- update relevant docs,
- keep diagrams accurate,
- update test expectations,
- update README instructions,
- update AI usage records where applicable.

Documentation must describe the IMPLEMENTATION that actually exists.

Never leave an obsolete architecture in `IMPLEMENTATION.md`.

---

# 12. Definition of Done

A change is complete when:

```text
[ ] Requirement satisfied
[ ] Code implemented
[ ] Relevant tests added
[ ] Existing tests pass
[ ] Concurrency behavior verified where relevant
[ ] Error handling verified
[ ] Security checked
[ ] Observability updated
[ ] Typecheck passes
[ ] Lint passes
[ ] Build passes
[ ] Docker build passes where relevant
[ ] Documentation updated
[ ] Git history remains clean
```

For reservation changes:

```text
[ ] No double sell
[ ] Per-user limit enforced concurrently
[ ] Idempotency enforced
[ ] All-or-nothing multi-seat behavior
[ ] Cancellation safe
[ ] Reconciliation invariant holds
```

---

# 13. Engineering Philosophy

The best IMPLEMENTATION for this exercise is not the one with the most technologies.

It is the one that is:

```text
Correct
Simple
Transactional
Observable
Tested
Deployable
Explainable
```

When two designs both satisfy the TASK, prefer the design with:

- fewer moving parts,
- fewer distributed failure modes,
- fewer sources of truth,
- stronger database invariants,
- simpler tests,
- clearer operational behavior.
