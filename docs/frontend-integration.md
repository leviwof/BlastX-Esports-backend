# BlastiX Esports API — frontend integration guide

Everything a web/mobile client needs: base URL, auth flow, endpoints, realtime events and a
copy-paste API client.

---

## 1. Prerequisites (Railway, do these once)

1. **Public domain.** The service ships as *Unexposed* — the frontend cannot reach it until a
   domain exists. Railway → service → **Settings → Networking → Generate Domain**.
   You get something like `https://blastix-esports-backend-production.up.railway.app`.
2. **Verify it is alive:**
   ```bash
   curl https://<your-domain>/health
   # {"status":"success","data":{"healthy":true,"uptime":12.3,"commit":"8fbe14b"}}
   ```
   `commit` is the deployed revision — if it looks old, the platform is running a stale image.
3. **Environment variables.** The app validates these at boot and *refuses to start* without them:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | `${{Postgres.DATABASE_URL}}` (reference variable) |
   | `REDIS_URL` | yes | `${{Redis.REDIS_URL}}` — OTP storage, caching, job scheduler |
   | `JWT_SECRET` | yes | min 32 chars |
   | `OTP_PEPPER` | yes | min 16 chars, keep stable |
   | `GOOGLE_CLIENT_IDS` | yes | comma-separated; Google ID token audiences |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | yes | **login is OTP-by-email, so without SMTP nobody can sign in** |
   | `SMTP_USER` / `SMTP_PASS` | no | omit for unauthenticated relays |
   | `NODE_ENV` | no | set `production` |
   | `JWT_EXPIRES_IN` | no | default `30d` |
   | `PAID_TOURNAMENTS_ENABLED` | no | default `false` |
   | `ROOM_RELEASE_MINUTES` | no | default `15` |

4. **Seed the database once.** `GET /v1/config/init` uses `findUniqueOrThrow`, so it 500s until the
   `app_config` row exists (the seed also creates the games and an admin user):

   ```bash
   # Railway → Postgres → Connect → use the PUBLIC url here
   DATABASE_URL="postgresql://...public..." npm run prisma:seed
   ```

---

## 2. Conventions

| Thing | Value |
|---|---|
| Base URL | `https://<your-domain>/v1` — **every** route is prefixed `v1` |
| Health | `https://<your-domain>/health` (no prefix — Railway probes it) |
| Auth | `Authorization: Bearer <jwt>` |
| Success body | `{ "status": "success", "data": <payload> }` |
| Error body | `{ "status": "error", "message": "human readable string" }` (correct HTTP status) |
| Field naming | `snake_case` for every payload and query param |
| Pagination | `?page=1&limit=20` (`limit` max 100) → `{ items, page, limit, total }` |

**Validation is strict.** The global `ValidationPipe` runs with `forbidNonWhitelisted: true`, so
sending an extra/unknown key in a body or query returns
`400 {"status":"error","message":"property foo should not exist"}`. Send exactly the documented fields.

---

## 3. Auth: passwordless email OTP

There is no password anywhere. Flow:

```text
POST /v1/auth/send-otp   { email }            -> { sent: true }        (email gets a 6-digit code)
POST /v1/auth/register   { name, email, otp } -> user + token          (new account)
POST /v1/auth/login      { email, otp }       -> user + token          (existing account)
```

The `token` is returned **inside `data`** on register/login:

```json
{
  "status": "success",
  "data": {
    "id": "cm1...",
    "name": "Ravi",
    "email": "ravi@example.com",
    "profile_pic": null,
    "role": "USER",
    "is_active": true,
    "created_at": "2026-09-19T05:22:38.559Z",
    "updated_at": "2026-09-19T05:22:38.559Z",
    "token": "eyJhbGciOi..."
  }
}
```

Store that token (e.g. `localStorage`) and send it as `Authorization: Bearer <token>` on every
protected call. Default lifetime is 30 days (`JWT_EXPIRES_IN`).

Other auth routes:

| Route | Body | Purpose |
|---|---|---|
| `POST /v1/auth/social-login` | `{ token }` (Google **ID token**) | Sign in with Google |
| `POST /v1/auth/verify-token` | `{ token }` (your JWT) | Validate a stored session on app start → `{ valid: true }` |

**OTP limits** (server-enforced):

- code expires after **5 minutes**;
- **5** wrong attempts invalidate the code (user must request a new one);
- max **3** OTP requests per email per 10 minutes, plus a global 10/minute throttle on
  `send-otp` → surface these as friendly UI errors, not crashes.

Emails are normalised server-side (`trim` + lowercase), so send them as typed.

---

## 4. Endpoint map

### Public (no token needed)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/config/init` | App splash config: `min_version`, `latest_version`, `is_maintenance`, `maintenance_message`, `update_url` |
| `GET` | `/v1/tournaments` | Filters: `page`, `limit`, `status`, `team_mode`, `format`, `map`, `date_from`, `date_to` |
| `GET` | `/v1/tournaments/:id` | If you *do* send a valid token, the response also includes `is_registered` / `my_registration` |
| `GET` | `/v1/tournaments/:id/participants` | Registered list with user/team summary |
| `GET` | `/v1/tournaments/:id/leaderboard` | `[{ rank, ... }]` |
| `GET` | `/v1/tournaments/:id/matches` | Match list for a tournament |

### Authenticated (Bearer token)

| Method | Path | Body / notes |
|---|---|---|
| `GET` | `/v1/users/me` | Current profile |
| `PATCH` | `/v1/users/me` | `{ name?, profile_pic? }` (`profile_pic` must be a URL) |
| `GET` | `/v1/users/me/game-profile?game_slug=free_fire` | In-game identity |
| `PUT` | `/v1/users/me/game-profile` | `{ game_slug, in_game_uid, in_game_name }` — UID must be **8–12 digits** |
| `GET` | `/v1/tournaments/me` | My joined tournaments |
| `GET` | `/v1/tournaments/:id/my-team` | User's registered team for this tournament (or `null`) |
| `POST` | `/v1/tournaments/:id/teams` | Create new team for tournament (`{ name, tag, logo_url?, accepting_substitutes? }`) and register slot |
| `GET` | `/v1/tournaments/:id/teams/code/:code` | Search / preview team by invite code before joining (returns roster & slot availability) |
| `POST` | `/v1/tournaments/:id/register` | `{ team_id? }` — send `{}` for solo; `team_id` for squad modes |
| `DELETE` | `/v1/tournaments/:id/register` | Leave a tournament |
| `GET` | `/v1/tournaments/:id/room` | Room credentials. Returns **403** `"You must be registered in this tournament…"` if not registered, or **403** `"Room credentials have not been released yet…"` until the release window (`ROOM_RELEASE_MINUTES`, default 15, before `starts_at`) |
| `POST` | `/v1/teams` | `{ name, tag, game_slug?, logo_url?, accepting_substitutes? }` — `tag` = 2–5 alphanumeric |
| `GET` | `/v1/teams/me` | My teams |
| `GET` | `/v1/teams/:id` | Team detail incl. members |
| `POST` | `/v1/teams/join` | `{ invite_code }` |
| `POST` | `/v1/teams/:id/join` | Join specific team (`{ invite_code?, as_substitute? }`) |
| `POST` | `/v1/teams/:id/leave` | Leave team (member only; captain must transfer first) |
| `POST` | `/v1/teams/:id/members/:userId` | Captain removes a member |
| `DELETE` | `/v1/teams/:id/members/:userId` | Captain removes a member; a member passes their **own** id to leave |
| `POST` | `/v1/teams/:id/transfer-captain` | `{ new_captain_id }` — Transfer captaincy |
| `PATCH` | `/v1/teams/:id/substitutes` | `{ accepting_substitutes }` — Toggle substitute acceptance |
| `PATCH` | `/v1/teams/:id` | `{ name?, tag?, logo_url? }` (captain only) |
| `POST` | `/v1/teams/:id/regenerate-invite` | Captain only |

### Admin (role `ADMIN`)

`POST /v1/admin/tournaments`, `PATCH /v1/admin/tournaments/:id`,
`POST /v1/admin/tournaments/:id/status`, `POST /v1/admin/tournaments/:id/room`,
`POST /v1/admin/tournaments/:id/disqualify`, `POST /v1/admin/tournaments/:id/matches`,
`POST /v1/admin/matches/:matchId/results`, `POST /v1/admin/tournaments/:id/finalize`.

---

## 5. Realtime (Socket.IO)

The gateway lives on the **`/live` namespace** and **requires a valid JWT** — connections without
one are disconnected immediately, so always connect with a token.

```ts
import { io } from 'socket.io-client';

const socket = io(`${API_URL}/live`, {
  auth: { token },                       // JWT from login
  transports: ['websocket'],             // optional; polling also works
});

// Ask for live updates for one tournament
socket.emit('join_tournament', { tournament_id: tournamentId });

socket.on('leaderboard_updated', ({ tournamentId, leaderboard }) => {
  // full refreshed leaderboard for that tournament
});

socket.on('status_changed', ({ tournamentId, oldStatus, newStatus }) => {
  // e.g. UPCOMING -> LIVE -> COMPLETED; refetch or patch UI
});

socket.emit('leave_tournament', { tournament_id: tournamentId });
```

Rooms are per tournament (`tournament:<id>`), so one socket can follow several tournaments.
Reconnect with a fresh token when the user logs out/in — the JWT is only checked at handshake.

---

## 6. Copy-paste client (`src/lib/api.ts`)

Zero dependencies, works in browser and React Native. Swap the storage calls for
`AsyncStorage` on native.

```ts
export const API_URL = import.meta.env.VITE_API_URL ?? 'https://<your-domain>';

type Envelope<T> = { status: 'success'; data: T } | { status: 'error'; message: string };

export class ApiError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'blastix_token';
let token: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function setToken(next: string | null): void {
  token = next;
  if (typeof localStorage === 'undefined') return;
  next ? localStorage.setItem(TOKEN_KEY, next) : localStorage.removeItem(TOKEN_KEY);
}

export const getToken = (): string | null => token;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => null)) as Envelope<T> | null;

  if (!res.ok || !body || body.status === 'error') {
    if (res.status === 401) setToken(null); // expired/invalid -> force re-login
    throw new ApiError(
      body && body.status === 'error' ? body.message : `Request failed with ${res.status}`,
      res.status,
    );
  }
  return body.data;
}

export interface User {
  id: string;
  name: string;
  email: string;
  profile_pic: string | null;
  role: 'USER' | 'ADMIN';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  token?: string;
}

export interface Tournament {
  id: string;
  game_slug?: string;
  title: string;
  description: string | null;
  banner_url: string | null;
  format: string;
  team_mode: string;
  map: string;
  max_slots: number;
  registered_count: number;
  slots_left: number;
  entry_fee: number;
  prize_pool: number;
  rules: unknown;
  registration_opens_at: string;
  registration_closes_at: string;
  starts_at: string;
  status: string;
  is_registered?: boolean;
  my_registration?: unknown;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export const api = {
  auth: {
    /** Sends a 6-digit code to the email (valid 5 min). */
    sendOtp: (email: string) =>
      request<{ sent: true }>('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) }),

    login: async (email: string, otp: string) => {
      const user = await request<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, otp }),
      });
      setToken(user.token ?? null);
      return user;
    },

    register: async (name: string, email: string, otp: string) => {
      const user = await request<User>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, otp }),
      });
      setToken(user.token ?? null);
      return user;
    },

    /** `idToken` is a Google ID token from Google Identity Services. */
    socialLogin: async (idToken: string) => {
      const user = await request<User>('/auth/social-login', {
        method: 'POST',
        body: JSON.stringify({ token: idToken }),
      });
      setToken(user.token ?? null);
      return user;
    },

    /** Validate a stored token on app start. */
    verifyToken: (stored: string) =>
      request<{ valid: true }>('/auth/verify-token', {
        method: 'POST',
        body: JSON.stringify({ token: stored }),
      }),

    logout: () => setToken(null),
  },

  config: {
    init: () =>
      request<{
        min_version: string;
        latest_version: string;
        is_maintenance: boolean;
        maintenance_message: string;
        update_url: string;
      }>('/config/init'),
  },

  tournaments: {
    list: (query: Record<string, string | number | undefined> = {}) => {
      const qs = new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      return request<Paginated<Tournament>>(`/tournaments${qs ? `?${qs}` : ''}`);
    },
    byId: (id: string) => request<Tournament>(`/tournaments/${id}`),
    mine: () => request<Tournament[]>('/tournaments/me'),
    participants: (id: string) => request<unknown[]>(`/tournaments/${id}/participants`),
    leaderboard: (id: string) => request<unknown[]>(`/tournaments/${id}/leaderboard`),
    matches: (id: string) => request<unknown[]>(`/tournaments/${id}/matches`),
    bracket: (id: string) => request<unknown>(`/tournaments/${id}/bracket`),
    register: (id: string, teamId?: string) =>
      request<unknown>(`/tournaments/${id}/register`, {
        method: 'POST',
        body: JSON.stringify(teamId ? { team_id: teamId } : {}),
      }),
    unregister: (id: string) =>
      request<{ message: string }>(`/tournaments/${id}/register`, { method: 'DELETE' }),
    room: (id: string) =>
      request<{ room_id: string; room_password: string; room_released_at: string | null }>(
        `/tournaments/${id}/room`,
      ),
  },

  users: {
    me: () => request<User>('/users/me'),
    updateMe: (patch: { name?: string; profile_pic?: string }) =>
      request<User>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }),
    gameProfile: (gameSlug = 'free_fire') =>
      request<unknown>(`/users/me/game-profile?game_slug=${encodeURIComponent(gameSlug)}`),
    saveGameProfile: (input: { game_slug?: string; in_game_uid: string; in_game_name: string }) =>
      request<unknown>('/users/me/game-profile', { method: 'PUT', body: JSON.stringify(input) }),
  },

  teams: {
    create: (input: { name: string; tag: string; game_slug?: string; logo_url?: string }) =>
      request<unknown>('/teams', { method: 'POST', body: JSON.stringify(input) }),
    mine: () => request<unknown[]>('/teams/me'),
    byId: (id: string) => request<unknown>(`/teams/${id}`),
    join: (inviteCode: string) =>
      request<unknown>('/teams/join', {
        method: 'POST',
        body: JSON.stringify({ invite_code: inviteCode }),
      }),
    removeMember: (teamId: string, userId: string) =>
      request<{ message: string }>(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
    regenerateInvite: (teamId: string) =>
      request<unknown>(`/teams/${teamId}/regenerate-invite`, { method: 'POST' }),
  },
};
```

Usage:

```ts
// sign-in
await api.auth.sendOtp('ravi@example.com');
const user = await api.auth.login('ravi@example.com', '123456'); // token stored automatically

// data
const page = await api.tournaments.list({ status: 'UPCOMING', page: 1, limit: 20 });
const detail = await api.tournaments.byId(page.items[0].id);

// errors
try {
  await api.tournaments.register(detail.id);
} catch (e) {
  if (e instanceof ApiError) showToast(e.message); // already user-friendly
}
```

---

## 7. Gotchas that bite frontends

1. **Missing `/v1`.** `/tournaments` 404s; it must be `/v1/tournaments`. Only `/health` is unprefixed.
2. **Unwrapping the envelope.** Data is under `data`, errors carry `message` — read both.
3. **Extra body keys.** `forbidNonWhitelisted` turns harmless extras into 400s. Post `{}` when a
   route takes no fields.
4. **`limit` over 100** is rejected (`@Max(100)`).
5. **Tokenizer/token casing.** Always `Bearer ` prefix; the server is case-insensitive about
   `bearer` but not about a missing space.
6. **Room credentials are gated.** `/tournaments/:id/room` errors before the release window — treat
   it as "not yet available", not a bug.
7. **429s are normal.** OTP and login limits are intentional; show "try again in a few minutes".
8. **Seeded admin** is `admin@blastixesports.com` (OTP login, no password) — change the email or the
   role in the DB before going live.
9. **CORS** is currently wide open (`origin: true` with credentials), so any frontend host works,
   including `localhost`. Lock it down to your real domains before public launch.
