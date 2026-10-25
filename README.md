# ⚡ LORD AI

<div align="center">

![LORD Banner](https://img.shields.io/badge/LORD-AI%20OS-00D4FF?style=for-the-badge)

### Logical Operational Resource Director

**A Next-Generation AI**

[![React](https://img.shields.io/badge/React-19-blue?style=flat-square)](<>)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square)](<>)
[![TanStack Router](https://img.shields.io/badge/TanStack-Router-orange?style=flat-square)](<>)
[![Vite](https://img.shields.io/badge/Vite-Latest-purple?style=flat-square)](<>)
[![AI SDK](https://img.shields.io/badge/AI-SDK-green?style=flat-square)](<>)

---

### 🧠 Your Personal AI

_Not just a chatbot. An intelligent command center._

</div>

---

# 🚀 Overview

LORD (Logical Operational Resource Director) is a futuristic AI designed to provide an immersive, intelligent, and highly interactive assistant experience.

Built with a cyberpunk-inspired HUD interface, LORD combines:

- 💬 Persistent AI Conversations
- 🎙️ Voice Command Infrastructure
- 🧠 Long-Term Memory Systems
- 📊 Real-Time System Monitoring
- 🧠 Study tutor
- ⚡ Multi-Mode Intelligence Engine
- 🎯 Workflow Assistance
- 🔍 Research & Knowledge Operations

into a single unified experience.

---

# ✨ Core Features

## 🧠 AI Intelligence Engine

LORD supports multiple specialized reasoning modes:

| Mode         | Purpose              |
| ------------ | -------------------- |
| ⚡ Fast      | Quick answers        |
| ⚖️ Balanced  | Everyday assistant   |
| 🧠 Reasoning | Deep analysis        |
| 💻 Coding    | Software engineering |
| 🎨 Creative  | Writing & ideation   |

---

## 💬 Persistent Conversations

Unlike traditional chat interfaces:

✅ Conversations are saved automatically

✅ Chat history persists across sessions

✅ Previous chats can be reopened instantly

✅ Local-first architecture

```text
Conversation
 ├── Messages
 ├── Metadata
 ├── Timestamps
 └── Context Memory
```

---

## 📡 System Intelligence Dashboard

Real-time operational monitoring:

- API Health
- Database Status
- Authentication Status
- Latency Monitoring
- Uptime Tracking
- Error Detection
- Route Awareness

Designed to feel like a true AI command center.

---

## 🎙️ Voice Interface

Current & Planned Capabilities:

### Current

- Voice UI
- Transcript Display
- AI Response Panel

### Roadmap

- Wake Word Detection
- Speech Recognition
- Text-To-Speech
- Continuous Listening
- Voice Profiles

Example:

```text
User:
"Hey Lord"

LORD:
Listening...

User:
"Summarize today's tasks."

LORD:
Processing...

LORD:
Here is your task summary...
```

---

## 🧠 Memory System

LORD's memory system supports saving:

- Preferences
- Goals
- Projects
- Facts
- Notes

Saved memories are managed in the authenticated Memory settings page. Users can pause
personalization without deleting saved records, exclude individual memories, correct or delete
records, and clear the active memory store. Chat retrieval is relevance- and project-scoped; global
memories can be used in a project, but project-specific memories are not used outside that project.
Memories sourced from chat are distinguished from user-added records, and memory text is treated as untrusted reference
data rather than instructions. Clearing LORD's active records does not delete source conversations
or guarantee immediate removal from provider backups.

Example:

```text
Remember that I am preparing for JEE.

Weeks later...

User:
What should I focus on today?

LORD:
Based on your JEE preparation...
```

---

# 🏗 Architecture

## LORD What-If Lab

The authenticated `/what-if` workspace creates meaningfully different qualitative approaches
through LORD's configured OpenRouter model, then compares user-entered costs, effort, and risk
with deterministic calculations. It supports editable assumptions and constraints, sensitivity
analysis, private saved revisions, duplication, saved-revision comparison, and JSON report export.

Generated benefits, disadvantages, dependencies, and questions are hypotheses, not verified facts.
LORD does not invent prices or citations, run unconfigured simulations, guarantee outcomes, or
execute real-world actions from a scenario. Cost totals use the user's own input units:
`upfront cost + monthly cost × time horizon`.

```text
┌──────────────────────────┐
│      LORD AI OS          │
└────────────┬─────────────┘
             │
             ▼

 ┌─────────────────────┐
 │   React Frontend    │
 └─────────────────────┘
             │
             ▼

 ┌─────────────────────┐
 │ AI SDK Integration  │
 └─────────────────────┘
             │
             ▼

 ┌─────────────────────┐
 │ Chat Intelligence   │
 └─────────────────────┘
             │
             ▼

 ┌─────────────────────┐
 │ Memory + Storage    │
 └─────────────────────┘
```

---

# 🖥 User Interface

Inspired by:

- J.A.R.V.I.S
- F.R.I.D.A.Y
- Iron Man HUD Systems
- Cyberpunk Tactical Interfaces

Features:

- Neon Glow Effects
- Dynamic HUD Panels
- Real-Time Telemetry
- Responsive Layout
- Dark Futuristic Theme

---

# 📂 Project Structure

```bash
src/
│
├── components/
│   ├── lord/
│   │   ├── AppShell.tsx
│   │   ├── HealthHud.tsx
│   │   ├── ChatSidebar.tsx
│   │   ├── HudPanel.tsx
│   │
│   └── voice/
│
├── routes/
│   ├── chat.tsx
│   ├── voice.tsx
│   ├── dashboard.tsx
│
├── lib/
│   ├── lord-store.ts
│   ├── monitoring-service.ts
│   ├── use-persisted-state.ts
│   └── lord-config.ts
│
└── api/
```

---

# 🔥 Current Milestones

### Completed

- ✅ Multi-Mode AI Chat
- ✅ Conversation Persistence
- ✅ Chat History Sidebar
- ✅ Conversation Recovery
- ✅ Collapsible Health Panel
- ✅ Local Storage Architecture
- ✅ LORD UI System

### In Progress

- 🚧 Voice Pipeline
- 🚧 Speech Recognition
- 🚧 Wake Word Detection
- 🚧 Text-To-Speech
- 🚧 Memory Engine

### Future

- 🔮 Agent Workflows
- 🔮 Research Assistant
- 🔮 Autonomous Tasks
- 🔮 Personal Knowledge Base
- 🔮 Mobile Companion
- 🔮 Native Desktop Client

---

# ⚙️ Installation

```bash
git clone https://github.com/nagasatwik145/Lord.git

cd Lord

npm install

npm run dev
```

---

# 🔐 Environment Setup

Copy the example environment file and fill in your values. **Never commit `.env`** — it is git-ignored.

```bash
cp .env.example .env
```

| Variable                                  | Required | Where  | Purpose                                            |
| ----------------------------------------- | -------- | ------ | -------------------------------------------------- |
| `VITE_SUPABASE_URL`                       | ✅       | Client | Supabase project URL (public)                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY`           | ✅       | Client | Supabase anon/publishable key (public)             |
| `SUPABASE_URL`                            | ✅       | Server | Supabase project URL (server)                      |
| `SUPABASE_PUBLISHABLE_KEY`                | ✅       | Server | Supabase anon/publishable key (server)             |
| `OPENROUTER_API_KEY`                      | ✅       | Server | OpenRouter API key for AI (secret)                 |
| `TAVILY_API_KEY`                          | ⬜       | Server | Optional cited web search (secret; Sources toggle) |
| `SUPABASE_SERVICE_ROLE_KEY`               | ⬜       | Server | Admin client (bypasses RLS)                        |
| `SUPABASE_PROJECT_ID`                     | ⬜       | Both   | Supabase CLI / tooling                             |
| `OPENROUTER_REFERER` / `OPENROUTER_TITLE` | ⬜       | Server | OpenRouter attribution headers                     |

> Only `VITE_`-prefixed variables reach the browser. Keep `OPENROUTER_API_KEY` and
> service-role keys server-side only.

What-If Lab uses the existing Supabase and `OPENROUTER_API_KEY` configuration; no additional
environment variables are required. Apply `supabase/migrations/20261024020000_lord_what_if_scenarios.sql`
before using the workspace. Saved scenario rows are protected by Supabase row-level security and
the authenticated API also scopes reads and writes to the current user.

The chat **Sources** toggle requires a server-side `TAVILY_API_KEY`. Get a key at
[Tavily](https://app.tavily.com/), then add it to your local `.env` file using the
placeholder above. In Vercel, add `TAVILY_API_KEY` under **Project → Settings → Environment
Variables** for each environment that should support web search, then redeploy. Do not use
a `VITE_` prefix. Search requests support Tavily's `basic` and `advanced` depths and 1–20
results; the chat defaults to basic depth and five results. The API account's quotas and
limits apply, and quota exhaustion is surfaced so LORD never implies a failed search worked.
Freshness-sensitive questions (for example, asking for current or latest information, news,
prices, or sources) also trigger bounded research automatically; ordinary questions keep the
normal fast chat path. Search results are not treated as verified pages: LORD retrieves up to
five result pages through the server's SSRF-safe text fetcher, labels inaccessible pages and
snippet-only results, and cites only page content it could retrieve. Successful search results
are cached in server memory for five minutes. Automatically triggered research falls back to
an answer that states the verification limitation if Tavily is unavailable; manually enabled
Sources requests report a retryable error instead. Chat shows the research outcome and exposes
a retry action when live search returns no results, pages are unavailable, or research otherwise
could not be completed.

---

# 🚀 Deploy to Vercel

LORD AI is a [TanStack Start](https://tanstack.com/start) app. The build uses the Nitro
`vercel` preset, which emits a Vercel **Build Output API** (`.vercel/output`) with a
Node.js serverless function (SSR + `/api/chat`) and static assets.

1. Push this repository to GitHub and import it in Vercel.
2. Vercel auto-detects the build (`npm run build`). No framework override is needed
   (`vercel.json` disables framework auto-detection so the Nitro output is used).
3. Add the environment variables above in **Project → Settings → Environment Variables**.
   At minimum set the four Supabase vars and `OPENROUTER_API_KEY`.
4. Deploy. The Node function runs on the same runtime the build targets
   (see `.nvmrc`).

Local production preview:

```bash
npm run build
npm run preview
```

---

# 🛡 Philosophy

LORD is built around a simple idea:

> AI should feel less like a chatbot and more like an intelligent Next-Gen AI for personal use only.

Instead of answering isolated questions, LORD aims to become a persistent, context-aware digital companion capable of assisting across projects, learning, productivity, and research.

---

# 👨‍💻 Developer

### Naga Satwik

Building a futuristic AI from the ground up.

> "The goal isn't to create another chatbot.
> The goal is to build Next-Gen J.A.R.V.I.S."

---

<div align="center">

### ⚡ LORD AI

**Command. Reason. Execute.**

Made with ❤️ and caffeine.

</div>

---

# LORD Pro billing setup

LORD Pro prices default to ₹99 monthly and ₹990 yearly. Razorpay subscriptions
remain test-mode only: configure matching monthly and yearly plans and the
`RAZORPAY_*` server variables from `.env.example`. Register
`/api/billing/webhook` with the webhook secret and subscribe to
`subscription.charged`, `subscription.cancelled`, `subscription.halted`, and
`subscription.completed`. Razorpay entitlements activate or renew only from a
verified webhook. Its hosted checkout can offer UPI apps such as Google Pay when
UPI is enabled for the merchant account.

PhonePe is also available as a separate sandbox, one-time checkout. Apply
`supabase/migrations/20261025020000_phonepe_one_time_payments.sql` after the
existing Pro billing migration, configure `PHONEPE_CLIENT_ID`,
`PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION`, and the public HTTPS
`APP_BASE_URL`, and keep `PHONEPE_ENV=sandbox`. The customer is returned to the
upgrade page, which verifies payment status server-to-server before granting
one month or one year of Pro access. PhonePe payments do not renew
automatically; Razorpay remains the recurring subscription option. Production
PhonePe payments are intentionally disabled until a production integration is
explicitly configured and reviewed.

Set `LORD_LIFETIME_PRO_USERS` to comma-separated `auth.users` UUID and email
pairs for the three designated accounts. Confirm each immutable UUID in the
Supabase dashboard and keep each email verified. The application grants
lifetime access only when both that configured UUID and verified email match
the authenticated Supabase user. Do not copy account emails alone into this
setting. Android and web use the same server routes and records.
