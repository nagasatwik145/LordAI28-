# LORD product analytics

Product analytics are opt-in. New accounts have no consent row and are treated as opted out. The authenticated preferences API (`/api/analytics/consent`) records the choice; opting out deletes that user's product events. Operational application logs remain separate and are not queried by the growth dashboard.

## Event schema v1

`product_analytics_events` stores `user_id` (for consent enforcement and deletion), `event_name`, `schema_version`, optional allowlisted `feature`, optional allowlisted failure `category`, optional bounded `duration_ms`, an internal provider-event deduplication key when needed, and server timestamp. It never accepts message text, study notes, prompt text, email, credentials, or client timestamps. Event writes require a valid session and explicit consent. Unrecognized fields and values are rejected.

Supported event names: `onboarding_started`, `onboarding_completed`, `feature_tour_completed`, `feature_opened`, `chat_succeeded`, `chat_failed`, `study_session_completed`, `game_generation_succeeded`, `game_generation_failed`, `mission_completed`, `mission_failed`, `subscription_checkout_initiated`, and `subscription_checkout_confirmed`.

The schema is versioned at v1. Add a new schema version before changing event meaning or stored properties. Events are retained for 13 months; schedule `public.purge_product_analytics()` daily using the deployment's Supabase scheduled-job facility.

Current emitters cover feature opens, chat outcomes, completed focus sessions, game generation outcomes, mission execution completion/failure, and checkout initiation/confirmation. The app currently has no onboarding or feature-tour flow, so those supported event names are not emitted.

## Admin access and reports

Set server-only `LORD_ADMIN_USER_IDS` to a comma-separated allowlist of Supabase auth UUIDs. The server checks this for every admin API request. The report is limited to 7, 30, or 90 days and at most 5,000 event rows; the response reports sample sizes and whether it was capped. The report aggregates opted-in events and bounded subscription entitlement rows; it does not expose user IDs or conversations. Admin gateway mutations are recorded in `admin_action_audit`.

The dashboard only reports data that exists. Retention cohorts and revenue are not reported because this event set does not yet provide validated cohort or revenue data. Model cost is not provider billing; any future cost display must be labeled as an estimate.

## Deployment

Apply `supabase/migrations/20261025030000_lord_growth_analytics.sql` before deploying the new APIs. Set `LORD_ADMIN_USER_IDS` on the server for administrator access. Client code uses only authenticated LORD API routes; no analytics vendor key is required.
