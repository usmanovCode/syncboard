# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SyncBoard is a monorepo with two independent apps: `backend/` (Spring Boot 3.5, Java 21, Maven, PostgreSQL) and `frontend/` (Vite, React 19, TypeScript, Tailwind CSS v4). UI text and user-facing API error messages are in Uzbek (Latin script); code, identifiers and comments are in English.

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

**Backend** (`com.syncboard`, packaged by feature: `auth`, `user`, `config`, `common`):
- JWT issuing and validation both use Spring's built-in OAuth2 resource server with Nimbus (HS256): `JwtService` signs via the `JwtEncoder` bean, and `SecurityConfig`'s `JwtDecoder` validates incoming requests. There is **no custom auth filter**. To protect a new endpoint, do nothing (everything except register/login is authenticated by default). To get the caller, take `@AuthenticationPrincipal Jwt jwt`; `jwt.getSubject()` is the user id.
- Emails are normalized (trim + lowercase) in `AuthService` before every lookup and insert. Login returns the same 401 `INVALID_CREDENTIALS` for unknown email and wrong password.
- Errors: throw `ApiException(status, code, message)`. `GlobalExceptionHandler` turns everything into `ProblemDetail` JSON with extra `code` and, for validation failures, `errors` (field → message). The frontend depends on this shape.
- Schema is owned by Flyway (`src/main/resources/db/migration`, `V<n>__name.sql`); Hibernate runs with `ddl-auto: validate`, so entity changes need a new migration.
- Password fields are capped at 72 characters because of BCrypt's input limit.

**Frontend** (`src/`):
- `api/client.ts` `apiFetch` is the only place that calls `fetch`. It attaches the token and converts non-2xx responses into `ApiError { status, code, fieldErrors }`. It always uses relative `/api/...` URLs, which work through the Vite dev proxy.
- `auth/AuthProvider.tsx` is the source of truth for the session. On startup it validates a stored token via `/api/auth/me` and falls back to anonymous on any failure. `register()` logs in automatically afterwards. The context object and `useAuth` hook live separately in `auth/authContext.ts`, which keeps react-refresh happy.
- Routing: `App.tsx` contains only `<Routes>`; the router is supplied by `main.tsx` (`BrowserRouter`) or by tests (`MemoryRouter`). `RequireAuth` and `RequireGuest` in `auth/routeGuards.tsx` are layout routes. `RequireAuth` passes `state.from` so login can return the user to the page they wanted.
- Pages validate on the client with the same rules as the backend DTOs and also show the server's `fieldErrors`. Keep the two in sync when changing constraints.
- Tests render `<MemoryRouter><AuthProvider><App/>` and stub `fetch` with `vi.stubGlobal`. `src/test/setup.ts` handles cleanup, clears `localStorage` and restores mocks.
- Tailwind v4 is wired through the `@tailwindcss/vite` plugin and `@import 'tailwindcss'` in `index.css`. There is no `tailwind.config.js`.
