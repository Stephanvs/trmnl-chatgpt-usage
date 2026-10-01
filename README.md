# TRMNL ChatGPT usage plugin: research findings

Goal: a TRMNL screen that looks like the official GitHub contribution graph plugin but shows the ChatGPT/Codex profile token activity (lifetime tokens, peak tokens, longest task, streaks, daily heatmap), usable by other people as a community plugin.

Status (2026-10-01): **not built.** This document records what was investigated and why a community plugin is currently considered not feasible. At least not without it needing a custom client-side app that uses a auth token from OpenAI that is used to request the usage data, and then submits this data somewhere for TRMNL to consume.

---

## 1. Facts

### 1.1 How TRMNL plugins work

- A TRMNL device fetches a pre-rendered PNG from TRMNL's server. TRMNL renders the screen from HTML in a headless browser. The OG device is 800x480, 1-bit or 4-gray.
- A custom screen is a Private Plugin written in Liquid, with one tab per layout (full, half_horizontal, half_vertical, quadrant) and a Shared tab. A plugin can be published as a Recipe.
- Data strategies:
  - **Webhook:** the user's own service POSTs `{"merge_variables": {...}}` to `https://trmnl.com/api/custom_plugins/<uuid>`. Limits: 5 KB per payload (10 KB on TRMNL+), 12 requests/hour (30 on TRMNL+). The account needs a device with Developer edition, otherwise the webhook returns 403.
  - **Polling:** TRMNL's server fetches a URL. Form fields (including type `password`) can be interpolated into the URL and headers, e.g. `Authorization: Bearer {{ api_key }}`.
- Webhook-strategy recipes are allowed. Recipes go through an automated linter ("Chef") and TRMNL team review.

### 1.2 How the official GitHub plugin gets its data

Source: `usetrmnl/plugins`, `lib/github_commit_graph/`.

- The user supplies only a GitHub username.
- TRMNL's server posts a GraphQL query (`user(login: $userName) { contributionsCollection { contributionCalendar … } }`) to `https://api.github.com/graphql`.
- It authenticates with a single token owned by TRMNL (`Rails.application.credentials.plugins.github_commit_graph_token`), used for rate limits, not for access to private data.
- Streaks, max and average are computed in Ruby; the ERB views loop over days and print `<span class="day bg--gray-N">`.
- This works because GitHub contribution calendars are public data readable by username.

### 1.3 The ChatGPT/Codex profile

- The profile at `chatgpt.com/u/<handle>` launched around 2026-09-29 as part of Codex. It shows lifetime tokens, peak tokens, longest task, longest/current streak, a token-activity heatmap (daily/weekly/cumulative), top plugins and insights.
- OpenAI states profiles are "private by default".
- No public API specification or documentation for the profile data was found.
- Anonymous access, tested 2026-10-01:
  - Plain HTTP requests, and headless Chrome: HTTP 403 with a Cloudflare managed challenge (`Cf-Mitigated: challenge`, "Just a moment...").
  - Headed Chrome passes the challenge. With the profile private, the page returns 404 "Not found".
  - With the profile set to public, the page shows only name, avatar and handle, plus "Log in to view the full profile". The stats are not in the HTML and no JSON requests are made. The `og:image` is the avatar.

### 1.4 Where the data can be read from

Found in the open-source Codex client (`openai/codex`, v0.159.3 tested):

- **App-server JSON-RPC `account/usage/read`** (spawn `codex app-server`, send `initialize`, `initialized`, then the request). Response: `summary { lifetimeTokens, peakDailyTokens, longestRunningTurnSec, currentStreakDays, longestStreakDays }` and `dailyUsageBuckets [{ startDate, tokens }]`.
  - Verified locally: lifetime 6,306,177,931; peak 251,953,418; longest turn 86,167 s (23h 56m); current streak 8; longest streak 19; 189 daily buckets (2025-12-11 to 2026-09-30). These match the profile screenshot.
  - Implemented by the Codex client calling `GET https://chatgpt.com/backend-api/wham/profiles/me` (path style `/api/codex/profiles/me` for the other base URL) with the ChatGPT login token.
- **`wham/profiles/me`** also returns `fast_mode_usage_percentage`, `most_used_reasoning_effort(_percentage)`, `unique_skills_used`, `total_skills_used`, `total_threads` and `top_invocations` (plugins, skills). `account/usage/read` does not expose these. This endpoint was **not called directly** during this research.
- The handler rejects non-ChatGPT auth: `"chatgpt authentication required to read token usage"`. `AuthMode::uses_codex_backend()` is `true` for `Chatgpt`, `ChatgptAuthTokens`, `Headers`, `AgentIdentity`, `PersonalAccessToken` and `false` for `ApiKey`, `BedrockApiKey`, `BedrockAccessKeys`.
- Local Codex session logs (`~/.codex/sessions/**/*.jsonl`) contain `token_count` events, but only cover the machine they were written on.

### 1.5 Credentials

- `~/.codex/auth.json` holds the ChatGPT access token, ID token and refresh token. OpenAI's docs say to treat it "like a password: it contains access tokens".
- Codex refreshes the token during use; the source has `TOKEN_REFRESH_INTERVAL = 8` days. A reused refresh token fails with "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again."
- Codex access tokens (`at-…` prefix, "personal access token" / agent identity) exist: created in the ChatGPT admin console with a name and an expiry (minimum one day), used with `codex login --with-access-token` or `CODEX_ACCESS_TOKEN`. OpenAI's docs list them as supported for ChatGPT Business and Enterprise workspaces. Whether such a token can read `wham/profiles/me` was **not tested**.
- OpenAI API keys (`sk-…`) and Admin keys: the Usage API (`GET /v1/organization/usage/completions`, `bucket_width=1d`, Admin key) reports API-platform usage (`input_tokens`, `output_tokens`, …), not ChatGPT/Codex subscription usage. The Usage API reference page itself could not be fetched (403); details come from the OpenAI cookbook and search results.

### 1.6 What CodexBar does

CodexBar (`steipete/CodexBar`, MIT, macOS app plus Linux CLI) shows Codex quota windows, credits and local cost. Its Codex sources:

1. OAuth API (default): reads `~/.codex/auth.json`, calls `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer <access_token>`, `ChatGPT-Account-Id`, `User-Agent: codex-cli`. It never writes refreshed tokens back; the Codex CLI owns `auth.json`.
2. CLI RPC via `codex app-server`.
3. Optional web dashboard: hidden WebView on `https://chatgpt.com/codex/cloud/settings/analytics#usage`, with browser cookies imported from disk or a pasted `Cookie:` header.

It displays 5-hour/weekly rate-limit windows (`used_percent`, `reset_at`) and credits. Its documented `wham/usage` response does not include the profile stats (lifetime tokens, streaks, heatmap). All three sources run on the user's own machine with the user's ChatGPT credentials.

### 1.7 Options and what each requires

| Option | Data | Credential involved | Where it runs |
|---|---|---|---|
| Scrape `chatgpt.com/u/<handle>` | Stats are not visible logged out | ChatGPT browser session cookies | A browser that passes Cloudflare |
| TRMNL webhook fed by a user-run tool using `codex app-server` | Full profile summary + heatmap | The user's existing local Codex login (never sent anywhere) | User's own machine / server with Codex installed and logged in |
| TRMNL polling `wham/profiles/me` | Full profile (+ insights) | ChatGPT access token pasted into a TRMNL password field | TRMNL's servers (Cloudflare reachability from TRMNL IPs not tested) |
| Hosted service with "Sign in with ChatGPT" | Full profile | Refresh tokens stored by the service | The service |
| OpenAI API key | Rejected by the profile endpoint | n/a | n/a |
| OpenAI Admin key + Usage API | API-platform usage only (different dataset) | Admin key | TRMNL polling possible |
| Business/Enterprise `at-…` token | Untested | Workspace-scoped access token | n/a |

---

## 2. Not verified

- Whether `wham/profiles/me` is reachable from TRMNL's servers (Cloudflare in front of `chatgpt.com`).
- The actual lifetime of the ChatGPT access token in `auth.json` (the file was deliberately not read).
- Whether an `at-…` Codex access token authorises `wham/profiles/me`.
- Whether OpenAI's "share a card" feature produces a URL with machine-readable stats.
- Stability: the app-server protocol and the `wham` endpoints are undocumented/experimental and can change in a Codex update.

---

## 3. Conclusion (project owner's assessment)

As of 2026-10-01, building this as a general community plugin is considered not feasible:

- Unlike GitHub, there is no public data and no public API for the ChatGPT/Codex profile, so the "enter a username" model cannot work. The public profile page does not expose the stats.
- Every route that returns the real profile data needs the user's ChatGPT login credential (or a browser session). An OpenAI API key does not work.
- The credential is a full-account token that Codex itself rotates, so handing it to TRMNL (polling) or a hosted service means storing a long-lived secret for strangers, with weekly re-entry.
- The route that keeps the credential local (a user-run tool pushing to a TRMNL webhook) needs every user to have Codex installed and logged in, run a scheduled job, and own a TRMNL device with Developer edition. It also relies on an experimental, unofficial protocol.
- The one purpose-built, revocable credential (`at-…` access tokens) is documented for Business/Enterprise workspaces only, and its access to this endpoint is untested.

Revisit if OpenAI publishes a public profile/stat endpoint, a read-only API key, or a share link that exposes the stats in machine-readable form.

---

## 4. Repository contents

- `scratch/usage.mjs`: working proof of concept that spawns `codex app-server`, calls `account/usage/read` and writes `scratch/usage.json`. `usage.json` contains personal usage data.

## 5. Sources

- TRMNL docs: https://docs.trmnl.com/go/private-plugins/webhooks, https://docs.trmnl.com/go/llms-full.txt, https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder, https://help.trmnl.com/en/articles/9510536-custom-plugins
- GitHub plugin source: https://github.com/usetrmnl/plugins/tree/master/lib/github_commit_graph
- Codex client source: https://github.com/openai/codex (`codex-rs/backend-client/src/client/profile.rs`, `codex-rs/app-server/src/request_processors/account_processor.rs`, `codex-rs/app-server-protocol/schema/json/v2/GetAccountTokenUsageResponse.json`, `codex-rs/protocol/src/auth.rs`, `codex-rs/login/src/auth/access_token.rs`)
- Codex auth docs: https://learn.chatgpt.com/docs/auth, https://learn.chatgpt.com/docs/enterprise/access-tokens
- Codex profile announcement: https://x.com/OpenAIDevs/status/2062674774644687268
- OpenAI Usage API cookbook: https://cookbook.openai.com/examples/completions_usage_api
- CodexBar: https://github.com/steipete/CodexBar (`docs/codex.md`, `docs/codex-oauth.md`)
