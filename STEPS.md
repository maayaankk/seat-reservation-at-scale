# STEPS.md — Strict Execution Plan

## Purpose

This file controls **how the IMPLEMENTATION work is executed**.

The AGENTS must use:

- `task.md` as the **requirements/source-of-truth**
- `IMPLEMENTATION.md` as the **approved IMPLEMENTATION/design plan**
- `SKILLS.md` as the **engineering execution standards**
- `AGENTS.md` as the **operating instructions**

The purpose of this file is to prevent execution drift, unnecessary redesign, premature optimization, and unplanned technology additions.

---

# 1. NON-NEGOTIABLE EXECUTION RULE

## Before EVERY IMPLEMENTATION request

The AGENTS MUST:

```text
1. Read task.md
2. Read IMPLEMENTATION.md
3. Read SKILLS.md
4. Read AGENTS.md
5. Inspect the current repository state
6. Identify the current execution step
7. Execute only the requested/current step
```

Do not skip these files because they were read earlier.

Do not assume that a previous conversation, previous AGENTS response, or previous IMPLEMENTATION state is still accurate.

---

# 2. SOURCE-OF-TRUTH HIERARCHY

Use this hierarchy:

```text
                 task.md
                    │
                    │ WHAT must be built
                    ▼
            IMPLEMENTATION.md
                    │
                    │ HOW it is approved to be built
                    ▼
                SKILLS.md
                    │
                    │ HOW engineering work is performed
                    ▼
                 AGENTS.md
                    │
                    │ HOW the AGENTS operates
                    ▼
                 STEPS.md
                    │
                    │ HOW execution is sequenced
                    ▼
              Current code
```

## Important

`STEPS.md` does **not** override `task.md` or `IMPLEMENTATION.md`.

If a conflict is discovered:

1. Stop the affected step.
2. Identify the conflict.
3. Do not silently redesign.
4. Report the conflict.
5. Update the plan only after an explicit decision.

---

# 3. NO-DIVERSION POLICY

The AGENTS MUST NOT:

- redesign the architecture without approval,
- add Kafka because it appears scalable,
- add Redis because it appears useful,
- add Kubernetes because it appears production-grade,
- introduce microservices,
- introduce unnecessary queues,
- introduce unnecessary caching,
- introduce speculative abstractions,
- change the database model without checking `IMPLEMENTATION.md`,
- change API contracts without checking `task.md`,
- replace PostgreSQL correctness with application-memory logic,
- implement optional work before mandatory work,
- optimize before measuring,
- refactor unrelated code while implementing a feature.

## Default principle

```text
Follow the approved plan.
Implement the current step.
Test the current step.
Review the current step.
Only then continue.
```

---

# 4. CURRENT STEP TRACKING

At the beginning of every execution session, determine:

```text
CURRENT_PHASE
CURRENT_STEP
STATUS
```

Use:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
TESTING
REVIEW
COMPLETED
```

Never mark a step `COMPLETED` merely because code was written.

A step becomes `COMPLETED` only after its required IMPLEMENTATION and validation are complete.

---

# 5. STEP EXECUTION LOOP

Every IMPLEMENTATION step follows this exact loop:

```text
┌───────────────────────┐
│ Read source documents │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Identify current step │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Understand requirement│
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Inspect existing code │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Implement only step   │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Run required tests    │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Developer review      │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ QA verification       │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Code review           │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Update documentation  │
└───────────┬───────────┘
            ↓
┌───────────────────────┐
│ Mark step completed   │
└───────────────────────┘
```

Do not jump directly from requirement to IMPLEMENTATION.

---

# 6. ROLE GATES

Each step must be viewed through the applicable `SKILLS.md` roles.

## Developer Gate

Ask:

```text
Does the IMPLEMENTATION satisfy the requirement?
Does it follow IMPLEMENTATION.md?
Is it minimal?
Is it understandable?
```

## QA Gate

Ask:

```text
What can fail?
What happens concurrently?
What happens on retry?
What happens on rollback?
What happens if the DB fails?
```

## Code Review Gate

Ask:

```text
Can this introduce a race?
Can this violate an invariant?
Can this leak data?
Can this produce an incorrect 5xx?
Is there unnecessary complexity?
```

## Systems Architect Gate

Ask:

```text
Did this change architecture?
Did it introduce a new source of truth?
Did it introduce distributed coordination?
Was the change actually required?
```

## DevOps Gate

Ask:

```text
Can it build from a clean checkout?
Can it run in Docker?
Can CI test it?
Can deployment start it?
Can operators observe it?
```

---

# 7. IMPLEMENTATION ORDER

Follow the ordering defined by `IMPLEMENTATION.md` and the repository task breakdown.

Do not reorder major IMPLEMENTATION phases merely because a later component appears easier.

The expected execution progression is:

```text
Phase 0
Repository / source-of-truth verification
        ↓
Phase 1
Project bootstrap
        ↓
Phase 2
Database schema and initialization
        ↓
Phase 3
Application foundation
        ↓
Phase 4
Authentication and validation
        ↓
Phase 5
Show creation and show state
        ↓
Phase 6
Transactional reservation
        ↓
Phase 7
Idempotency
        ↓
Phase 8
Cancellation / release
        ↓
Phase 9
Concurrency and correctness testing
        ↓
Phase 10
Observability
        ↓
Phase 11
Burst/load testing
        ↓
Phase 12
Docker and deployment
        ↓
Phase 13
CI/CD and GitHub validation
        ↓
Phase 14
Final code review
        ↓
Phase 15
Final acceptance / submission verification
```

**Important:** The exact step numbering and names in the repository's current `IMPLEMENTATION.md` / task breakdown take precedence over this summary sequence. This sequence is a guardrail, not permission to invent phases.

---

# 8. PHASE 0 — SOURCE-OF-TRUTH VERIFICATION

Before coding:

```text
[ ] task.md exists
[ ] IMPLEMENTATION.md exists
[ ] SKILLS.md exists
[ ] AGENTS.md exists
[ ] STEPS.md exists
[ ] repository structure inspected
[ ] current git branch identified
[ ] current git status checked
```

Then establish:

```text
What is required?
What is already implemented?
What is incomplete?
What is the next approved step?
```

Do not modify application code during this phase unless explicitly required to repair the execution setup.

---

# 9. DATABASE-FIRST CORRECTNESS

Database IMPLEMENTATION must establish the correctness foundation before reservation endpoints are built.

Verify:

```text
shows
seats
reservations
idempotency_keys
```

and the constraints/indexes required by `IMPLEMENTATION.md`.

The database must enforce as much correctness as practical.

Important invariant:

```text
available + held + confirmed = total seats
```

PostgreSQL remains authoritative.

---

# 10. RESERVATION IMPLEMENTATION GATE

Before implementing the reservation endpoint, confirm:

```text
[ ] transaction strategy documented
[ ] lock strategy documented
[ ] deterministic lock ordering documented
[ ] idempotency strategy documented
[ ] user-limit strategy documented
[ ] all-or-nothing behavior documented
[ ] rollback behavior documented
[ ] 409 domain outcomes documented
```

The reservation decision must not become:

```text
SELECT availability
↓
application thinks it is free
↓
later UPDATE
```

The authoritative decision must occur inside the approved PostgreSQL transaction/locking strategy.

---

# 11. IDEMPOTENCY GATE

Before marking idempotency complete, verify:

```text
same user + same key + same request
    → original reservation

same user + same key + different request
    → 409

same key from another user
    → separate namespace

concurrent same-key requests
    → one reservation
```

Do not introduce idempotency expiry unless the current `IMPLEMENTATION.md` explicitly requires it.

Do not allow key reuse to violate the task's exactly-once contract.

---

# 12. CONCURRENCY GATE

Before declaring reservation correctness complete, run real PostgreSQL concurrency tests.

Minimum:

```text
500 concurrent requests → same seat
```

Expected:

```text
1 × 201
499 × 409
0 × duplicate ownership
0 × incorrect 5xx
```

Also test:

```text
multi-seat contention
parallel requests from same user
parallel requests with same idempotency key
parallel requests crossing user limit
```

Verify database state after every scenario.

---

# 13. NO PREMATURE OPTIMIZATION

Do not implement optional performance mechanisms before proving the baseline.

Do not add:

```text
Redis
Kafka
cluster mode
additional queues
distributed locks
complex caching
sharding
```

unless:

1. `IMPLEMENTATION.md` explicitly requires it, or
2. measurement proves the approved design cannot meet the requirement, and
3. the user explicitly approves the architectural change.

For this exercise:

> PostgreSQL is the correctness mechanism.

---

# 14. TESTING GATE

Every meaningful IMPLEMENTATION step must have corresponding validation.

At minimum:

```text
Unit tests
Integration tests
Concurrency tests where applicable
```

Before proceeding to deployment:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
docker build
```

Use the exact commands defined by the repository if they differ.

Do not invent passing results.

---

# 15. OBSERVABILITY GATE

Before load testing, verify:

```text
[ ] request IDs
[ ] structured logs
[ ] reservation success metrics
[ ] decline metrics by reason
[ ] idempotent replay metrics
[ ] DB retry/error metrics
[ ] seat-state metrics/gauges where required
[ ] /health/live
[ ] /health/ready
[ ] /metrics
```

Metrics observe the system.

Metrics must not become the reservation source of truth.

---

# 16. LOAD/BURST GATE

Only execute the full burst after:

```text
[ ] functional tests pass
[ ] integration tests pass
[ ] concurrency tests pass
[ ] observability works
[ ] Docker works
[ ] deployment is healthy
```

The burst must verify:

```text
no double sell
correct winner count
correct decline distribution
per-user limit
idempotency
reconciliation
5xx count
```

Do not use load testing as a substitute for correctness testing.

---

# 17. FAILURE TESTING GATE

Test realistic failures without weakening the contract.

Verify:

```text
DB unavailable
DB connection dropped
transaction rollback
application restart
deployment shutdown
```

Expected behavior:

```text
No incorrect reservation
No duplicate ownership
No partial transaction
Broken connections are not reused
Readiness reflects dependency failure
```

Do not require zero 5xx when PostgreSQL is genuinely unavailable.

The normal healthy graded burst must avoid infrastructure-generated 5xx.

---

# 18. GITHUB / BRANCH GATE

Before significant IMPLEMENTATION work:

```text
git status
git branch
```

Use feature branches.

Do not push directly to `main`.

Recommended:

```text
feature/*
      ↓
Pull Request
      ↓
CI
      ↓
Code Review
      ↓
develop
      ↓
final PR
      ↓
main
```

Commits should be incremental and meaningful.

Do not squash away useful development history merely to make the repository look cleaner.

The exercise explicitly values the full commit history.

---

# 19. CI/CD GATE

Before final submission:

```text
PR CI
 ├── install
 ├── lint
 ├── typecheck
 ├── unit tests
 ├── PostgreSQL integration tests
 ├── concurrency tests
 ├── build
 └── Docker build
```

After merge:

```text
main
 ↓
CI
 ↓
deploy
 ↓
health check
 ↓
smoke test
```

Do not add complicated enterprise release orchestration.

The pipeline must be reliable and explainable.

---

# 20. DOCUMENTATION GATE

Whenever behavior changes, verify:

```text
IMPLEMENTATION.md
README.md
WRITEUP.md
AI_LOG.md
```

and other affected documents.

Documentation must match the actual IMPLEMENTATION.

If documentation and code disagree:

```text
STOP
↓
identify discrepancy
↓
determine approved source
↓
fix intentionally
```

Do not silently allow divergence.

---

# 21. DRIFT DETECTION

At the end of every major phase, compare:

```text
task.md
vs
IMPLEMENTATION.md
vs
code
vs
tests
vs
README
```

Look specifically for:

- missing requirements,
- unimplemented documented behavior,
- undocumented behavior,
- changed API responses,
- changed database semantics,
- changed concurrency behavior,
- outdated diagrams,
- stale test assumptions.

If drift is found, fix it before starting the next phase.

---

# 22. CHANGE CONTROL

If the AGENTS believes the approved IMPLEMENTATION plan is wrong:

**Do not silently change it.**

Create a decision record containing:

```text
Current plan
Observed problem
Evidence
Proposed change
Alternative considered
Impact
Tests required
```

Then request/obtain approval before making a consequential architectural change.

Minor IMPLEMENTATION details may be adjusted when they remain within the approved architecture and contract.

---

# 23. OPTIONAL VS REQUIRED WORK

Every task should be classified:

```text
P0 — required for correctness
P1 — required for task acceptance
P2 — required for production-quality behavior
P3 — optional enhancement
```

Always complete:

```text
P0 → P1 → P2
```

before P3.

Never spend time on optional polish while a correctness requirement remains incomplete.

---

# 24. STOP CONDITIONS

Stop IMPLEMENTATION and report the issue when:

```text
task.md is ambiguous
IMPLEMENTATION.md conflicts with task.md
required source file is missing
database behavior is unsafe
a race condition is discovered
a test exposes incorrect ownership
a proposed change requires architecture redesign
deployment assumptions are invalid
required dependency is unavailable
```

Do not work around a correctness issue silently.

---

# 25. FINAL REVIEW GATE

Before submission, run the five-role review.

## Developer

```text
Does every required feature exist?
```

## QA

```text
Does it survive concurrency and retries?
```

## Code Reviewer

```text
Are there P0/P1 defects?
```

## Systems Architect

```text
Does IMPLEMENTATION match the approved architecture?
```

## DevOps

```text
Can a clean checkout build, run, test, and deploy?
```

---

# 26. FINAL ACCEPTANCE CHECKLIST

```text
TASK
[ ] Every task requirement implemented
[ ] Every required API verified
[ ] Error behavior verified
[ ] Identity verified

DATABASE
[ ] Constraints verified
[ ] Indexes verified
[ ] Transactions verified
[ ] Lock ordering verified
[ ] Reconciliation verified

CORRECTNESS
[ ] No double sell
[ ] Per-user limit
[ ] Idempotency
[ ] All-or-nothing multi-seat reservation
[ ] Safe cancellation
[ ] Safe retry

QA
[ ] Unit tests
[ ] Integration tests
[ ] Concurrency tests
[ ] Burst test
[ ] Failure tests

OBSERVABILITY
[ ] Structured logs
[ ] Request IDs
[ ] Metrics
[ ] Liveness
[ ] Readiness

DEVOPS
[ ] Docker
[ ] Clean checkout
[ ] CI
[ ] Deployment
[ ] Health check
[ ] Smoke test

GITHUB
[ ] Feature branches used
[ ] No direct main pushes
[ ] PR history present
[ ] CI checks passed
[ ] Meaningful commit history

DOCUMENTATION
[ ] README accurate
[ ] IMPLEMENTATION.md accurate
[ ] WRITEUP accurate
[ ] AI_LOG complete
```

---

# 27. FINAL RULE

The AGENTS must never optimize for:

```text
"finish something quickly"
```

at the expense of:

```text
correctness
plan adherence
test coverage
reviewability
```

The execution objective is:

```text
READ
 ↓
UNDERSTAND
 ↓
IMPLEMENT
 ↓
TEST
 ↓
REVIEW
 ↓
VERIFY
 ↓
DOCUMENT
 ↓
COMMIT
 ↓
NEXT STEP
```

If the next step is not clear from the approved plan:

> **STOP and resolve the ambiguity. Do not invent the next step.**
