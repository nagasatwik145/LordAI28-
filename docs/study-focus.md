# LORD Study Focus

LORD Study Focus extends the existing Study Platform at `/study`.

## Available now

- Countdown, Pomodoro (25/5 defaults with configurable focus, breaks, and long-break interval), and stopwatch modes.
- Pause/resume, break skipping, intentional finish, and discard with confirmation.
- Optional subject and session label; planner task launch fills these in when available.
- Timestamp-based elapsed time and per-user browser persistence for an active timer, including restoration after navigation or reload.
- Completed and interrupted session records stored in Supabase. Repeated uploads use the same session ID and do not create duplicate rows. Offline uploads remain queued in browser storage and retry after connectivity returns.
- Progress summaries use persisted completed records. Interrupted sessions and Pomodoro break time are excluded; empty, loading, and retry states are shown.
- Study Focus data is protected by owner-scoped row-level security.

## Setup

Apply `supabase/migrations/20261025000000_study_focus_sessions.sql` before using session history or analytics. The API uses the application's existing authenticated Supabase request middleware.

## Platform and scope notes

- An active timer is restored from browser/device storage for the same signed-in user on that device. Active timer state is not synchronized across devices.
- Offline completion is preserved locally and queued, but history and analytics require a successful sync.
- Planner integration starts a countdown from an existing dated task. New start-time blocks, overlap detection, rescheduling, reminders, and planned-versus-completed planner analytics remain future work.
- Browser focus mode does not block websites, external navigation, or other Android apps. No sensitive Android permissions or native blocking feature are used.
- Distraction settings, study-resource/YouTube organizer, reminders, focus sounds/themes, and focus groups are not part of this initial implementation.
- Session duration is calculated by the timer using timestamps and is constrained by elapsed wall time at the API boundary. As with other client-operated timers, this is a personal progress tool, not tamper-proof attendance verification.
