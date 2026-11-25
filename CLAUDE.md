# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SyncBoard is a monorepo with two independent apps: `backend/` (Spring Boot 3.5, Java 21, Maven, PostgreSQL) and `frontend/` (Vite, React 19, TypeScript, Tailwind CSS v4). The UI and user-facing API error messages exist in English (default) and Korean; code, identifiers and comments are in English. Never hard-code user-facing text: add it to both languages (see **i18n** below).

## Commands

Backend (run from `backend/`; on Windows PowerShell use `.\mvnw.cmd` instead of `./mvnw`):

```bash
./mvnw spring-boot:run                      # API on :8080
./mvnw test                                 # all tests (needs the syncboard_test DB, see below)
./mvnw test -Dtest=AuthServiceTest          # one class
./mvnw test -Dtest=AuthServiceTest#loginWithWrongPasswordFailsWithoutIssuingToken   # one method
./mvnw package                              # jar in target/
```

Frontend (run from `frontend/`):

```bash
npm run dev                                 # :5173, proxies /api -> localhost:8080
npm test                                    # vitest run (npm run test:watch for watch mode)
npx vitest run src/pages/LoginPage.test.tsx # one file; add -t "<test name>" for one test
npm run lint                                # oxlint (not ESLint)
npm run build                               # tsc -b && vite build
```

## Local setup and configuration

- Config comes from `backend/.env` (git-ignored; copy `backend/.env.example`). `application.yml` loads it with `spring.config.import: optional:file:.env[.properties]`, so it is resolved relative to the **working directory**: run Maven from `backend/`. The file is Java `.properties` format (no quotes). Real environment variables override it.
- `JWT_SECRET` must be ≥ 32 bytes; `JwtProperties` fails startup otherwise.
- Two databases are needed: `syncboard` (app) and `syncboard_test` (tests; `TEST_DB_URL`). Flyway creates the tables but not the databases (`createdb -U postgres syncboard_test`). There's no Testcontainers/Docker; `AuthControllerIntegrationTest` uses the real test DB and wipes `users` before each test.
- The test profile (`src/test/resources/application-test.yml`) uses its own fixed JWT secret and `PT15M` TTL; the integration test asserts `expiresIn == 900`.

## Architecture

**Auth flow (spans both apps).** `POST /api/auth/register` → `POST /api/auth/login` returns `{ accessToken, tokenType, expiresIn }` → the frontend stores the token in `localStorage` (`syncboard.accessToken`) and sends `Authorization: Bearer …` on every request. Only an access token is issued (no refresh token). Expiry just means the user logs in again.

**Boards and sharing.** A board is a drawing canvas, not a kanban board.
- **Roles:** `boards.owner_id` is the single owner. `board_members` holds the people it is shared with, as `EDITOR` or `VIEWER` (the owner is never stored there). `BoardRole` is `OWNER` / `EDITOR` / `VIEWER`.
- **Access checks:** all of them go through `BoardAccessService`:
  - `requireView`: any role;
  - `requireEdit`: owner or editor, may change the drawing;
  - `requireOwner`: rename, delete, manage members.
- **Error codes:** users without access get the same `404 BOARD_NOT_FOUND` as for a missing board. Users who can see the board but lack the role get `403` (`READ_ONLY_BOARD`, `NOT_BOARD_OWNER`).
- **Sharing:** `/api/boards/{id}/members` invites by the email of an existing account; there are no pending invitations. Any member can list members and remove themselves (leave). Only the owner adds people, changes roles or removes others.
- **Responses:** `BoardResponse` carries the caller's `role` and `ownerName`.
  - The dashboard (`findDashboardBoards`) lists owned and shared boards, sorted by `updated_at` desc (saving a canvas bumps it).
  - The frontend shows owner-only actions only when `role === 'OWNER'`.
  - Viewers get the canvas in read-only mode (`CanvasStage readOnly`), with no toolbar or shortcuts.

**Real-time (spans both apps, `com.syncboard.realtime`, `src/realtime/`).** STOMP over plain WebSocket at `/ws`; in dev, Vite proxies `/ws` like `/api`.
- **Authentication:** the HTTP chain permits the handshake. `StompAuthInterceptor` authenticates `CONNECT` (`Authorization: Bearer …` STOMP header, plus `accept-language` for error texts) and sets a `BoardPrincipal` (name = user id).
- **Authorization:** `SUBSCRIBE` is only allowed to a board's `/topic/boards/{id}/(ops|presence|cursors)` and `/app/boards/{id}/join` (needs `requireView`), and to `/user/queue/errors`. `SEND` is only allowed to `/app/**`; clients must never publish to broker topics. Violations get a STOMP ERROR frame.
- **Joining a room:** the client opens one connection per board page (`openBoardSocket`, auto-reconnect). It subscribes, then subscribes to `/app/boards/{id}/join`. That is a `@SubscribeMapping`: a one-off reply with the room state, resent on every reconnect.
- **Presence:** `PresenceRegistry` tracks presence per STOMP session; it is deduplicated per user, and colors are stable per user (`colorOf`). It is dropped on `SessionDisconnectEvent`; heartbeats are 10 s.
- **Errors:** errors in message handlers go to the sender's `/user/queue/errors` as `{ code, message }`.
- **Single instance only:** the broker and room state are in memory. Running more than one backend instance needs a shared bus; the plan is **Redis Pub/Sub** for topic fan-out, with room state and presence moved to Redis as well. Until then, do not scale horizontally.
- **Known limit:** access is checked when subscribing. A member removed while connected keeps receiving until they reconnect, but writes are re-checked on every message.
- **Tests:** backend tests use a real client (`StompTestClient`, `RANDOM_PORT`). Frontend tests replace the connection with `vi.mock('../realtime/connection', () => import('../test/socketMock'))` and drive the server side through `socketState`.

**Canvas (spans both apps, no real-time yet).** The drawing lives in `board_canvases`, one row per board, created together with the board. `content` is JSONB `{ schemaVersion, shapes }`.
- **Ownership of the format:** the frontend owns it (`src/canvas/types.ts`). The backend only checks the top-level shape and a 2 MB cap.
- **Saving:** `PUT /api/boards/{id}/canvas { content, version }` replaces the whole document. It is a compare-and-set (`BoardCanvasRepository.saveIfVersionMatches`), and a stale `version` gets `409 CANVAS_CONFLICT`. Writing requires `requireEdit`.
- **Frontend layout:**
  - `src/canvas/` holds pure logic: `shapes.ts` (drag-to-shape, `parseCanvasContent`, which drops invalid shapes) and `history.ts` (undo/redo reducer over immutable snapshots). It also holds `useCanvasSaver`: 1.5 s debounce, one save in flight, retry every 5 s on errors, stop on 409, flush on unmount.
  - `CanvasStage.tsx` is the only place that touches react-konva.
  - `BoardPage` is lazy-loaded so Konva stays out of the main bundle.
- **Shape model:** every shape has `x`/`y`, so moving is just a position change. Pen and line `points` are relative to it. The eraser removes whole shapes, using Konva hit testing.
- **Tests:** jsdom has no canvas. Page tests use `vi.mock('react-konva', () => import('../test/konvaMock'))` and steer the pointer through `konvaState`.

**i18n (spans both apps).** Supported languages are `en` (default) and `ko`.
- Frontend: `i18next` + `react-i18next`, initialized in `src/i18n/index.ts`, which `main.tsx` and the test setup import. `src/i18n/en.ts` defines the keys. `ko.ts` must have the same shape, and `i18next.d.ts` type-checks every `t('...')` key, so `tsc` fails on missing or unknown keys. The language is the stored choice (`localStorage` `syncboard.lang`), else `ko` for Korean browsers, else `en`. `LanguageSwitcher` sits in the app header and on the auth pages. Format dates with `i18n/format.ts` (`Nov 25, 2026` / `2026년 11월 25일`), not ad-hoc `Intl` calls.
- `apiFetch` sends `Accept-Language` with the UI language. The backend (`LocaleConfig`, an `AcceptHeaderLocaleResolver` restricted to en/ko, English fallback) resolves `ApiException` keys and Bean Validation messages (`message = "{validation.x}"`) through Spring's `MessageSource`. As a result, `detail` and field errors arrive already translated, and the frontend shows them as-is. Property values are not run through `MessageFormat`. `{min}`/`{max}` are Bean Validation placeholders.

**Backend** (`com.syncboard`, packaged by feature: `auth`, `user`, `board`, `config`, `common`):
- JWT issuing and validation both use Spring's built-in OAuth2 resource server with Nimbus (HS256): `JwtService` signs via the `JwtEncoder` bean, and `SecurityConfig`'s `JwtDecoder` validates incoming requests. There is **no custom auth filter**. To protect a new endpoint, do nothing (everything except register/login is authenticated by default). To get the caller, take `@AuthenticationPrincipal Jwt jwt`; `jwt.getSubject()` is the user id.
- Emails are normalized (trim + lowercase) in `AuthService` before every lookup and insert. Login returns the same 401 `INVALID_CREDENTIALS` for unknown email and wrong password.
- Errors: throw `ApiException(status, code, messageKey)`; the key lives in `messages.properties` (English) and `messages_ko.properties`. `GlobalExceptionHandler` turns everything into `ProblemDetail` JSON with extra `code` and, for validation failures, `errors` (field → message). The frontend depends on this shape.
- Schema is owned by Flyway (`src/main/resources/db/migration`, `V<n>__name.sql`); Hibernate runs with `ddl-auto: validate`, so entity changes need a new migration.
- Password fields are capped at 72 characters because of BCrypt's input limit.

**Frontend** (`src/`):
- `api/client.ts` `apiFetch` is the only place that calls `fetch`. It attaches the token and converts non-2xx responses into `ApiError { status, code, fieldErrors }`. It always uses relative `/api/...` URLs, which work through the Vite dev proxy.
- `auth/AuthProvider.tsx` is the source of truth for the session. On startup it validates a stored token via `/api/auth/me` and falls back to anonymous on any failure. `register()` logs in automatically afterwards. The context object and `useAuth` hook live separately in `auth/authContext.ts`, which keeps react-refresh happy.
- Routing: `App.tsx` contains only `<Routes>`; the router is supplied by `main.tsx` (`BrowserRouter`) or by tests (`MemoryRouter`). `RequireAuth` and `RequireGuest` in `auth/routeGuards.tsx` are layout routes. `RequireAuth` passes `state.from` so login can return the user to the page they wanted.
- Pages validate on the client with the same rules as the backend DTOs and also show the server's `fieldErrors`. Keep the two in sync when changing constraints.
- Tests render `<MemoryRouter><AuthProvider><App/>` and stub `fetch` with `vi.stubGlobal`. `src/test/setup.ts` handles cleanup, clears `localStorage`, restores mocks and resets the language to English, so tests assert English text.
- Tailwind v4 is wired through the `@tailwindcss/vite` plugin and `@import 'tailwindcss'` in `index.css`. There is no `tailwind.config.js`.
