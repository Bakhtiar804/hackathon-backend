# Multiple workspaces on Render

Use public POST /api/v1/workspaces with {companyName,workspaceSlug,email,password}. It creates a separate company and Admin without signing in automatically. Workspace addresses are unique. Existing /setup stays first-install only. Never delete an Admin or company to enable creation.

## Upgrade the existing database safely

1. Back up hcm_lite and stop all writers, including the old server and scheduled jobs.
2. Keep Render MONGODB_URI and JWT_SECRET unchanged. In a controlled maintenance environment using this updated source and the intended database, explicitly run:

    npm run migrate-workspaces -- --legacy-slug hcm --confirm

This preserves IDs, hashes, sessions and business records, assigns existing records to their company, and replaces global unique indexes with workspace constraints. Never put this migration in ordinary startup. The updated server refuses unmigrated data.

3. Deploy the updated source with npm start and resume writers. No new environment variable enables this feature.
4. Check /ready returns 200, then /api/v1/setup-status contains workspaceCreationAvailable:true. From the actual frontend origin open Create Workspace and verify the form, without submitting test data to production.

Existing users keep credentials; the migration above gives their company address hcm. New companies choose another address and their own Admin. Login accepts workspaceSlug to disambiguate accounts sharing an email. The frontend base remains https://hackathon-backend-d180.onrender.com/api/v1.

## Isolation and verification

Signed JWTs and stored sessions select the workspace. Request headers cannot switch it. Users, business records, analytics, AI tools and email/code/month uniqueness are scoped. npm test uses disposable MongoDB instances and verifies company creation, roles, cross-company denial, payroll/PDF access and preserving legacy migration. Tests never initialize production.

Deploy the implementation together: tenant/auth middleware, models/indexes, auth/common services, routes/validators, migration service/CLI, package scripts, API docs and workspace tests. Preserve other pending department and AI changes. Do not partially revert to an incompatible older release.
