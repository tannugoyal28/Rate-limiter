# Distributed Rate Limiter

A production-ready, Redis-backed distributed rate limiter built with Node.js, TypeScript, and Express. Supports multiple algorithms, per-user and per-IP throttling, and graceful Redis failure handling.

---

## Table of Contents

- [What This Project Does](#what-this-project-does)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Algorithms](#algorithms)
- [API Endpoints](#api-endpoints)
- [Response Headers](#response-headers)
- [Fail-Open vs Fail-Closed](#fail-open-vs-fail-closed)
- [Testing](#testing)
- [Design Decisions](#design-decisions)

---

## What This Project Does

When you expose an API to the public, users (or attackers) can send thousands of requests per second. This crashes your server, spikes your costs, and ruins the experience for everyone else.

A rate limiter sits in front of your API and enforces a limit — for example, **100 requests per minute per user**. Anyone who exceeds that gets a `429 Too Many Requests` response until their window resets.

The challenge: if you run multiple servers (which every real app does), each server needs to share the same counter. A counter stored in one server's memory is invisible to the others. This project solves that using **Redis** as a shared, centralized store.

---

## How It Works

```
Incoming HTTP Request
        │
        ▼
Rate Limiter Middleware
        │
        ├── Extract Identity (User ID or IP Address)
        │
        ├── Is Redis alive?
        │       ├── NO  →  Fail-Open (allow) or Fail-Closed (block)
        │       └── YES →  Run algorithm in Redis (atomic Lua script)
        │
        ├── Under the limit?
        │       ├── YES →  Set headers, call next(), request continues
        │       └── NO  →  Return 429 Too Many Requests
        │
        ▼
   Route Handler
```

Every counter operation runs as an **atomic Lua script inside Redis** — meaning even under thousands of concurrent requests, counters are always accurate. No race conditions.

---

## Tech Stack

| Technology | Why |
|---|---|
| **Node.js + Express** | HTTP server and middleware layer |
| **TypeScript** | Type safety — catches bugs at compile time, not runtime |
| **Redis** | Shared in-memory store — fast (~1ms) and supports atomic operations |
| **ioredis** | Node.js Redis client with cluster support and fine-grained offline control |
| **Lua scripts** | Run multiple Redis commands atomically — prevents race conditions |
| **nodemon + ts-node** | Auto-restart on file changes during development |

---

## Project Structure

```
rate-limiter/
├── src/
│   ├── index.ts                  ← Entry point, route definitions
│   ├── types.ts                  ← Shared TypeScript types and interfaces
│   ├── redis/
│   │   └── client.ts             ← Redis connection, health check
│   ├── strategies/
│   │   ├── slidingWindow.ts      ← Sliding window algorithm (Lua)
│   │   ├── tokenBucket.ts        ← Token bucket algorithm (Lua)
│   │   └── factory.ts            ← Picks the right algorithm from config
│   └── middleware/
│       └── rateLimiter.ts        ← Express middleware, ties everything together
├── tsconfig.json
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Redis installed and running locally

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis

# Verify Redis is running
redis-cli ping   # should respond: PONG
```

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/rate-limiter.git
cd rate-limiter

# Install dependencies
npm install

# Start development server
npm run dev
```

Server starts at `http://localhost:3000`.

You should see in the terminal:
```
[Redis] Connected
Server running on http://localhost:3000
```

### Available Scripts

```bash
npm run dev      # Start with nodemon (auto-restarts on file changes)
npm run build    # Compile TypeScript to JavaScript
npm start        # Run compiled output (production)
```

---

## Configuration

Rate limiters are configured when creating middleware in `src/index.ts`:

```typescript
const limiter = createRateLimiterMiddleware({
  algorithm:   "sliding-window",  // or "token-bucket"
  windowMs:    60_000,            // time window in milliseconds (60s)
  maxRequests: 100,               // max requests per window
  failOpen:    true,              // true = allow when Redis is down
});
```

### Environment Variables

Set these to connect to a remote Redis in production:

```bash
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
PORT=3000
```

Without these set, the app defaults to `localhost:6379` with no password.

---

## Algorithms

### Sliding Window

```typescript
algorithm: "sliding-window"
```

Tracks the exact timestamps of each request in a Redis Sorted Set. On every request, removes entries older than the window and counts what remains.

**How it works:**
- Store each request as a member of a sorted set with its timestamp as the score
- On each new request, delete everything older than `windowMs`
- Count remaining — if under limit, allow and add this request

**Best for:** Auth endpoints, payment APIs — anywhere a burst is not acceptable.

**Trade-off:** Uses more Redis memory (`O(requests per window)` per user).

---

### Token Bucket

```typescript
algorithm: "token-bucket"
```

Each user has a virtual bucket of tokens that refills continuously at a fixed rate. Each request costs one token. If the bucket is empty, the request is blocked.

**How it works:**
- Store `{ tokens, lastRefill }` in a Redis Hash per user
- On each request, calculate tokens added since `lastRefill`
- If tokens ≥ 1, spend one and allow. Otherwise, block.

**Best for:** General API routes, search, reads — where natural user bursts are fine.

**Trade-off:** Burst-tolerant — an idle user can accumulate tokens and fire rapidly.

---

### Comparison

| | Sliding Window | Token Bucket |
|---|---|---|
| Memory per user | O(requests in window) | O(1) — just 2 fields |
| Allows bursting | No | Yes |
| Accuracy | Exact | Slightly loose |
| Redis structure | Sorted Set | Hash |
| Best for | Auth, payments | Search, reads |

---

## API Endpoints

### `POST /auth/login`

Protected with strict sliding window — **10 requests per minute**.

```bash
curl -X POST http://localhost:3000/auth/login
```

**Response (allowed):**
```json
{ "message": "login" }
```

**Response (blocked):**
```json
{
  "error": "Too Many Requests",
  "retryAfter": 60
}
```

---

### `GET /api/search`

Protected with token bucket — **100 requests per minute** with burst tolerance.

```bash
curl http://localhost:3000/api/search
```

**Response:**
```json
{ "results": [] }
```

---

### `GET /health`

No rate limiting. Shows server and Redis status.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "redis": "connected"
}
```

---

## Response Headers

Every response (allowed or blocked) includes these headers:

| Header | Description | Example |
|---|---|---|
| `X-RateLimit-Limit` | Total requests allowed per window | `100` |
| `X-RateLimit-Remaining` | Requests left in current window | `43` |
| `X-RateLimit-Reset` | Unix timestamp when window resets | `1704067260` |
| `Retry-After` | Seconds to wait before retrying (blocked only) | `47` |
| `X-RateLimit-Fallback` | Present when Redis was down (fail-open mode) | `true` |

Good HTTP clients use `X-RateLimit-Remaining` to slow down before hitting 0 — preventing 429s entirely.

---

## Fail-Open vs Fail-Closed

When Redis goes down, the rate limiter must make a decision:

### Fail-Open (`failOpen: true`) — recommended for most APIs

```
Redis is down → allow all requests → API stays up
```

Users get through. Rate limiting is temporarily suspended. The API keeps serving. A custom header `X-RateLimit-Fallback: true` is set so monitoring systems can detect the degraded state.

### Fail-Closed (`failOpen: false`) — for security-critical APIs

```
Redis is down → block all requests → API goes down
```

No requests get through. Rate limiting is preserved at the cost of availability. Use this for financial or security-critical endpoints where even brief bypass is unacceptable.

---

## Testing

### Manual tests

**Test sliding window blocks at limit:**
```bash
# Hit auth endpoint 11 times — first 10 pass, 11th gets 429
for i in $(seq 1 11); do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/auth/login
done
```

Expected output:
```
Request 1:  200
Request 2:  200
...
Request 10: 200
Request 11: 429
```

**Check rate limit headers:**
```bash
curl -v http://localhost:3000/api/search 2>&1 | grep "X-Rate"
```

Expected:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1704067260
```

**Test fail-open (Redis down):**
```bash
# Stop Redis
brew services stop redis

# API should still respond (fail-open)
curl -v http://localhost:3000/api/search 2>&1 | grep -E "200|Fallback"
# Expected: X-RateLimit-Fallback: true

# Restart Redis
brew services start redis
```

**Inspect Redis keys directly:**
```bash
redis-cli

# List all rate limiter keys
KEYS rl:*

# Inspect a sliding window sorted set
ZRANGE rl:sw:ip:127.0.0.1 0 -1 WITHSCORES

# Inspect a token bucket hash
HGETALL rl:tb:ip:127.0.0.1
```

---

## Design Decisions

### Why Redis over in-memory counters?

In-memory counters break with multiple servers. If user 123 makes 50 requests to Server A and 50 to Server B, each server counts 50 — both think the user is under the 100 limit. Redis is shared across all servers — one counter, always accurate.

### Why Lua scripts over separate Redis commands?

Multiple Redis commands sent from Node.js can interleave under concurrency. Two requests reading count=99 at the same time both decide they're allowed — the counter hits 101. A Lua script runs atomically inside Redis's single thread — no other command runs until the script finishes. No race conditions possible.

### Why `enableOfflineQueue: false`?

With the default `true`, commands queue while Redis is offline and flood it when it recovers — potentially crashing Redis again. With `false`, offline commands throw immediately. We catch that error and apply fail-open logic. Fast, predictable, safe.

### Why EVAL and not separate commands for each algorithm?

`EVAL` runs the Lua script inside Redis in a single round-trip. The alternative — ZADD, ZCARD, ZREMRANGEBYSCORE as separate commands — is three round-trips plus no atomicity. Lua gives both atomicity and performance in one.

### Why a factory function for algorithms?

The middleware doesn't import `SlidingWindowRateLimiter` or `TokenBucketRateLimiter` directly. It only knows about a `check` function with a shared signature. Adding a third algorithm means adding one case to the factory switch — nothing else in the codebase changes.

---

## Author

Built as a backend engineering portfolio project demonstrating:
- Distributed systems design (shared state across stateless servers)
- Atomic operations and race condition prevention
- Graceful degradation under dependency failure
- Pluggable algorithm design with TypeScript interfaces
