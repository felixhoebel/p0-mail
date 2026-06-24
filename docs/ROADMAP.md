# p0mail Integration Plan & Roadmap

> **Purpose.** Self-contained workstream specs for autonomous agents. Each task lists what to build, which files to touch, dependencies, and how to verify. Pick a phase → pick a task → execute end-to-end.

**Current state:** Phase 1 (P0) complete — DB encrypted at rest (SQLCipher), background polling with 60s jitter, new-mail desktop notifications, FTS5 search fixed (indexes body_text, returns threads), CI wired for macOS notarization + Windows EV signing. OAuth + IMAP + AI streaming working. Remaining: no attachments, no drafts, single-folder sync, no virtualization.

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

## Phase 4 — P3: 2026 UX Differentiators

### 4.1 Command palette (⌘K)
**Spec:** Global ⌘K opens a palette: fuzzy-search threads (by subject/sender), accounts, actions (compose, sync, settings, archive selected, mark all read). Keyboard-only nav. Pattern: Raycast/Superhuman.
**Files:** `src/components/ui/command-palette.tsx`, `src/App.tsx`, `src/lib/api.ts`.
**Verify:** ⌘K → type "set" → Enter → Settings. Type sender name → Enter → opens thread.
**Depends on:** 2.5 (virtualized list helps scale search).

### 4.2 Undo send (5–10s grace window)
**Spec:** On send, hold in `send_queue` with `status = 'sending'` + `send_after = now + 8s`. Show a toast "Sent — Undo" for 8s. If undone, move to drafts. Otherwise process queue.
**Files:** `src-tauri/src/compose/mod.rs`, `src-tauri/src/lib.rs`, `src/pages/InboxPage.tsx` (toast).
**Depends on:** 2.3 (drafts).

### 4.3 Schedule send
**Spec:** Compose has "Send later" → datetime picker. Queue with `send_after = <ts>`. Background poller (1min) sends when due.
**Files:** `src-tauri/src/compose/mod.rs`, `src-tauri/migrations` (`send_queue.send_after INTEGER`), `src/components/email/ComposeEditor.tsx`.
**Depends on:** 4.2 (same queue infra).

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

---

## Dependency Graph

```
1.3 SQLCipher ─┬─► 1.1 Poll loop ─┬─► 1.2 Notifications ✅
               │                  ├─► 2.2 Folders ─► 2.3 Drafts ─► 4.2 Undo send ─► 4.3 Schedule
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
- [ ] 2.1 Attachments
- [ ] 2.2 Folders
- [ ] 2.3 Drafts
- [ ] 2.4 Reply-all/forward
- [ ] 2.5 Cache + virtualize
- [ ] 3.1 Non-blocking online
- [ ] 3.2 Error boundary
- [ ] 3.3 Sync health
- [ ] 3.4 IMAP validation leak
- [ ] 3.5 Input validation
- [ ] 4.1 Command palette
- [ ] 4.2 Undo send
- [ ] 4.3 Schedule send
- [ ] 4.4 Snooze/reminders
- [ ] 4.5 Autocomplete
- [ ] 4.6 Smart bundles
- [ ] 4.7 Per-account settings
- [ ] 4.8 Live theme sync
