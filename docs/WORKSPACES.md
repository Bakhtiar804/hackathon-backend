# Workspace deployment and authentication verification

The live API checked on October 25, 2026 reports `initializationRequired:false`, without `workspaceCreationAvailable`. It is the older single-company release. Do not run setup again or recreate the database. Existing Admin accounts sign in with their original email/password. Login does not create accounts; public registration is not supported by that release.

The updated backend implements public `POST /api/v1/workspaces` with the strict object `{companyName,workspaceSlug,email,password}` (optional policy), returning `{workspace:{id,slug,name},user}` without a token. `GET /setup-status` adds `workspaceCreationAvailable:true`. Login accepts optional `workspaceSlug`; include it when an email belongs to multiple workspaces. JWTs and database sessions bind to the workspace. Caller headers/query parameters cannot select a different workspace. Users, units, employees, attendance, leave, payroll, notifications, audit and AI records are scoped; email/code/month uniqueness is per workspace. `/setup` remains first-install only.

## Preserve existing data before deploying

Back up the database and stop all application writers. In the backend repository, explicitly run with the intended database configured:

```powershell
npm run migrate-workspaces -- --legacy-slug your-company --confirm
```

This adds ownership/address fields and replaces global unique indexes with scoped indexes. It preserves IDs, hashes, records and legacy sessions. It never deletes/recreates a company. Run once before starting the new release; startup refuses unmigrated data. Migration is never run automatically by the app. Resume traffic only after deployment and readiness checks. No live migration was run during development.

Render requires `MONGODB_URI` for the intended database and a stable `JWT_SECRET` of at least 32 characters. Changing the secret invalidates existing JWTs. The frontend uses `VITE_API_BASE=https://hackathon-backend-d180.onrender.com/api/v1`; restart Vite/rebuild after changing it.

The current backend `src/middleware/cors.js` uses `origin:true` and `credentials:false`, allowing every request origin. **It does not read `CORS_ORIGINS`; no allowed-origin environment variable is required by this code.** If restricting it later, explicitly allow `http://localhost:5173`, `http://127.0.0.1:5173`, the test origin `http://127.0.0.1:5174` when needed, and the exact deployed frontend origin. Allow GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS and Authorization/Content-Type. Bearer authentication remains required on protected routes.

Commit/push backend changes in `src/middleware/{auth,tenant}.js`, `src/models/index.js`, `src/services/{auth,common,admin-recovery,workspace-migration}.js`, `src/routes/index.js`, `src/validators/index.js`, `src/app.js`, `src/jobs/{migrate-workspaces,reconcile,reset-admin}.js`, `package.json`, generated `docs/openapi.json`, `docs/API.md`, and the corresponding bootstrap/integration/runtime/recovery/workspace tests plus `tests/legacy-test-context.js`.

If the existing Admin password is unknown, an operator can run `npm run reset-admin -- --email existing-admin@example.com` against the intended database. After migration, add `--workspace your-company` if needed. It prompts for confirmation and a hidden password, uses bcrypt, and revokes that Admin's sessions. It does not create/promote/reactivate accounts. No reset was run during verification.

Read-only browser verification: `node tests/live-auth-readonly.mjs`. The Create Workspace link opens an honest deployment-required page against the old initialized API, and the creation form against the updated API. Never infer successful authentication from readiness alone.
