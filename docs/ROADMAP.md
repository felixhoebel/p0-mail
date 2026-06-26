# p0mail Integration Plan & Roadmap

> **Purpose.** Self-contained workstream specs for autonomous agents. Each task lists what to build, which files to touch, dependencies, and how to verify. Pick a phase → pick a task → execute end-to-end.

**Current state:** Phase 1-3 complete (DB encrypted at rest, background polling, new-mail notifications, FTS5 search, CI signing, OAuth + IMAP + AI streaming, attachments, folders, drafts, reply-all/forward, virtualization, error boundary, sync health). Phase 4 in progress: 4.1 Command palette ✅, 4.9 AI summary workflow ✅, 4.2 Undo send ✅, 4.3 Schedule send ✅ (+ draft edit/delete from Outbox); remaining (snooze, autocomplete, bundles, per-account settings, live theme). Phase 5 (code-quality refactors: lib.rs/InboxPage god-modules) partially done (5.1-5.3 ✅; 5.4-5.6 pending). An audit found a few latent bugs in "complete" tasks (see 5.2 FTS bug ✅fixed, mark_read swallows IMAP errors, handleArchive/handleDelete swallow backend errors) — these are tracked in Phase 5.

**Conventions:** Conventional commits (`feat:`, `fix:`, `security:`, `chore:`). No comments unless asked. Rust in `src-tauri/src/`, React in `src/`. Verify with `cargo test` + `npm run build` (CI runs `tsc --noEmit` + build).

---

## Priority Order

| Priority | Theme | Why first |
|---|---|---|
| **P0** | Correctness & security | App is neither private (unencrypted DB) nor actually fetching mail (no polling). These break the core promise. |
| **P1** | MVP completeness | Attachments, folders, drafts, reply-all/forward — PRD-required, currently stubbed. |
| **P2** | Robustness | Will crash/jank under real load (no virtualization, no error boundary, blocking online check). |
| **P3** | 2026 UX differentiators | Command palette, undo send, snooze — the "sleek & elegant" layer. |

---

## Phase 1 — P0: Ship-Blockers ✅ COMPLETE

### 1.1 Background mail polling loop
**PRD:** FR-SYNC-02 (60s ±10s jitter per account).
**Problem:** `sync/mod.rs` only runs on manual `trigger_sync`. No new mail until user clicks refresh.
**Spec:**
- Spawn a long-running tokio task at app startup (`lib.rs run()`) that calls `SyncEngine::sync_all()` every 60s ± 10s random jitter.
- Respect a per-account `sync_enabled` flag (new column, default 1) so users can pause noisy accounts.
- Emit a Tauri event `mail-synced` with `{account_id, new_count}` after each cycle; frontend refreshes thread list when received.
- Backoff to 5min if a sync cycle throws, reset to 60s on success.
- On app foreground (Tauri window event), trigger an immediate sync.
**Files:** `src-tauri/src/sync/mod.rs`, `src-tauri/src/lib.rs` (spawn in `run()`), `src-tauri/migrations/005_sync_enabled.sql`, `src/lib/api.ts` (listen event), `src/pages/InboxPage.tsx` (refresh on event).
**Verify:** Add log line per cycle; manually trigger by setting interval to 5s in dev. Confirm new mail arrives without clicking refresh.
**Depends on:** 1.3 (SQLCipher key) so polling writes encrypted.

### 1.2 New-mail notifications
**PRD:** FR-NTF-01/02.
**Problem:** `tauri-plugin-notification` registered but never called; permission not granted in capabilities.
**Spec:**
- Add `notification:default` + `notification:allow-notify` to `src-tauri/capabilities/default.json`.
- After each poll cycle, query DB for emails with `received_at > last_notification_ts` and `is_read = 0` for the account.
- Call `app.notification().builder().title(sender).body(subject).show()` from Rust (Tauri `NotificationExt`).
- Persist `last_notified_at` per account in `app_settings` to avoid re-notifying on every cycle.
- On notification click: emit event to frontend to foreground window + open thread. Use `tauri::RunEvent` window focus + `app.emit("open-thread", thread_id)`.
- Respect OS DND (Tauri notification plugin does this natively — no custom logic needed per FR-NTF-03).
**Files:** `src-tauri/capabilities/default.json`, new `src-tauri/src/notifications/mod.rs`, `src-tauri/src/lib.rs` (wire into poll loop + module list), `src/pages/InboxPage.tsx` (listen `open-thread`).
**Verify:** Send yourself a test email; confirm OS notification fires within ~60s. Click → window focuses + thread opens.
**Depends on:** 1.1 (poll loop).

### 1.3 SQLCipher encryption at rest
**PRD:** NFR-Sec-02. Currently violated — `bundled-sqlcipher` compiled but `Connection::open` uses no key.
**Problem:** `src-tauri/src/db/mod.rs:18` opens plaintext. Stealing the `.db` file exposes all email.
**Spec:**
- Generate a random 256-bit key on first run, store in OS keychain via `secure` module (`p0mail_db_key`).
- On `db::init()`, open connection then execute `PRAGMA key = 'x'<hex-key>';` before any query.
- Verify encryption worked: attempt to read DB file bytes outside SQLite → should be ciphertext. Add a test that opens the same file without key and asserts it fails.
- Handle keychain miss gracefully: if key absent on subsequent runs, treat as first run (generate + store).
- Document that losing the keychain entry = losing mail (acceptable per threat model; it's the OS session that protects).
**Files:** `src-tauri/src/db/mod.rs`, `src-tauri/src/secure/mod.rs`, `src-tauri/src/db/mod.rs` tests.
**Verify:** `cargo test` — new test asserts encrypted-open fails without key. Inspect `~/Library/Application Support/p0mail/p0mail.db` in a hex editor → not plaintext.
**Depends on:** nothing. **Blocks:** 1.1 (don't poll into plaintext).

### 1.4 Fix FTS5 indexing (search is broken)
**PRD:** FR-UI-05/06.
**Problem:** FTS5 `body_html_stripped` column is hardcoded `''` in every trigger (`migrations/001,002`). Bodies are lazy-fetched and never re-indexed. Search misses most content.
**Spec:**
- Migration `006_fts_body_index`: recreate triggers to index stripped body. When `body_text`/`body_html` is NULL (not yet fetched), index empty string; trigger on UPDATE re-indexes when body arrives.
- After `email_parse::apply_raw_message` sets the body, the existing UPDATE trigger must fire — verify the update path touches a column that the update trigger watches (currently it does, since `body_text`/`body_html` change).
- Add a `reindex_account(account_id)` command that backfills FTS for all emails with bodies, so existing cached mail becomes searchable.
- Search results should return threads (group by `thread_id`), not raw emails — update `search_emails` to join → distinct threads → fetch latest email per thread.
**Files:** `src-tauri/migrations/006_fts_body_index.sql`, `src-tauri/src/search/mod.rs`, `src-tauri/src/lib.rs` (`search_emails` command + new `reindex_account`), `src/pages/InboxPage.tsx` (search → thread view).
**Verify:** Sync an account, open 5 emails (to fetch bodies), run `reindex_account`, search a word from a body → result appears in <500ms.
**Depends on:** nothing.

### 1.5 CI code signing + notarization
**PRD:** NFR-DEP-01, Risks R-02/R-06.
**Problem:** `ci.yml` builds only; unsigned binaries trigger Gatekeeper/SmartScreen.
**Spec:**
- macOS: add `tauri-action` `args` with `--target universal-apple-darwin`; wire `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` + `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` secrets; run `notarytool` via tauri-action.
- Windows: add EV cert via `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets.
- Add a `release` job (on tag `v*`) that uploads artifacts to GitHub Release.
- Document required secrets in a new `docs/RELEASE.md` (don't commit secrets).
**Files:** `.github/workflows/ci.yml`, `docs/RELEASE.md`, `src-tauri/tauri.conf.json` (signing config if needed).
**Verify:** Tag a release locally; confirm CI produces signed `.dmg` that opens without "unidentified developer" warning.
**Depends on:** nothing (infra). Can run parallel to code work.

---

## Phase 2 — P1: MVP Completeness

### 2.1 Attachments: send + receive
**PRD:** G-04, FR-CMP-03 (send up to 25MB), FR-UI-04.
**Problem:** `ComposeService.send_email` ignores `_attachments`. Incoming attachment metadata parsed but no download.
**Spec:**
- **Send:** `ComposeService` accepts `Vec<AttachmentPayload { filename, mime_type, data: Vec<u8> }>` instead of file paths. Use `lettre::message::MultiPart` with `singlepart` attachment parts. Enforce 25MB total.
- **Frontend:** `ComposeEditor` adds a file picker (Tauri `dialog.open` with `multiple: true`) + drag-drop zone + paste image. Read file bytes via Tauri `fs` plugin, pass to `send_email` command.
- **Receive:** `email_parse::apply_raw_message` already extracts `attachments_meta`. Add `download_attachment(email_id, filename)` command that re-fetches the MIME part from IMAP, saves to user's Downloads dir via Tauri `dialog.save` + `fs`.
- **UI:** Render attachment chips in `EmailViewer` with download button; in compose, show removable chips.
**Files:** `src-tauri/src/compose/mod.rs`, `src-tauri/src/smtp_client/mod.rs`, `src-tauri/src/lib.rs` (`download_attachment`, update `send_email`/`queue_email` signatures), `src/components/email/ComposeEditor.tsx`, `src/components/email/EmailViewer.tsx`, `src-tauri/src/email_parse.rs`.
**Verify:** Send an email with a PDF + image to yourself → receive → download → file opens. Compose with drag-drop works.
**Depends on:** nothing.

### 2.2 Folders: Sent, Drafts, Trash, Spam
**PRD:** FR-SYNC-06/07, G-03.
**Problem:** Sync only selects `INBOX`. Sent mail never cached locally.
**Spec:**
- Add `folders` table: `account_id, name, imap_name, special_use (sent/drafts/trash/spam/archive)`.
- On first sync per account, `LIST "" *` to discover folders; map via `XLIST`/special-use attributes. Fallback to common names (`Sent`, `Drafts`, `Trash`, `Junk`).
- `SyncEngine.sync_account` loops configured folders, not just INBOX. Poll each with its own `last_seen_uid` (move uid tracking to per-folder — new `folder_sync_state` table).
- Sidebar: add folder section under each account (collapsible). Unified inbox stays the default view.
- Sent mail: after SMTP send, insert a copy into local `emails` with `folder = 'Sent'` and append to server Sent folder via IMAP `APPEND`.
**Files:** `src-tauri/migrations/007_folders.sql`, `src-tauri/src/sync/mod.rs`, `src-tauri/src/lib.rs` (new commands `list_folders`, `list_thread_by_folder`), `src/pages/InboxPage.tsx` (folder nav), `src-tauri/src/compose/mod.rs` (append to Sent).
**Verify:** Send email → appears in Sent folder locally + on server. Archive → moves to Archive folder. Delete → in Trash.
**Depends on:** 1.1 (poll loop infrastructure).

### 2.3 Drafts: autosave + Drafts folder
**PRD:** Implied by G-03, robustness promise.
**Problem:** Closing compose loses everything.
**Spec:**
- Add `drafts` table or reuse `send_queue` with `status = 'draft'`.
- Compose editor autosaves every 3s if content changed (debounced). On unmount/close, save final state.
- Drafts surface in Drafts folder (from 2.2) and as a compose "resume" prompt when reopening.
- Opening a draft loads into compose editor; sending removes from drafts.
**Files:** `src-tauri/migrations/008_drafts.sql`, `src-tauri/src/lib.rs` (`save_draft`, `list_drafts`, `delete_draft`), `src/components/email/ComposeEditor.tsx`, `src/pages/InboxPage.tsx`.
**Verify:** Type in compose → close app → reopen → draft restored. Send → draft gone.
**Depends on:** 2.2 (Drafts folder).

### 2.4 Reply-All + Forward
**PRD:** G-03, FR-CMP-06.
**Problem:** Only single-recipient Reply exists.
**Spec:**
- Reply-All: `to` = original `from` + `to` - self; `cc` = original `cc`; subject `Re:`; headers `In-Reply-To` + `References`.
- Forward: `to` empty; subject `Fwd:`; body = original quoted; no `In-Reply-To` (new thread).
- Trim quoted context to last 3 levels (strip nested `>` blockquotes beyond depth 3).
- Add buttons in action toolbar + context menu.
**Files:** `src/pages/InboxPage.tsx` (new `openReplyAllComposer`, `openForwardComposer`), `src/components/email/ComposeEditor.tsx` (forward mode).
**Verify:** Reply-all on a multi-recipient thread → all CC'd. Forward → new thread with quoted body.
**Depends on:** nothing.

### 2.5 Bump cache ceiling + list virtualization
**PRD:** NFR-PERF-02 (50k emails, <200MB RAM).
**Problem:** `MAX_EMAILS_PER_ACCOUNT = 100`; `InboxPage` renders all threads as DOM nodes.
**Spec:**
- Raise `MAX_EMAILS_PER_ACCOUNT` to 50000; raise `INITIAL_SYNC_LIMIT` to 500 (progressive backfill in background batches).
- Implement windowing on thread list: render only visible + 5 overscan. Use `react-window` (add dep) or a minimal custom `IntersectionObserver`-based window.
- Paginate `list_threads` (already supports `limit`/`offset`) — infinite scroll on thread list.
- Email bodies stay lazy (current behavior is correct).
**Files:** `src-tauri/src/sync/mod.rs` (constants), `src/pages/InboxPage.tsx` (virtualized list), `package.json` (`react-window`).
**Verify:** Sync 5k emails → thread list scrolls at 60fps. Memory profile stays <200MB.
**Depends on:** 1.3 (encrypted DB handles larger volume).

---

## Phase 3 — P2: Robustness

### 3.1 Non-blocking online check
**Problem:** `is_online` (`lib.rs:1046`) uses `reqwest::blocking` inside an `async fn` — blocks the runtime.
**Spec:** Switch to `reqwest::Client` async `.head().send()` with 3s timeout; ping a neutral endpoint (or attempt TCP to each account's IMAP host — more honest signal). Cache result; frontend polls every 30s (current behavior).
**Files:** `src-tauri/src/lib.rs`.
**Verify:** No UI freeze during online check; concurrent AI requests unaffected.

### 3.2 React error boundary
**Problem:** One malformed email body crashes the whole app.
**Spec:** Wrap `InboxPage` + `EmailViewer` in an `ErrorBoundary` component that catches render errors, shows a fallback "Couldn't display this email" + "Report" (local log only, no telemetry) + "Next" button.
**Files:** `src/components/ui/error-boundary.tsx`, `src/App.tsx`, `src/pages/InboxPage.tsx`.
**Verify:** Inject a malformed email → graceful fallback, app stays usable.

### 3.3 Sync error surfacing + per-account health
**Problem:** Failed syncs just log; user has no idea an account is broken.
**Spec:**
- `SyncEngine` returns per-account `Result`; store last error + timestamp in `accounts` (`sync_error TEXT, sync_error_at INTEGER`).
- Frontend shows a warning dot + tooltip on account filter chips with error text + "Retry" button.
- `needs_reauth` (already exists) shown distinctly from transient sync errors.
**Files:** `src-tauri/migrations/009_sync_health.sql`, `src-tauri/src/sync/mod.rs`, `src-tauri/src/lib.rs`, `src/pages/InboxPage.tsx`.
**Verify:** Disconnect network → sync → account chip shows red dot + error. Reconnect + retry → clears.

### 3.4 Fix credential leak in IMAP validation
**Problem:** `validate_imap_connection` (`lib.rs:1054`) stores password at `account_id=0` then deletes — race window.
**Spec:** Validate entirely in-memory: pass credentials directly to a one-shot `ImapConnection::connect_plain_with_password(host, port, encryption, username, password)` that never touches keychain.
**Files:** `src-tauri/src/imap_client/mod.rs` (new method), `src-tauri/src/lib.rs`.
**Verify:** Grep keychain after validation — no `account_0_*` entries.

### 3.5 Input validation on manual IMAP form
**Problem:** No validation on host/port/email.
**Spec:** Frontend validates email format (RFC-ish regex), port range 1–65535, host non-empty. Backend validates on `add_imap_account` — return typed errors.
**Files:** `src/components/onboarding/OnboardingFlow.tsx`, `src-tauri/src/lib.rs`.
**Verify:** Type invalid port → form blocks submit with message.

---

## Phase 5 — P4: Code Quality & Maintainability

Driven by an architecture audit of the two largest files (`lib.rs` 1957 LOC, `InboxPage.tsx` 1610 LOC). Each task is behavior-preserving unless flagged otherwise. Verify with `cargo clippy && cargo check` and `npm run build` after each.

### 5.1 Extract IMAP session helper (lib.rs god-module)
**Problem:** The "load email+account → unwrap Options → branch oauth/plain → connect → select" scaffolding is copy-pasted **7×** in `lib.rs` (mark_read:752-760, archive_email:805-811, delete_email:903-909, fetch_email_body:1515-1521, fetch_thread_bodies:1592-1598, download_attachment:1677-1683, fetch_recent_bodies:1792-1798). Each copy has subtly different error handling (`Ok(())` vs `Ok(0)` vs `.ok_or(...)`).
**Spec:**
- Add `struct ImapContext { account_id, provider_type, imap_host, imap_port, imap_encryption, email_address, imap_uid, folder, thread_id }`.
- `fn load_email_imap_context(email_id) -> Result<ImapContext, String>` collapses the 4 identical email+account JOIN queries (mark_read, archive, delete, download_attachment). `fetch_email_body` keeps its own query (has a `body_html IS NULL` guard) but reuses the connect helper.
- `async fn open_session(cfg) -> Result<ImapSession, String>` collapses the oauth-vs-plain connect branch (the 7 sites).
- Keep each caller's existing Option→ error policy (no behavior change in this task); just route through the helpers.
**Files:** `src-tauri/src/lib.rs` (or new `src-tauri/src/imap_session.rs`).
**Verify:** `cargo clippy` clean; `cargo check`. No new warnings.
**Depends on:** nothing. **Status:** ✅ COMPLETE

### 5.2 Extract row mappers + fix reindex FTS bug
**Problem:** The `Email` row mapper is duplicated verbatim in `get_emails` (544-583) and `get_email` (598-633). Separately, `reindex_account` (680-697) populates the FTS `body_html_stripped` column with `COALESCE(body_text, '')` on both delete and insert — **HTML bodies are never indexed** (bug, breaks FR-UI-05).
**Spec:**
- Extract `fn map_email_row(row: &rusqlite::Row) -> rusqlite::Result<models::Email>` (mirrors `map_send_queue_row` at 1238-1258). Collapse `get_emails`/`get_email`.
- Fix `reindex_account`: strip `<tags>` from `body_html` (reuse a small regex or the existing html-to-text approach) before populating `body_html_stripped`. Fallback to `body_text` when `body_html` is NULL.
**Files:** `src-tauri/src/lib.rs`.
**Verify:** After reindex, search for a word that only appears in an HTML body → result appears.
**Status:** FTS bug ✅ FIXED; row mapper pending.

### 5.3 Quick wins bundle (lib.rs)
- `retry_send_queue_item(queue_id)` (1261-1265): `queue_id` param is dead (`let _ = queue_id`). Honor it (process just that item) or drop from signature + `invoke_handler!`.
- `get_ai_config`/`set_ai_config` (1267-1352): 5 sequential `query_row` + 5 sequential `execute`. Collapse to one `SELECT key, value FROM app_settings WHERE key IN (...)` and one transactional upsert.
- `.filter_map(|r| r.ok())` appears 10× in lib.rs (167, 194, 525, 582, 674, 1156, 1223, 1550, 1783) — swallows row-map errors silently. Switch to `.filter_map(|r| r.map_err(|e| log::warn!("row map: {e}")).ok())`.
- `remove_account` (428-439): deletes `accounts` row + keychain only; orphans `emails`/`threads`/`folders`/`folder_sync_state`/`send_queue`. Add `DELETE FROM ... WHERE account_id = ?` for each (FK cascade is declared but rusqlite needs `PRAGMA foreign_keys=ON`; explicit deletes are safer).
**Files:** `src-tauri/src/lib.rs`.
**Status:** ✅ COMPLETE (filter_map logging, ai_config batching, retry_queue param, remove_account cleanup)

### 5.4 Split InboxPage god-component
**Problem:** `InboxPage.tsx` (1610 LOC, 30+ `useState`) mixes UI + IPC + state orchestration + business logic + keyboard shortcuts. Race: `handleSelectThread` (635-671) has no request cancellation → fast clicks show thread A's emails under thread B. `handleArchive`/`handleDelete` (714-756) swallow backend errors yet remove the email from local state (reappears on next sync).
**Spec:**
- Extract `useThreads`, `useEmailSelection`, `useAiStream`, `useKeyboardShortcuts` hooks + `<InboxSidebar>`, `<ReadingPane>`, `<AiRail>` components. Target: `InboxPage` body ~200 LOC.
- Add a request token to `handleSelectThread` so stale `getEmails`/`fetchThreadBodies` results are discarded.
- Make `handleArchive`/`handleDelete` surface errors via `statusMessage` and only mutate local state on success.
**Files:** `src/pages/InboxPage.tsx`, new `src/hooks/`, new `src/components/inbox/`.
**Status:** pending (large; defer until 5.1-5.3 land).

### 5.5 Unify InlineReplyEditor + ComposeEditor
**Problem:** `InlineReplyEditor` (InboxPage:132-331) and `ComposeEditor.tsx` (329 LOC) duplicate the tiptap setup, To/Cc/Subject inputs, `AiInlineToolbar` integration. `ComposeEditor.tsx:100` sends attachments as `number[]` over IPC (10MB → 10M-element array).
**Spec:** Extract `<Composer mode="inline"|"compose">`. Fix attachment IPC to use a typed array or base64.
**Files:** `src/components/email/Composer.tsx` (new), `ComposeEditor.tsx`, `InboxPage.tsx`.
**Status:** pending.

### 5.6 Duplicate `formatDate` + misc frontend dedup
- `formatDate` duplicated in `InboxPage.tsx:51` and `EmailViewer.tsx:70` with *different* formats → extract to `src/lib/format.ts`.
- `Re:`/`Fwd:` subject-prefix logic duplicated 3× (InboxPage:761, 802, 1016 + forward) → extract to `src/lib/quote.ts` (already has `buildReplyQuoteBody`).
- `handleArchive`/`handleDelete` busy-set dance repeated 8× → `useBusySet()` hook.
**Files:** `src/lib/format.ts` (new), `src/lib/quote.ts`, `InboxPage.tsx`, `EmailViewer.tsx`.
**Status:** pending.

---

## Phase 4 — P3: 2026 UX Differentiators

### 4.1 Command palette (⌘K)
**Spec:** Global ⌘K opens a palette: fuzzy-search threads (by subject/sender), accounts, actions (compose, sync, settings, archive selected, mark all read). Keyboard-only nav. Pattern: Raycast/Superhuman.
**Files:** `src/components/ui/command-palette.tsx`, `src/App.tsx`, `src/lib/api.ts`.
**Verify:** ⌘K → type "set" → Enter → Settings. Type sender name → Enter → opens thread.
**Depends on:** 2.5 (virtualized list helps scale search).
**Status:** ✅ COMPLETE — palette renders globally via `InboxPage` (always-mounted) + portal; fuzzy matcher in `src/lib/fuzzy.ts`; thread search reuses `search_emails` FTS (matches subject/from/to/body); actions wired (compose/sync/settings/mark-all-read/archive-selected); added backend `mark_all_read` command for bulk local read-state.

### 4.2 Undo send (5–10s grace window) ✅ COMPLETE
**Spec:** On send, hold in `send_queue` with `status = 'sending'` + `send_after = now + 8s`. Show a toast "Sent — Undo" for 8s. If undone, move to drafts. Otherwise process queue.
**Implementation:**
- Migration `013_undo_send.sql` recreates `send_queue` with a relaxed status CHECK (`pending`,`sending`,`sent`,`failed`,`draft`) — also fixes a latent bug where the Phase-2.3 `save_draft` path inserted `status='draft'` in violation of the original `001` CHECK. Adds `send_after`, `in_reply_to`, `references` columns + indexes.
- `ComposeService::queue_email` now takes `defer_seconds: Option<i64>` and returns the queue id; `Some(n)` → `status='sending'` + `send_after = now + n`, `None` → `status='pending'` (existing offline path).
- `ComposeService::process_queue` picks up both `pending` and due `sending` items (`send_after IS NULL OR send_after <= now`).
- `process_queue_item` now persists + replays `in_reply_to`/`references` (previously dropped by `queue_email`), and on success inserts the local Sent copy + rebuilds threads (previously skipped for queued/offline sends).
- New `cancel_send(queue_id)` Tauri command flips a `sending` item to `draft`.
- Poll loop calls `process_queue()` each cycle as a backstop so deferred sends fire even if the frontend is closed.
- Frontend (`InboxPage`): online send queues with `deferSeconds: 8`, closes the composer, and shows a fixed bottom toast "Sending … — Undo" for 8s. Undo → `cancelSend` (message saved to Drafts). Timer expiry → `processSendQueue`. Sending a second email commits any in-flight undo window first.
**Files:** `src-tauri/migrations/013_undo_send.sql`, `src-tauri/src/db/mod.rs`, `src-tauri/src/compose/mod.rs`, `src-tauri/src/lib.rs`, `src/lib/api.ts`, `src/pages/InboxPage.tsx`.
**Verify:** `cargo test` (20 passed, incl. new `migration_013_allows_draft_and_sending_status_and_adds_send_after`) + `cargo clippy` clean + `npm run build`/`tsc` clean. Manual: send an email → toast appears → click Undo within 8s → message lands in Drafts; otherwise it sends and appears in Sent.
**Depends on:** 2.3 (drafts). **Unblocks:** 4.3 (same queue + `send_after` infra).

### 4.3 Schedule send ✅ COMPLETE
**Spec:** Compose has "Send later" → datetime picker. Queue with `send_after = <ts>`. Background poller (1min) sends when due.
**Implementation:**
- Backend infra was already complete from 4.2: `queue_email` accepts `defer_seconds: Option<i64>` → `send_after = now + secs` (status `sending`); `process_queue` only sends items where `send_after IS NULL OR send_after <= now`; the 60s poll loop calls `process_queue()` each cycle as a backstop. So scheduling a future send needs no new backend logic — just a larger `defer_seconds`.
- Exposed `send_after: Option<i64>` on `SendQueueItem` (model + `get_send_queue`/`list_drafts` SELECTs + `map_send_queue_row`) so the UI can show when a scheduled send fires. Frontend `SendQueueItem` type gained `send_after`; also fixed latent `SendStatus` type to include `sending`/`draft` (added by 4.2 but never reflected in the TS type).
- `ComposeEditor`: "Send later" button (Clock icon) in the footer toolbar opens a popover with a native `<input type="datetime-local">` (min = now+30s) plus quick presets (In 1 hour, Tonight 8pm, Tomorrow 9am, Mon 9am). Confirming calls `onSend` with a new optional `sendAt` (ms epoch).
- `InboxPage.handleSend`: when `params.sendAt` is set, computes `deferSeconds = (sendAt - now)/1000` and queues via `queueEmail` (skipping the 8s undo window), then shows a fixed-bottom "scheduled for <time> — Cancel" toast (10s). Cancel calls the existing `cancel_send` command (flips `sending`→`draft`, saved to Drafts).
- `SendQueuePanel` (Outbox): items with `status='sending'` + future `send_after` render as "scheduled" with the formatted time + a per-row Cancel button. The Outbox badge now counts pending + scheduled sends (30s threshold excludes the 8s undo-window items), so scheduled sends remain reachable for cancellation after the toast dismisses.
- Dedicated "Scheduled" view: a "Scheduled" nav entry in the sidebar (Clock icon + count badge) opens a full-page `ScheduledView` in the reading pane, showing all scheduled sends sorted by send time with recipient, subject, body preview, formatted due time, account, and per-row Cancel. Selecting a thread, folder, account, or Compose resets to inbox view.
- **Draft management (commit `fb2e9d7`):** Outbox badge now counts drafts (not just pending+scheduled); `ComposeEditor` gains `onDraftSaved` callback so the badge appears within 3s of autosave. Draft + scheduled rows in the Outbox panel and Scheduled view are click-to-edit — reopening a draft restores to/cc/bcc/subject/body and the `draftId` (autosave updates in place, send deletes it — no duplicates); reopening a scheduled send cancels the pending send (→ draft) and pre-fills the schedule time. Draft rows have a trash-icon delete button; `onQueueChange` refreshes the badge immediately after delete/cancel/retry.
**Files:** `src-tauri/src/commands/models.rs`, `src-tauri/src/lib.rs`, `src/components/email/ComposeEditor.tsx`, `src/pages/InboxPage.tsx`, `src/types/index.ts`.
**Verify:** `cargo test` (20 passed) + `cargo clippy` (no new warnings) + `npm run build`/`tsc` clean. Manual: Compose → "Send later" → pick a time → toast "scheduled for …" → cancel returns it to Drafts; otherwise the 60s poller sends when due and it lands in Sent.
**Depends on:** 4.2 (same queue + `send_after` infra).

### 4.4 Snooze + follow-up reminders
**Spec:** Snooze thread to datetime → hide from inbox → resurface at time. Follow-up nudge: if no reply in thread after N days, surface reminder. All local, no server side.
**Files:** `src-tauri/migrations/010_snooze.sql`, `src-tauri/src/lib.rs`, new `src-tauri/src/reminders/mod.rs`, `src/pages/InboxPage.tsx`.
**Depends on:** 1.1 (background loop to fire reminders).

### 4.5 Recipient autocomplete
**Spec:** Build local contact index from cached `from_json`/`to_json` across all emails. Compose `to`/`cc`/`bcc` fields show fuzzy suggestions.
**Files:** `src-tauri/migrations/011_contacts.sql`, `src-tauri/src/lib.rs` (`search_contacts`), `src/components/email/ComposeEditor.tsx`.

### 4.6 Smart bundles / grouping
**Spec:** Auto-classify threads into bundles (Newsletters, Notifications, Receipts, Personal) via lightweight sender heuristics (no AI needed). Collapsible bundle sections in inbox.
**Files:** `src-tauri/src/lib.rs` (classification on sync), `src/pages/InboxPage.tsx`.

### 4.7 Per-account settings
**Spec:** Settings page → per-account: display name, signature (HTML), default identity, sync enable/disable, send-from alias.
**Files:** `src/pages/SettingsPage.tsx`, `src-tauri/migrations/012_account_settings.sql`, `src-tauri/src/lib.rs`.

### 4.8 Live theme sync
**Problem:** Theme only checks OS preference on mount.
**Spec:** `matchMedia('(prefers-color-scheme: dark)')` listener updates theme live.
**Files:** `src/App.tsx`.
**Verify:** Toggle OS theme → app updates instantly.

### 4.9 AI summary → email workflow integration
**Problem:** `AiSummaryPanel` only exposes `onDismiss`/`onRetry`. A generated summary is a dead end — the user must manually copy-paste it into a compose window. The summary is also never reused as context for downstream AI actions (e.g. drafting a reply that accounts for the summary).
**Spec:**
Four actions on the summary panel, shown as a button row beneath the summary text when `summary` is non-empty and `!loading`:
1. **Forward summary** — `Fwd:` framing with the AI summary on top and the original (last) thread email quoted below. Opens the full `ComposeEditor` (not inline) with blank recipients.
2. **Send as new** — Fresh email with the summary as the body, subject `Summary: <thread subject>`, blank recipients, no threading headers.
3. **Reply with summary** — Drafts an AI reply in the inline reply editor, passing the existing summary to the backend as extra context so the reply can reference it.
4. **Copy** — `navigator.clipboard.writeText(summary)` with a transient "Copied!" state.
**Files:**
- `src/components/ai/AiSummaryPanel.tsx` — add optional props `onForwardSummary?`, `onSendAsNew?`, `onCopySummary?`, `onReplyWithSummary?`; render action row beneath summary text.
- `src/lib/aiUi.ts` — extend `AiPanelLabels` with `forwardSummary`, `sendAsNew`, `replyWithSummary`, `copy`, `copied` (de/en/no).
- `src/pages/InboxPage.tsx` — add `handleForwardSummary`, `handleSendSummaryAsNew`, `handleCopySummary`, `handleDraftReplyWithSummary`; wire into `<AiSummaryPanel>` render.
- `src/lib/api.ts` — `streamDraftReply` gains optional `summary?: string` arg.
- `src-tauri/src/ai/mod.rs` — `stream_draft_reply` + `build_reply_prompt` accept `summary: Option<&str>`; when `Some` and non-empty, inject before thread text in the user message.
- `src-tauri/src/lib.rs` — `stream_draft_reply` Tauri command gains `summary: Option<String>`.
**Verify:** Generate a summary → each of the 4 buttons works (forward opens compose with summary + quote; send-as-new opens compose with summary only; reply-with-summary drafts a reply that references the summary; copy writes to clipboard). `cargo check` + `npx tsc --noEmit` clean.
**Depends on:** nothing (builds on existing summarize + compose machinery).

---

## Release Readiness

**Verdict: v1 is shippable now.** All P0 (ship-blockers), P1 (MVP completeness), and P2 (robustness) are complete. The app delivers on its core promise: encrypted-at-rest local mail, background polling, notifications, FTS search, OAuth + IMAP, attachments, folders, drafts, reply-all/forward, undo send, schedule send, command palette, AI summarize/reply, and a virtualized inbox.

### Pre-release fixes (should do before tagging)
These are latent bugs found in the audit — small, targeted, user-facing correctness:
- **`mark_read` swallows IMAP errors** — read state can drift out of sync with the server silently (tracked in 5.4).
- **`handleArchive`/`handleDelete` swallow backend errors** — local state is mutated optimistically even on failure, so a failed archive/delete reappears on next sync (tracked in 5.4).

### Nice-to-have (can ship without; queue for v1.1)
P3 UX differentiators and P4 code-quality refactors. None block a v1 release:
- **4.4** Snooze + follow-up reminders
- **4.5** Recipient autocomplete
- **4.6** Smart bundles / grouping
- **4.7** Per-account settings (signature, display name, aliases)
- **4.8** Live theme sync
- **5.4–5.6** Split InboxPage god-component, unify composer, dedup helpers

### Suggested v1.1 priority
1. 5.4 (split InboxPage) — unblocks faster iteration on the remaining P3 items; fixes the two latent bugs.
2. 4.5 (autocomplete) + 4.7 (per-account settings) — highest user-value P3 items.
3. 4.8 (live theme) — trivial, quick win.
4. 4.4 (snooze) + 4.6 (bundles) — deeper UX polish.

---

## Dependency Graph

```
1.3 SQLCipher ─┬─► 1.1 Poll loop ─┬─► 1.2 Notifications ✅
               │                  ├─► 2.2 Folders ─► 2.3 Drafts ─► 4.2 Undo send ✅ ─► 4.3 Schedule ✅
               │                  └─► 4.4 Snooze/reminders
1.4 FTS fix ─────────────────────► ✅ (independent)
1.5 CI signing ───────────────────► ✅ (parallel infra)
2.1 Attachments ──────────────────► (independent)
2.4 Reply-all/forward ───────────► (independent)
2.5 Cache + virtualize ───────────► 4.1 Command palette
3.x Robustness ───────────────────► (independent, do anytime)
```

**Critical path:** 1.3 → 1.1 → 1.2 ✅ (privacy + mail arrives + notified). Everything else parallelizes.

---

## Agent Execution Protocol

When picking up a task:
1. **Read the spec** above + re-read the linked files (line numbers may have shifted).
2. **Check dependencies** — don't start 1.1 before 1.3 merges.
3. **Write code** following existing conventions (no comments, conventional commits).
4. **Verify locally:** `cd src-tauri && cargo test && cargo clippy`; `npm run build`; manual smoke test if possible.
5. **Commit** with `feat:`/`fix:`/`security:` + task ID, e.g. `security: encrypt SQLite at rest with SQLCipher (1.3)`.
6. **Update this file** — mark the task ✅ done with commit hash.

## Status

- [x] 1.1 Background polling
- [x] 1.2 Notifications
- [x] 1.3 SQLCipher
- [x] 1.4 FTS fix
- [x] 1.5 CI signing
- [x] 2.1 Attachments
- [x] 2.2 Folders
- [x] 2.3 Drafts
- [x] 2.4 Reply-all/forward
- [x] 2.5 Cache + virtualize
- [x] 3.1 Non-blocking online
- [x] 3.2 Error boundary
- [x] 3.3 Sync health
- [x] 3.4 IMAP validation leak
- [x] 3.5 Input validation
- [x] 4.1 Command palette
- [x] 4.2 Undo send
- [x] 4.3 Schedule send
- [ ] 4.4 Snooze/reminders
- [ ] 4.5 Autocomplete
- [ ] 4.6 Smart bundles
- [ ] 4.7 Per-account settings
- [ ] 4.8 Live theme sync
- [x] 4.9 AI summary → email workflow integration

## Phase 5 — Code Quality
- [x] 5.1 IMAP session helper (lib.rs)
- [x] 5.2 Row mappers + FTS bug fix (migration 012: strip_html SQL fn; regression test added)
- [x] 5.3 Quick wins (filter_map logging, ai_config batching, retry_queue param, remove_account cleanup)
- [ ] 5.4 Split InboxPage god-component
- [ ] 5.5 Unify InlineReplyEditor + ComposeEditor
- [ ] 5.6 formatDate dedup + frontend quick wins
