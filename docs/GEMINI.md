# Gemini connection for HCM Lite

Verification completed: 45 backend tests and 12 AI/responsive browser checks pass, as do lint and production build. Real hosted Gemini credentials/response have not yet been verified; operator confirmation of a Render key is not treated as a successful provider request.

Gemini uses the existing backend-only chat/tool pipeline via Google's documented compatibility endpoint. No provider SDK or key is added to the frontend. The selected model supports function calling and structured output per Google's current documentation; availability for the configured project is verified by the diagnostic command, not assumed.

## Render backend environment

Set these three values on the **backend service**, then save and deploy the updated code:

```dotenv
AI_API_KEY=your-existing-Gemini-key
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.5-flash-lite
```

Keep the real API key out of Git, chat, screenshots, frontend `.env`, and all `VITE_` variables. Existing `MONGODB_URI` and `JWT_SECRET` remain unchanged. `AI_API_KEY` can keep its existing name even though the provider is Gemini. Do not merely put a Gemini key into an otherwise OpenAI-configured service. The local backend URL/model have been configured for Gemini; no local key has been supplied.

The updated backend defaults to Gemini if the URL/model are absent. Explicit values above are still recommended to replace old Render settings. Explicitly configured compatible endpoints remain supported.

If a different compatible Gemini model is available to your project, change only AI_MODEL. Do not invent a model identifier. Google currently documents Gemini 3.5 Flash-Lite as a stable text model supporting function calling and structured outputs. Model availability/quota is project-specific and can change.

## Verify without accessing company data

After the updated backend files are available in Render's Shell:

```sh
npm run check-ai
```

This makes three small provider requests with one 15-second deadline: synthetic function call, tool-result round trip and strict JSON output. It does not connect to MongoDB, send company/employee records, initialize a workspace or reset credentials. Output reports connected/toolCalling/toolRoundTrip/structuredOutput and the provider hostname/model, never the key or provider bodies. Missing-key, authorization, model, quota, network and deadline errors have safe distinct diagnostic codes. The command uses provider quota; it does not run automatically at startup.

Passing the diagnostic proves provider capabilities/credentials, not the live application's login/session. Then sign in and verify:

1. Admin/HR assistant: ask for headcount in a real department, then compare to the same dashboard filters. Workspace unit names and valid IDs are supplied to Gemini; no cross-workspace metadata is included.
2. Dashboard: apply a range/department and Summarize. Expect 3–5 grounded, AI-generated insight bullets.
3. Employee: ask in Roman Urdu for your own leave balance and attempt a colleague salary question. Only own-data tools are exposed, and server role/scope checks independently remain enforced.
4. Smart leave: describe future leave, review the four validated proposal fields and explicitly confirm using the ordinary form. AI never saves a leave request itself.

Provider failures remain HTTP 200 with a safe fallback; normal forms and dashboards remain available. The combined per-user limit stays 20 AI calls/hour. All attempted tools are logged; only successful tool reads are presented as answer sources. Invalid smart-leave JSON retries once within the same deadline.

## Backend changes to deploy

`src/services/ai.js`, new `src/services/ai-provider.js`, new `src/jobs/check-ai.js`, `package.json`, `.env.example`, `tests/ai-provider.test.js`, updated `tests/integration.test.js` and the Gemini documentation. Never commit `.env`. Include these with the matching backend release; previous workspace migration/deployment requirements still apply. The independent `check-ai` command itself needs no database migration.

## Official references (checked 25 October 2026)

- [Google Gemini compatibility endpoint and tool/structured-output examples](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini 3.5 Flash-Lite model and capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

Controlled provider tests validate payloads, role restrictions, department context, JSON retry, provider error handling and Gemini metadata round trips. A real hosted Gemini connection is not marked verified until the configured provider or authenticated live application has been checked successfully.
