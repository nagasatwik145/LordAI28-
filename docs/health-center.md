# LORD AI Health Center

The authenticated `/observability` page presents operational diagnostics from
`GET /api/health-center`. The API uses Supabase request authentication, limits
each authenticated user to eight checks per minute, returns `Cache-Control:
private, no-store`, and exposes only fixed safe summaries and statuses.

## Checks and dependencies

| Check                         | Implementation / dependency                                       | What is verified                                                                            |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontend                      | Authenticated browser page                                        | The page loaded and called the diagnostics API                                              |
| Backend API                   | TanStack Start API route                                          | The authenticated request reached this handler                                              |
| Database                      | Supabase `profiles` table and user-scoped request client          | One read-only query completes within 3.5 seconds                                            |
| Authentication                | Supabase request middleware                                       | Authentication completed before the handler ran                                             |
| AI provider and models        | OpenRouter, OpenAI, and Google model catalogs                     | Only the explicit active check sends bounded GET catalog requests; it never invokes a model |
| Web search                    | Tavily                                                            | Configuration only; no billable search is run                                               |
| Game generation and preview   | OpenRouter generation and browser game runtime                    | Configuration is reported; generation and preview are not run                               |
| Voice and speech              | Browser Web Speech APIs                                           | Browser capability detection only; microphone permission is not requested                   |
| File upload and storage       | Supabase Storage                                                  | Configuration only; no file is uploaded                                                     |
| Subscription and entitlements | LORD Pro entitlement flag and billing integration                 | Configuration only; no payment or entitlement mutation is run                               |
| Notifications                 | Browser Notification API and Capacitor Local Notifications plugin | Capability detection only; permission is not requested                                      |
| Capacitor and Android         | Capacitor runtime and native plugin registry                      | Runtime detection only; no native device action is run                                      |

The default refresh performs only request/authentication checks and a bounded,
read-only database query. **Run safe provider checks** additionally requests
configured OpenRouter, OpenAI, and Gemini model catalogs with a 4.5-second
timeout. It does not send prompts, create content, search the web, upload
files, or initiate billing. A successful catalog request verifies provider
connectivity, not end-to-end feature behavior; those features remain **Not
Tested** until exercised separately.

Statuses distinguish verified connectivity from configuration and untested
capabilities. The overall status reflects core application/backend/database/
authentication failures and verified integration failures; optional services
that are not configured or not tested do not make core health appear broken.
Provider credentials, response bodies, database errors, and upstream details
are never included in the API response.
