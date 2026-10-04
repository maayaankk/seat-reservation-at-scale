# AI Usage Log

This document records AI assistance during the development of the seat reservation system.

## Overview

**My Role**: Primary decision-maker, architect, and code reviewer. I owned all architectural decisions, code reviews, and final implementation choices.

**AI Role**: Research assistant, code generator, test generator, debugging aid, and documentation assistant. Used as a force multiplier for implementation speed.

**Tools Used**:
- **Claude (Anthropic)**: Requirements analysis, architecture design, code generation, debugging, test generation
- **GPT (OpenAI)**: Architecture discussions, alternative approach validation
- **Kilo Code (VS Code extension)**: In-IDE code generation, refactoring, test generation

---

## Session 1: Requirements Analysis & Architecture (2026-10-01)

### My Process
1. **Requirements Analysis**: I read the challenge requirements and used Claude to help decompose the problem into functional (F1-F6) and non-functional (N1-N12) requirements with traceability.
2. **Architecture Design**: I evaluated options with Claude/GPT:
   - Language: Node.js/TypeScript/Fastify (my decision, based on high concurrency, familiarity and ecosystem)
   - Database: PostgreSQL 16 (my choice - row locks, constraints, ACID)
   - Concurrency: Advisory locks + row-level FOR UPDATE (my design)
   - Idempotency: Composite PK (user_id, key) + seats hash (my decission + inputs from AI)
   - Deployment: Render (cost) with Docker (my decision, based on cost and ease of use, however free tier has limitations (cold starts etc.), fly.io is another option but is not free. Could have used Oracle Cloud, AWS Free tier however not suitable for the task)
2. **Architecture Decisions** (my decisions, validated with AI):
   - All-or-nothing multi-seat (simpler, atomic)
   - Explicit cancel, no TTL (matches 201 confirmed contract)
   - Deterministic FOR UPDATE ordering (prevents deadlocks)
   - Advisory locks for per-user limits (transaction-scoped)
   - Composite PK (user_id, key) for idempotency (per-user isolation)
   - Dev token endpoint gated by ENABLE_DEV_AUTH (grader convenience)
   - All-or-nothing multi-seat (no partial reservations)
   - Deterministic seat locking order (prevents deadlocks)

### AI Contributions
- Generated initial requirements breakdown from challenge text
- Suggested PostgreSQL over Redis/Kafka (validated my preference)
- Proposed advisory lock pattern for per-user limits
- Suggested composite PK for idempotency keys
- Drafted initial schema with constraints

### My Decisions (Overrode AI)
- Rejected Redis/Kafka (unnecessary complexity)
- Rejected SKIP LOCKED (FOR UPDATE simpler and deterministic)
- Rejected idempotency TTL (violates exactly-once)
- Rejected background cleanup job (not required)
- Rejected cluster mode by default (measure first)
- Rejected SKIP LOCKED (FOR UPDATE simpler for correctness)
- Changed Auth logic for ease of testing using JWT (dev tokens)
- Added Metrics.log file alogn with endpoint for testing purposes
- Added comprehensive Test cases inside test folder
- Approach of development - Plan, Build Checklist, Test Checklist, Implementation, Review, Testing, Commit to Git Repo.
- Changed JWT_EXPIRES_IN from 24s to 24h
- Added Postman collections for testing purposes
- Designed Schema with inputs from AI and after multiple revisions
- Used Docker and Docker Compose for local development and testing

---

## Session 2: Implementation (2026-10-01 to 2026-10-02)

### My Workflow
1. **I designed the schema** with all constraints; AI generated the SQL
2. **I designed the reservation transaction flow**; AI generated the SQL transaction code
3. **I designed the idempotency pattern**; AI generated the upsert logic
3. **I designed the advisory lock pattern**; AI generated the pg_advisory_xact_lock calls
3. **I defined the lane architecture**; AI generated semaphore implementation
4. **I defined the idempotency key schema**; AI generated the composite PK + hash
5. **I designed the metrics contract**; AI generated Prometheus metrics code

### AI-Assisted Implementation (Free tier)
- **Kilo Code**: Generated boilerplate (routes, services, tests, Dockerfile, CI)
- **Claude**: Wrote complex SQL transactions, retry logic, semaphore implementation
- **GPT**: Helped debug JWT signing issues, JWT_EXPIRES_IN parsing bug
- **Kilo Code**: Generated test files, Dockerfile, docker-compose, CI/CD
- **Kilo Code**: Git commit messages

### Bugs I Caught (AI Missed)
1. **JWT_EXPIRES_IN parsing**: `parseInt("24h")` returns 24 not 86400 - I caught this, added duration parser
2. **JWT signing**: `createSign` vs `createHmac` - I caught the API mismatch
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **JWT signing**: `createSign` vs `createHmac` - caught API mismatch
3. **Metrics log path**: Non-root user can't write to working dir - fixed to `/tmp/metrics.log`
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **Global constant timing**: `config.JWT_EXPIRES_IN` evaluated at import - fixed with runtime function
3. **JWT signing**: `createSign` vs `createHmac` - caught API mismatch
3. **Metrics log path**: Non-root user can't write to working dir - fixed to `/tmp/metrics.log`
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **Global constant timing**: `config.JWT_EXPIRES_IN` evaluated at import - fixed with runtime function
3. **JWT signing**: `createSign` vs `createHmac` - caught API mismatch
3. **Metrics log path**: Non-root user can't write to working dir - fixed to `/tmp/metrics.log`
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **Global constant timing**: `config.JWT_EXPIRES_IN` evaluated at import - fixed with runtime function

### My Review Process
- **Every AI-generated file**: I read, understood, modified, then accepted
- **Every test**: I reviewed assertions, added edge cases like Concurrency, Idempotency and Database constraints which AI missed
- **Every SQL query**: I verified lock ordering, constraint correctness
- **Every config**: I validated against requirements
- **Every test**: I added edge cases AI missed (concurrency, idempotency conflicts)
- **Every Code**: I read, understood, modified, then accepted


---

## Session 3: Deployment & CI/CD (2026-10-02 to 2026-10-03)

### My Decisions
- **Render over Fly.io**: Cost (no credit card for Fly), GitHub integration
- **Render over Fly**: Cost (no credit card required for Render GitHub integration)
- **Single process first**: Measure before scaling (my call)
- **Render over Fly**: No credit card needed for GitHub integration

### AI-Assisted Deployment
- **Render config**: AI generated `render.yaml`; I validated
- **Dockerfile**: AI generated multi-stage; I fixed non-root user, CMD path
- **CI/CD**: AI generated GitHub Actions; I added auto-merge dev→main
- **Dockerfile**: I fixed CMD path (`dist/src/server.js`), non-root user 
- **CI/CD**: AI generated workflow; I added auto-merge dev→main
- **Chaos test**: AI generated DB-kill test; I fixed FK deferrability and other DB constraint issues not caught earlier

### Issues I Caught in Deployment
1. **Docker CMD path**: `dist/server.js` vs `dist/src/server.js` - fixed in Dockerfile
2. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/seats FKs
2. **JWT signing**: `createSign` vs `createHmac` - caught API mismatch
3. **Metrics log path**: Non-root user can't write to working dir - fixed to `/tmp/metrics.log`
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **Global constant timing**: `config.JWT_EXPIRES_IN` evaluated at import - fixed with runtime function
2. **JWT signing**: `createSign` vs `createHmac` - caught API mismatch
3. **Metrics log path**: Non-root user can't write to working dir - fixed to `/tmp/metrics.log`
3. **FK deferrability**: Needed `DEFERRABLE INITIALLY DEFERRED` for idempotency/reservation FKs
3. **Global constant timing**: `config.JWT_EXPIRES_IN` evaluated at import - fixed with runtime function

---

## Summary: AI as Tool, Not Author

| Aspect | My Role | AI Role |
|--------|---------|---------|
| Requirements analysis | Lead | Assistant |
| Architecture decisions | **Owner** | Advisor |
| Schema design | **Owner** | SQL generator |
| Transaction logic | **Designer** | SQL generator |
| Concurrency model | **Architect** | Pattern implementer |
| Code review | **Reviewer** | Generator |
| Bug detection | **Primary** | Occasional |
| Deployment decisions | **Owner** | Config generator |
| Testing strategy | **Owner** | Test generator |
| Documentation | **Author** | Draft assistant |

---

## Honest Assessment

**What AI did well**:
- Boilerplate generation (routes, tests, Docker, CI)
- SQL transaction patterns
- Boilerplate test generation
- Docker/CI config generation
- Debugging assistance (JWT, FK issues)
- Documentation (commit messages)
- Testing and verification (Run test cases, postman collections)  
- Structure the requirements into tasks for implementation
- Generate test cases, Dockerfile, CI/CD workflow, Docker and Docker Compose files
- Fast code generation with test coverage
- Ressolve git issues 
- Generating code for multiple files quickly in the task plan
- Fixing the code when bug was pointed out
- Generating test cases for various scenarios, including edge cases, performance, scalability, and stress testing
- Analysing the trade offs of given direction and suggesting best  approach
- Providing multiple approaches for a problem and discussing them
- Fixing bugs in AI generated code 
- Implementing complex concepts like idempotency and advisory locks, providing correct and optimized code patterns
- Implementing database schema design with proper constraints and indexing
- Implementing business logic for seat reservation system

**What I had to fix/redo**:
- JWT signing API (createHmac vs createSign)
- JWT_EXPIRES_IN parsing (24h → 86400s)
- FK deferrability for idempotency
- Global config evaluation timing
- Metrics log path for non-root user
- Admin guard async signature
- Request context propagation (AsyncLocalStorage)
- Metrics log path for non-root user
- Admin guard async signature
- Request context propagation (AsyncLocalStorage)
- Showed improvements in understanding complex concepts like idempotency and advisory locks, providing correct and optimized code patterns
- Database Schema design, SQL-transactions, Semaphore implementation, Idempotency key logic 
- Docker/CI config generation
- Test failures and CI/CD pipeline issues 
- I caught many errors and misassumptions in AI-generated code through my code review process 
- Boundries and limitations for implementation and scalability 
- Test cases for edge cases, performance, scalability, and stress testing scenarios
- Burst Scenario 
- Performance bottleneck 

**Bottom line**: I made every architectural decision, reviewed every line of generated code, caught all critical bugs, and own the final system. AI was a powerful implementation accelerator, not the architect.