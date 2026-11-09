# LORD AI feature inventory and verification ledger

Audit continued: 2026-11-09 (initial protection and inventory on 2026-11-08)  
Baseline commit: `47289f3` (`newforlife124`)  
Pre-edit backup: `/tmp/lordai-pre-audit-20261108.tar.gz` was created and verified in the 2026-11-08 runtime; that temporary file is absent in the current runtime. A protected current-tree snapshot is available at `/tmp/lordai-working-tree-20261109.tar.gz` (74 MB; `gzip -t` passed; mode `600`).

This ledger distinguishes implementation found in the repository from behavior exercised in a live browser or against connected services. A source file or a passing unit test alone does not establish end-to-end production behavior.

## Repository protection and recovery

- Initial branch: `main`, tracking `origin/main`.
- Initial tree already had 15 modified tracked files and numerous untracked additions, including guest session, guest API, TTS API, and chat/selector changes. These were preserved.
- No known damaged file was replaced from Git. The requested `/tmp/guest_new.tsx` was not present (`find /tmp -maxdepth 2` found no copy), so its origin/import status cannot be established here.
- The baseline commit is known, but no prior deployed or runtime-stable revision could be independently verified.

## Feature inventory

| Feature/domain | Repository evidence | Status in this audit |
|---|---|---|
| Landing page and public community/share pages | `src/routes/index.tsx`, `community/`, `share/` | Implemented; not browser-verified |
| Main dashboard and navigation | Authenticated route tree, `AppShell`, `NavigationDock`, dashboard components | Implemented; not browser-verified |
| Authenticated AI Chat | Shared `/_authenticated/chat` route, streaming `/api/chat`, attachments, Markdown, history persistence | Authenticated account path still unverified; guest UI, streaming, model/mode controls, attachment, stop, and message retry exercised in Chromium |
| Guest Chat | Same Chat route and composer; signed guest cookie; `/api/chat` guest context | Browser guest flow works with streamed responses, two free models, mode selection, transient attachment, stop/retry, refresh, and shared cookie across tabs; transcript clears on refresh |
| Guest session lifecycle | `/api/guest/session`, HMAC cookie, ten-minute TTL, synchronized server expiry | Browser countdown survived refresh and a second tab; virtual-time browser check reached the expired UI. A real-clock 10-minute run against the built server confirmed the session expires and guest Chat/TTS are rejected |
| Problem-solving selector | Intent classifier and selector component in Chat | Browser verified it stays hidden for an ordinary question, lists four choices for a math problem, and each choice passes its intended instruction or Voice route; work-together and quiz requests received HTTP 200 |
| Voice input and conversation | Voice route, Web Speech recognition, `VoicePipeline` | Fixed guest no-session auth error; guest problem-solver Voice route now reaches `/api/chat`. Chromium exposes Web Speech recognition; real speech capture from a physical microphone remains unverified |
| Text-to-speech | `/api/voice/tts`, Fish Audio server integration, browser speech fallback | Guest Fish Audio request returned `audio/mpeg`; Chromium played and then paused a 4-second sample. Provider is configured and responded during this run |
| Authenticated history, folders, message actions | Chat route, sidebar/folder and message action components, Supabase queries | Message Copy/Pin/feedback/regenerate controls were not successfully exercised in the browser; live authenticated history and RLS remain unverified |
| Sign-up, login, logout, session restore, Google OAuth | `/auth`, Supabase client and native OAuth modules | Browser verified invalid login returns a visible “Invalid login credentials” message and unauthenticated `/tasks` redirects to `/auth`. No test account was provided, so successful registration/login/logout/session restore were not attempted. Supabase reports Google OAuth disabled |
| Settings, model/mode controls, account controls | Authenticated settings and chat control components | Implemented; no interactive browser verification |
| Health Center and System Diagnostics | Observability page, `/api/health-center`, `/api/observability/health` | Guest and unauthenticated direct API requests returned 401; `/api/openrouter-test` returned 401 unauthenticated and 403 for a guest. Verified-email allowlist is covered by tests; successful navigation/API access for the named account is unverified without its test session |
| Other authenticated product areas | Boards, Canvas, Anything Studio, Command Center, Community, dashboards, Developer Lab, Documents, Feed, Images, Knowledge, Learning/Study, Memory, Mind Graph, Productivity, Projects, Research, Tasks, What-if, billing | Routes and supporting APIs exist; not individually audited or browser-verified in this pass |
| API surface | 100 route TypeScript files under `src/routes/api` | Broad inventory only; endpoint-specific status is not inferred from route presence |
| Database schema and migrations | 69 ordered SQL migration files; Supabase schema types and migration tests | Added missing `ai_games` and Community table types from existing migrations; fixed Community query of nonexistent `ai_games.status`; migration tests pass; no live database/RLS/storage audit |
| Loading/error/empty states and responsive behavior | Present across feature components | Auth failure and guest expiry states were exercised; desktop and 390px mobile chat rendered without horizontal overflow. Other routes, keyboard paths, and dialogs were not systematically inspected |

## Repairs made in this pass

- Guest Chat now uses the existing Chat route, composer, model/mode controls, message rendering, streaming, stop control, and attachment conversion. Guest turns are not inserted into authenticated conversations/messages, and the transcript is cleared on transition to an authenticated session.
- Guest authorization remains constrained to `/api/chat` and `/api/voice/tts`. Cookie verification now rejects malformed/oversized values, non-UUID session IDs, expired claims, and any future issue time. HMAC verification uses Web Crypto's signature verification.
- Both diagnostics APIs now require an authenticated, email-confirmed account matching `nagasatwik145@gmail.com` on the server. The client-side page guard remains an additional convenience check.
- VoicePipeline now sends guest voice turns without database writes, calls the TTS endpoint for configured Fish Audio playback, falls back to browser speech synthesis, and tears down active audio on stop. Problem-solving Voice navigation now carries the problem into Voice Mode.
- Guest session responses no longer return the session identifier to the browser.
- Guest session creation and Health Center throttles use process-local in-memory counters; they are best-effort per process, not distributed rate limits.
- The OpenRouter diagnostics probe now requires a Supabase-authenticated request; the dashboard caller uses `authenticatedFetch`. Guest access tests assert that this diagnostics endpoint remains denied.
- Guest model selection uses the local free-tier allowlist and no longer calls the authenticated `/api/models` catalog. The selected guest model is retained in chat state; a live Gemma 3 27B IT guest response succeeded.
- Share listing now stays disabled when no authenticated user ID exists, avoiding unnecessary protected API calls from guest chat.
- Guest countdown ticks locally instead of polling `/api/guest/session` once per second. The server remains authoritative for expired chat and TTS requests.
- VoicePipeline checks for a local Supabase session before calling `getUser()`. A guest with no session now proceeds through the server-verified guest cookie to `/api/chat` without database writes; the previous live failure was masked by a test mock and is covered by the updated test.
- Cookie construction now refuses non-UUID session IDs. Expired, future-issued, malformed, oversized, and altered-TTL cookies have unit coverage.
- Supabase TypeScript schema now includes `ai_games` and the four Community tables already defined by migrations. Community publishing no longer requests a nonexistent `ai_games.status` column; migration files and live data were not changed.
- Applied configured ESLint/Prettier fixes to the 29 files with formatting violations, then fixed the 6 non-format lint errors in `src/routes/api/community.ts`. The Community source-contract tests now ignore whitespace so they test ownership/validation behavior rather than formatting.

## Verification results

- Full unit suite on the current tree: **599 passed, 2 skipped; 101 test files passed, 1 skipped** (`npm test`, exit 0). An earlier concurrent run overlapped a user edit to navigation; the rerun passed against the current three-item primary navigation.
- Focused guest/session/voice/problem-solving/diagnostics tests: **49 passed** across 7 files.
- Whole-project ESLint: **0 errors, 16 warnings** (`npm run lint`, exit 0). Warnings are 14 Fast Refresh export warnings and 2 existing Chat hook dependency warnings.
- Full TypeScript: **passed** (`npx tsc --noEmit --pretty false`, exit 0).
- Production build after the repairs: **passed** (`npm run build`, exit 0); Vite reported chunk-size, mixed static/dynamic import, externalized Node-module, and dependency annotation warnings.
- Live local API checks: guest session create/status returned 200 with active ten-minute expiry and no session ID in response; two guest `/api/chat` requests returned 200 and streamed text; guest `/api/models` returned 403; guest `/api/health-center` returned 401; guest TTS returned 200 `audio/mpeg`.
- Real-clock guest expiry: created a guest cookie on the built local server, waited the full 10-minute TTL, then `/api/guest/session` reported `guest:false, active:false, expired:true`; `/api/chat` and `/api/voice/tts` both returned 401 with the expired cookie.
- OpenRouter diagnostics access regression test: **6 passed** (`src/lib/guest-chat-access.test.ts`); it confirms the probe is outside the guest allowlist.
- Read-only Supabase `limit=0` schema probes succeeded for `ai_games` and the four Community tables; no row data was returned.
- Chromium/Playwright browser runs exercised auth failure, protected-route redirect, guest Chat/Voice, actual OpenRouter streaming, free model choice, mode choice, attachment, stop/retry, selector options, TTS playback, refresh, multiple tabs, and desktop/mobile widths. Expected direct guest denials were 401/403; application chat made no account analytics or history write requests. No successful authenticated browser session was available.
- Supabase anonymous PostgREST reads for `conversations`, `messages`, and `user_settings` returned zero rows; anonymous Storage list requests for `chat-attachments`, `project-files`, and `images` returned zero objects. These are anonymous-denial checks only, not owner-vs-other-user RLS verification. No upload or production data mutation was attempted.
- Fake-device microphone permission/listening and actual speech transcription were not completed. Browser SpeechRecognition API is exposed in Chromium, but the environment has no verified physical microphone. Voice route text-to-chat and TTS were exercised; provider TTS returned audio and playback started.
- Cloudflare image generation could not be exercised because `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are absent from the configured environment. Google OAuth is disabled in Supabase Auth settings.
- Registration or successful login/logout/session restore, OAuth (provider disabled), the verified account's authorized Health Center path, authenticated user ownership/RLS, authenticated storage uploads/downloads, and the rest of the product route catalog remain unverified.

## Remaining verification work

- Run successful authenticated browser, message-action, and ownership/RLS/storage checks with an authorized non-production test account.
- Test physical microphone capture and recognized speech on a supported desktop/mobile browser.
- Audit each of the other authenticated route/API domains individually; this ledger records their presence but does not certify them as working.

## 2026-11-09 — Targeted sidebar: remove Voice Interface nav entry (preserve voice)

**Scope:** Small, targeted navigation change only. No voice functionality, routes, components, APIs, hooks, or services removed/disabled.

### Changes
- `src/components/lord/app-navigation.ts`: removed the `/voice` “Voice Assistant” (`Mic2`) entry from `APP_NAVIGATION` and removed `/voice` from `PRIMARY_NAVIGATION` (mobile primary nav). `NavigationDock` (desktop/collapsed sidebar), `AppShell` mobile drawer (secondary), and mobile bottom nav all derive from these shared arrays, so the icon/label/tooltip/active-state handling and spacing are removed everywhere without leaving a gap (bottom nav grid now sizes to `PRIMARY_NAVIGATION.length`).
- `src/components/lord/app-navigation.test.ts`: updated to reflect the removed primary destination and assert `/voice` is absent from `APP_NAVIGATION`.

### Preserved (not modified by this change)
- `src/routes/_authenticated/voice.tsx` route/component exists.
- Guest-allowed/auth-guard and analytics handling for `/voice` in `src/routes/_authenticated/route.tsx` left intact so existing supported entry points (including voice route / problem-solving navigation) continue to work.
- Voice pipeline, microphone, Fish Audio TTS API, subtitles/playback/mission controls, and related services untouched.

### Verification (actual)
- `npx eslint src/components/lord/app-navigation.ts src/components/lord/AppShell.tsx src/components/lord/NavigationDock.tsx src/components/lord/app-navigation.test.ts`: 0 errors (repo has 16 pre-existing warnings elsewhere).
- `npx vitest run src/components/lord/app-navigation.test.ts src/lib/guest-session.test.ts src/lib/guest-chat-access.test.ts src/lib/voice/mission-command.test.ts src/lib/voice/voice-pipeline.test.ts`: **38 passed** (5 files).
- `npx tsc --noEmit --pretty false` (240s timeout): **no output before timeout** (not a conclusive pass in this environment; full-project tsc timed out). Targeted files lint clean and relevant tests pass.
- Production build / browser automation: **not run** in this pass (targeted nav-only change; browser automation unavailable). Manual/interactive checks still needed to confirm icon absence in rendered desktop collapsed/expanded + mobile layouts and that other sidebar icons and existing `/voice` entry points work end-to-end.

## 2026-11-09 — Voice conversation session upgrade

### Implementation
- Reused `VoicePipeline` and the existing Web Speech recognition, `/api/chat`, Fish Audio `/api/voice/tts`, and subtitle/message UI. No parallel voice subsystem or sidebar destination was added.
- Added session start, pause, resume, and end lifecycle. The session creates one Web Speech recognition object per utterance, submits a finalized transcript once, waits for chat and TTS playback completion, then starts recognition again automatically. It guards duplicate starts/requests, filters empty/one-character fragments, and retries transient recognition/network termination with bounded exponential delays (maximum three retries).
- Recognition is suspended while LORD speaks. Fish Audio playback completion and browser speech fallback completion both resume listening; playback failure retains the text response and resumes the session. Stop/route cleanup clears retry timers, aborts recognition and TTS/chat work, stops playback, and revokes the audio URL.
- The Voice screen now offers “Start Voice Conversation”, pause/mute, resume, and end controls while retaining Tap to Talk, text fallback, spoken reply preference, subtitles, the existing orb, and current conversation pipeline. The browser speech service controls its own endpointing and may process microphone audio remotely; LORD does not persist raw microphone audio.
- Recognition does not appear as “Listening” until Web Speech fires its `start` event. Pausing during an in-flight AI request suppresses its audio reply but preserves the session for a later resume.

### Verification (actual)
- `npx vitest run src/lib/voice/voice-pipeline.test.ts`: **12 passed**, including a simulated finalized transcript, automatic second recognition session, and pause preventing further rearming.
- `npm test`: **604 passed, 2 skipped; 102 test files passed, 1 skipped**.
- `npx eslint src/lib/voice/voice-pipeline.ts src/lib/voice/voice-pipeline.test.ts src/components/lord/WakeWordProvider.tsx src/routes/_authenticated/voice.tsx`: passed, no errors or warnings for the changed files.
- `npx tsc --noEmit --pretty false`: passed.
- `git diff --check`: passed.
- Chromium browser test against the rendered `/voice` route: **10 synthetic transcript turns** traversed 10 mocked `/api/chat` streams and 10 mocked `/api/voice/tts` playbacks; recognition restarted automatically after each; pause, resume, and end controls worked; browser console/page errors and failed requests: **0**. At 390px, document width and scroll width were both 390px. This exercises the UI and lifecycle with mocked speech and service responses, not a live microphone, real model response, or Fish Audio provider.
- `npm run build`: **not completed**. Four attempts finished the client bundle, began the SSR bundle, then received SIGTERM (exit 143) before the SSR build completed. The latest attempt used the final voice source. The baseline production build result recorded in the earlier audit predates this voice change.

## 2026-11-09 — Root-persistent voice companion

### Implementation
- Mounted one `FloatingWakeAssistant` next to the root route outlet, outside page route components. Removed the AppShell-only mount and the old auto-stop on leaving `/voice`, so ordinary in-app navigation keeps the same `WakeWordProvider` and `VoicePipeline` alive. The `/voice` screen keeps its full controls; the compact floating panel is shown on other routes.
- Added explicit global Start, active session status, mic-listening indicator, pause/resume, End, and expand controls. Backgrounding still stops recognition and playback; the panel reports paused and requires an explicit resume. Permission revocation and removal of all audio-input devices stop the session with a recovery message.
- The shared controller sends a coarse allowlisted section label (for example Study, Tutor, Documents, Chat) through the existing `/api/chat` context field on the next user turn. It does not send page content or initiate proactive speech.
- Added exact-phrase local voice controls for “Pause listening”, “Resume listening”, “Repeat that”, “Speak slower”, “Stop speaking”, “Bye LORD”, “Stop voice”, and “Turn off voice”. Ordinary phrases containing words like “stop voice” are not treated as controls. Fish Audio speed is passed server-side via its documented `prosody.speed`; credentials remain server-only.
- Auth sign-in/sign-out resets in-memory voice messages and stops the session to avoid carrying guest voice context across identity changes. No active microphone state is persisted in browser storage.

### Verification (actual)
- Focused voice pipeline tests: **22 passed**, including exact commands, ordinary text not intercepted, the permission-pending/listening state transition, automatic rearming, pause/resume, and bounded retry exhaustion.
- Full `npm test`: **614 passed, 2 skipped; 102 test files passed, 1 skipped**.
- Changed-file ESLint and `git diff --check`: passed.
- Chromium/Playwright with synthetic SpeechRecognition and mocked Chat/TTS: voice session stayed active from Chat through Voice, back to Chat, and Home; one synthetic turn made one mocked chat request and one mocked TTS request; the same recognition controller remained alive through route changes and pause/resume; End stopped it. There were no page exceptions or `requestfailed` events; the browser logged one resource error for Home’s expected guest-denial `/api/openrouter-test` **403**. At a 390px viewport, document width and scroll width were both 390px. This does not establish physical mic use, real AI/TTS, authenticated Study/Tutor navigation, or cross-browser behavior.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run build` with `NODE_OPTIONS=--max-old-space-size=4096`: one full client+SSR build passed after the root-provider and TTS changes. A final rerun after removing the Voice-to-Chat stop callback rebuilt the client successfully but was terminated with SIGTERM at the start of SSR bundling (exit 143). Vite emitted existing chunk-size, mixed-import, externalized Node module, and dependency annotation warnings.

### Remaining limitations
- Web Speech owns its audio capture and endpointing. This does not add one app-managed `MediaStream`, local VAD, reliable barge-in while LORD is speaking, or an 800–1200 ms configurable silence threshold. A voice “Stop speaking” command cannot be recognized during TTS because recognition is suspended to avoid transcribing LORD’s audio; use the visible Stop speaking control.
- Actual microphone permission/revocation/device-loss behavior, five real speech turns, barge-in, navigation with an authenticated account, and mobile/background operation remain unverified. The browser’s speech service may process audio remotely; this is disclosed before activation. No raw audio is stored by LORD.

### Not verified / platform limits
- No physical microphone or actual speech recognition session was available in this run. Microphone permission denial/device loss, ten consecutive turns using real recognized speech and real providers, true Fish Audio playback completion followed by a second spoken turn, and interruption during playback remain unverified for this implementation. The Chromium UI/lifecycle simulation at desktop and 390px mobile viewport is not evidence of actual mobile browser speech support.
- The browser Web Speech API controls speech endpointing and microphone capture. This change does not implement local acoustic VAD, configurable 800–1200 ms silence detection, or a persistent app-owned microphone stream. It does not claim continuous recognition support across Chrome, Edge, Safari, or mobile; actual support depends on browser speech services.
- Fish Audio remains configured server-side through the existing endpoint, but no live TTS request was made as part of this implementation verification. Prior TTS smoke evidence above predates this session-loop change and does not verify a full continuous voice conversation.

