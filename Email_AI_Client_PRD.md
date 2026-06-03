# Product Requirement Document (PRD)
## AI-Native Desktop Email Client (MVP)
**Codename:** p0Mail MVP  
**Version:** 1.0  
**Date:** 2025-06-10  
**Status:** Requirements Clarified — Ready for Implementation  

---

## 1. Executive Summary
p0Mail MVP is a lightweight, cross-platform desktop email client for macOS and Windows. It prioritizes a dead-simple onboarding experience via OAuth 2.0 (Google, Microsoft) and manual IMAP/SMTP configuration, unifies all accounts into a single conversation-threaded inbox, and introduces user-controlled AI augmentation through any OpenAI-compatible API endpoint.

The product is offline-first: all mail is cached locally in SQLite with FTS5 full-text search, credentials are bound to the OS-native keychain, and a robust send queue guarantees that no draft is lost on disconnect. No telemetry, no bundled LLM inference, and no server-side infrastructure are required.

**Key Value Proposition:** A private, fast, AI-augmented email desk that takes under 60 seconds to set up.

---

## 2. Goals & Non-Goals

### 2.1 Goals (Must Deliver in v1.0)
| ID | Goal |
|----|------|
| G-01 | Provide a unified, threaded inbox for Google (OAuth), Microsoft (OAuth), and generic IMAP/SMTP accounts. |
| G-02 | Enable one-click OAuth onboarding and an optional guided manual IMAP setup. |
| G-03 | Deliver full mail lifecycle: read, compose (rich text/HTML), send, reply, reply-all, forward, archive, delete, mark read/unread. |
| G-04 | Support file attachments in compose. |
| G-05 | Operate offline with full read access to cached mail and a reconnect-send queue for drafts. |
| G-06 | Offer AI-generated per-thread summaries (3–5 bullets) and one-click AI reply drafting via any user-supplied OpenAI-compatible endpoint. |
| G-07 | Keep the package lightweight: installer < 30 MB, idle RAM < 200 MB. |
| G-08 | Guarantee absolute privacy: zero telemetry, zero crash reporting, credentials stored exclusively in OS-native secure storage. |

### 2.2 Non-Goals (Explicitly Out of Scope)
| ID | Non-Goal |
|----|----------|
| NG-01 | Bundled or local LLM inference (Ollama, LM Studio, llama.cpp). |
| NG-02 | Push/real-time webhook sync (IMAP IDLE is not required). |
| NG-03 | Google Workspace / Microsoft 365 shared mailboxes; distribution lists; delegated access. |
| NG-04 | Calendar, contacts, tasks, or notes modules. |
| NG-05 | Server-side mail rules/filters, server-side label synchronization (beyond read/unread and archive), or server-side folder management. |
| NG-06 | Spam training, spam folder management, or phishing detection heuristics. |
| NG-07 | Mobile app or web-browser client. |
| NG-08 | Built-in AI billing, metering, or subscription management. |
| NG-09 | Third-party telemetry, analytics, or crash-reporting services. |

---

## 3. Stakeholder & Target Audience

### 3.1 Stakeholders
| Stakeholder | Interest |
|-------------|----------|
| Product Owner | Define AI tone, UX priority, and MVP scope gate. |
| Lead Architect (Rust/React) | Own sync engine stability, offline model, and Tauri IPC contracts. |
| Security Reviewer | Verify keychain isolation, SQLCipher at-rest encryption, and HTML sanitization. |
| End Users | Day-to-day email productivity and privacy. |

### 3.2 Target Audience
- **Primary:** Privacy-aware freelancers, developers, and consultants who use 2–4 personal email accounts (Gmail, Outlook.com, custom-domain IMAP) and want a distraction-free desktop client.
- **Secondary:** Small-business owners seeking an offline-capable mail desk with optional AI assistance under their own API keys.

---

## 4. User Stories & Acceptance Criteria

### US-01: OAuth Onboarding
> **As a** new user,  
> **I want to** add my Gmail or Outlook.com account with a single OAuth consent click,  
> **so that** I can start reading mail without typing server settings.

**Acceptance Criteria (GIVEN-WHEN-THEN):**
- **GIVEN** the user clicks “Add Account” and selects Google/Microsoft  
  **WHEN** they complete the OAuth 2.0 consent flow  
  **THEN** the app stores the access and refresh tokens in the OS keychain and displays the unified inbox within 10 seconds.
- **GIVEN** an OAuth token expires  
  **WHEN** the sync engine attempts a poll cycle  
  **THEN** the app silently refreshes the token without user interaction.

### US-02: Manual IMAP Setup
> **As a** user with a custom-domain email,  
> **I want to** enter my IMAP/SMTP server details,  
> **so that** I can use the client with any standards-compliant provider.

**Acceptance Criteria:**
- **GIVEN** the user selects “Manual IMAP Setup”  
  **WHEN** they provide host, port, encryption (SSL/TLS or STARTTLS), username, and password  
  **THEN** the app validates the connection, stores the password in the OS keychain, and starts syncing INBOX.

### US-03: Unified Inbox Browsing
> **As a** multi-account user,  
> **I want to** see all new mail from all accounts in one sorted list,  
> **so that** I don't switch windows to check each address.

**Acceptance Criteria:**
- **GIVEN** two or more accounts are active  
  **WHEN** the user opens the app  
  **THEN** the default view shows a unified inbox sorted by the most recent message date across all accounts.
- **GIVEN** the user clicks an account filter  
  **WHEN** the filter is applied  
  **THEN** only threads for that account are displayed.

### US-04: Threaded Conversation View
> **As a** user,  
> **I want to** read emails grouped by conversation thread,  
> **so that** context is preserved and I can follow long discussions easily.

**Acceptance Criteria:**
- **GIVEN** a thread containing 5 messages  
  **WHEN** the user opens the thread  
  **THEN** messages are displayed chronologically with sender, date, and quoted sections collapsed.
- **GIVEN** a thread contains new unread messages  
  **WHEN** viewed  
  **THEN** unread messages are visually distinguished and the thread is marked read after 3 seconds of viewing.

### US-05: Compose & Send with Attachments
> **As a** user,  
> **I want to** write a rich-text email and attach files,  
> **so that** I can communicate professionally without a browser.

**Acceptance Criteria:**
- **GIVEN** the user clicks “Compose”  
  **WHEN** they enter recipient, subject, rich-text body, and attach 1–5 files  
  **THEN** the email is sent via the selected account’s SMTP server and appears in the thread Sent view.

### US-06: Offline Draft Queue
> **As a** user on an unstable connection,  
> **I want to** write emails while offline,  
> **so that** they are sent automatically when I reconnect.

**Acceptance Criteria:**
- **GIVEN** the app detects no network reachability  
  **WHEN** the user clicks “Send”  
  **THEN** the draft enters a local `send_queue` table with status `pending`.
- **GIVEN** the network returns  
  **WHEN** connectivity is restored  
  **THEN** the queue auto-processes pending drafts via exponential backoff retry.

### US-07: Full-Text Search
> **As a** user,  
> **I want to** search my mail instantly,  
> **so that** I can find old conversations without scrolling.

**Acceptance Criteria:**
- **GIVEN** 50,000 locally cached emails  
  **WHEN** the user types a keyword in the search bar  
  **THEN** results populate in < 500 ms, ranked by recency, with highlighted subject and snippet.

### US-08: Configure AI Endpoint
> **As a** privacy-minded power user,  
> **I want to** plug in my own OpenAI-compatible API key, URL, and model,  
> **so that** AI features work under my control.

**Acceptance Criteria:**
- **GIVEN** the user navigates to Settings > AI  
  **WHEN** they enter `base_url`, `api_key`, and `model`  
  **THEN** the app validates the connection with a lightweight `/models` or dummy completion call and persists credentials securely.

### US-09: Thread Summary
> **As a** user,  
> **I want to** generate a bulleted summary of a long email thread,  
> **so that** I grasp the key points in seconds.

**Acceptance Criteria:**
- **GIVEN** an AI endpoint is configured and the app is online  
  **WHEN** the user clicks “Summarize Thread” and selects a tone (Professional / Friendly / Concise)  
  **THEN** the LLM returns 3–5 bullet points in the detected language of the latest received email, displayed in a side panel.

### US-10: AI Reply Draft
> **As a** user,  
> **I want to** auto-generate a reply draft,  
> **so that** I can respond faster without staring at a blank page.

**Acceptance Criteria:**
- **GIVEN** a thread is open and an AI endpoint is configured  
  **WHEN** the user clicks “Draft Reply” and picks a tone  
  **THEN** a complete reply (salutation, body, signature placeholder) is injected into the compose editor for review and editing before send.

---

## 5. Functional Requirements

### 5.1 Account Management & Authentication
| ID | Requirement |
|----|-------------|
| FR-ACC-01 | The app shall support an unlimited number of account profiles. |
| FR-ACC-02 | For **Google** and **Microsoft** accounts, the app shall execute an OAuth 2.0 installed-app flow (loopback redirect or custom URI scheme) to obtain `access_token` and `refresh_token`. |
| FR-ACC-03 | Tokens obtained via OAuth shall be used for IMAP/SMTP authentication through the **XOAUTH2** SASL mechanism; no proprietary REST API sync engine is required. |
| FR-ACC-04 | For generic providers, the app shall expose a manual configuration panel: IMAP host, IMAP port, SMTP host, SMTP port, encryption type (`SSL/TLS` or `STARTTLS`), username, and password. |
| FR-ACC-05 | All credentials (passwords, tokens, AI API keys) shall be stored exclusively via the OS-native credential store (macOS Keychain, Windows Credential Manager). |
| FR-ACC-06 | The app shall store per-account sync state (`last_seen_uid`, `highestmodseq` if supported) to enable incremental polling. |

### 5.2 Mail Sync Engine
| ID | Requirement |
|----|-------------|
| FR-SYNC-01 | The sync engine shall connect to each account's IMAP INBOX via TLS. |
| FR-SYNC-02 | Polling interval shall default to **60 seconds** with a random jitter of ±10 seconds per cycle to avoid thundering herd. |
| FR-SYNC-03 | The initial sync shall fetch message headers and envelope data first; message bodies and attachments shall be fetched on-demand or progressively in background batches. |
| FR-SYNC-04 | The local cache shall retain up to **50,000 emails per account**. When the ceiling is reached, the oldest messages by internal IMAP date are purged locally but remain untouched on the server. |
| FR-SYNC-05 | Flag synchronization is bidirectional for `\Seen`; mapping: mark read/unread toggles the `\Seen` flag. |
| FR-SYNC-06 | **Archive** action for Gmail moves the thread out of INBOX (removes label); for generic IMAP, it moves the message to a server folder named `Archive`, creating the folder if absent. |
| FR-SYNC-07 | **Delete** action moves the message to the server `Trash` folder. |

### 5.3 Threading, UI & Search
| ID | Requirement |
|----|-------------|
| FR-UI-01 | Threading shall be performed via `Message-ID`, `In-Reply-To`, and `References` headers (JWZ-style), not by subject line alone. |
| FR-UI-02 | The unified inbox shall sort threads by the timestamp of the latest message in each thread, descending. |
| FR-UI-03 | An account filter shall toggle the view to a single account without disconnecting others. |
| FR-UI-04 | HTML email rendering shall be sandboxed and sanitized (e.g., DOMPurify) to prevent script execution; external images are blocked by default and loaded only on explicit user opt-in per sender. |
| FR-UI-05 | Full-text search shall use **SQLite FTS5** spanning `subject`, `from_address`, `to_address`, `body_text`, and `body_html` (stripped). |
| FR-UI-06 | Search results shall return in < 500 ms for the defined cache ceiling. |

### 5.4 Compose, Send & Offline Queue
| ID | Requirement |
|----|-------------|
| FR-CMP-01 | The compose surface shall be a rich-text editor (e.g., Tiptap) producing both HTML MIME part and a plain-text fallback. |
| FR-CMP-02 | The user may add/remove CC and BCC fields per compose window. |
| FR-CMP-03 | Attachments up to 25 MB total per compose shall be encoded and sent as MIME multipart. |
| FR-CMP-04 | When offline, clicking “Send” persists the message to a local `send_queue` with status `pending`, `retry_count = 0`, and a timestamp. |
| FR-CMP-05 | On connectivity restoration, the queue processor shall attempt delivery via SMTP with exponential backoff (2^n seconds, capped at 5 minutes). After 5 failures, status changes to `failed` and the user is notified. |
| FR-CMP-06 | Replies and forwards shall pre-populate the compose editor with the correct `In-Reply-To` / `References` headers and quoted context trimmed to last 3 levels to prevent ballooning. |

### 5.5 AI Integration
| ID | Requirement |
|----|-------------|
| FR-AI-01 | The app shall expose exactly one AI configuration profile: `base_url`, `api_key`, `model`. These are stored in secure storage. |
| FR-AI-02 | If the app is offline or the AI profile is incomplete, all AI buttons are disabled. |
| FR-AI-03 | **Thread Summary** shall construct a prompt containing the last N messages of the thread truncated to fit within the model’s context window (safe limit: 80% of 128k tokens for common models; fallback truncation by character count if token counter unavailable). |
| FR-AI-04 | The summary prompt shall instruct the model to return exactly 3–5 bullet points, in the same language as the latest incoming email, matching the selected user tone (Professional, Friendly, Concise). |
| FR-AI-05 | **AI Reply Draft** shall construct a prompt containing the full visible thread context and the instruction: “Draft a complete reply email as the user. Match the language of the conversation. Tone: [selected]. Do not hallucinate facts not present in the thread.” |
| FR-AI-06 | The generated reply shall be injected into the compose editor as editable HTML; the user must explicitly click Send. No automatic sending is permitted. |
| FR-AI-07 | The app shall call the standard OpenAI Chat Completions endpoint: `POST {base_url}/v1/chat/completions` with headers `Authorization: Bearer {api_key}` and JSON body. Temperature capped at `0.3`; `max_tokens` capped at `1024` for summaries and `2048` for replies. |

### 5.6 Notifications
| ID | Requirement |
|----|-------------|
| FR-NTF-01 | When the app is backgrounded or focused, new mail detected during a poll cycle shall surface a native OS notification containing sender and subject. |
| FR-NTF-02 | Clicking the notification shall foreground the app and open the relevant thread. |
| FR-NTF-03 | Notifications are silenced per OS Do-Not-Disturb state; no custom notification logic is required. |

---

## 6. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-PERF-01 | Performance | Installer artifact < 30 MB per platform. |
| NFR-PERF-02 | Performance | Idle RAM usage < 200 MB with 3 active accounts and 50,000 cached emails. |
| NFR-PERF-03 | Performance | Cold startup to interactive unified inbox < 3 seconds on a modern SSD-equipped machine (8 GB RAM, quad-core). |
| NFR-Sec-01 | Security | Credential storage delegated to OS-native keychain/credential manager; no plaintext secrets in SQLite or logs. |
| NFR-Sec-02 | Security | Local SQLite database encrypted at rest using **SQLCipher** (AES-256) with a key derived from the OS user session or Tauri Stronghold. |
| NFR-Sec-03 | Security | Zero outbound telemetry, analytics, or diagnostic data. |
| NFR-Sec-04 | Security | All HTML rendered in the reading pane is sanitized to remove `<script>`, `javascript:` URIs, and event handlers before DOM insertion. |
| NFR-AVA-01 | Availability | 100% read availability for cached content when offline. |
| NFR-AVA-02 | Availability | Send queue survives app restart; persistence via SQLite only. |
| NFR-UX-01 | Usability | First-time user completes OAuth onboarding and lands in the unified inbox in < 60 seconds (measured from first launch). |
| NFR-CMP-01 | Compatibility | Ship native binaries for **macOS** (Intel + Apple Silicon universal or separate builds) and **Windows** (x64). |
| NFR-DEP-01 | Deployment | Distributed as direct-download `.dmg` (macOS) and `.exe` installer (Windows), notarized on macOS but outside the Mac App Store to avoid OAuth sandbox restrictions. |

---

## 7. Technical Architecture & Stack

### 7.1 Stack Selection
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Desktop Shell | **Tauri v2** (Rust) | Minimal bundle size (< 30 MB target), direct access to native APIs (notifications, keychain), memory-efficient compared to Electron. |
| Frontend UI | **React 18+** + TypeScript | Ecosystem maturity; componentized UI for inbox, threads, and compose. |
| Styling | **Tailwind CSS** + Headless UI / Radix Primitives | Small CSS footprint, accessible primitives, no heavy component library bloat. |
| Rich Text Editor | **Tiptap** (ProseMirror) | Lightweight, outputs HTML + plain text, extendable with mention/attachment nodes. |
| Email Protocols | IMAP4rev1, SMTP, XOAUTH2 (Rust) | Single sync paradigm for all account types; `async-imap` + `lettre` crates. |
| Local Database | **SQLite** with **FTS5** enabled | Single-file, zero-config, proven full-text search, works offline. |
| DB Binding | `rusqlite` + `libsqlite3-sys` with bundled FTS5 | Native Rust integration; compile with FTS5 feature flag. |
| Secure Storage | `keyring-rs` (cross-platform keychain) or Tauri `stronghold` plugin | OS-native secret storage abstraction. |
| HTTP / AI Client | `reqwest` (Rust) | Used from the Rust layer to keep API keys out of the frontend process and avoid CORS issues. |
| HTML Sanitization | `ammonia` (Rust) or DOMPurify (frontend) | Defense-in-depth against malicious HTML emails. |
| Packaging | Tauri Bundler (`.dmg`, `.exe` via NSIS) | Direct distribution pipeline. |

### 7.2 High-Level Architecture
```
┌─────────────────────────────────────────────┐
│  React UI (Inbox, Thread, Compose, Settings)│
│  - Tiptap Editor                            │
│  - Tailwind + Radix                         │
└──────────────┬──────────────────────────────┘
               │ Tauri IPC (invoke / events)
┌──────────────▼──────────────────────────────┐
│  Rust Core                                  │
│  ├─ Account Manager    (OAuth, IMAP creds)  │
│  ├─ Sync Engine        (poll IMAP → SQLite) │
│  ├─ Threading Service  (Message-ID graph)   │
│  ├─ Search Service     (FTS5 queries)       │
│  ├─ Compose / SMTP     (send + queue)       │
│  ├─ AI Client        (reqwest → OpenAI API) │
│  └─ Notification Service (native OS)        │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  SQLite (SQLCipher)    │  OS Keychain     │
│  - accounts, emails,   │  - OAuth tokens   │
│    threads, queue, fts5│  - IMAP passwords │
└────────────────────────┴────────────────────┘
```

### 7.3 Key Architectural Decisions
1. **Unified IMAP Core:** Google and Microsoft accounts authenticate via OAuth but communicate over IMAP/SMTP using XOAUTH2. This eliminates the need to maintain separate Graph API and Gmail API sync engines in the MVP.
2. **Rust-Layer AI Proxy:** All LLM requests go through a Rust command to prevent exposing the API key in the renderer process and to avoid CORS complexities with custom `base_url` endpoints.
3. **Conversation Threading Client-Side:** Threads are reconstructed from RFC 2822 headers after every sync batch. No reliance on server-specific thread IDs (e.g., Gmail `X-GM-THRID`).
4. **Encryption by Default:** SQLCipher ensures that stealing the SQLite file does not expose email content if the machine is offline.

---

## 8. Datenmodell / API-Schnittstellen

### 8.1 Core Data Model (SQLite)

**Table: `accounts`**
```sql
CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_type   TEXT NOT NULL CHECK( provider_type IN ('gmail_oauth','microsoft_oauth','imap') ),
    display_name    TEXT NOT NULL,
    email_address   TEXT NOT NULL UNIQUE,
    imap_host       TEXT,
    imap_port       INTEGER,
    imap_encryption TEXT CHECK( imap_encryption IN ('SSL','STARTTLS') ),
    smtp_host       TEXT,
    smtp_port       INTEGER,
    smtp_encryption TEXT CHECK( smtp_encryption IN ('SSL','STARTTLS') ),
    access_token_key  TEXT,  -- keyring key name
    refresh_token_key TEXT,  -- keyring key name
    last_seen_uid     INTEGER DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

**Table: `threads`**
```sql
CREATE TABLE threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subject         TEXT,
    latest_date     INTEGER NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    is_read         INTEGER NOT NULL DEFAULT 0  -- 0 = unread, 1 = read
);
```

**Table: `emails`**
```sql
CREATE TABLE emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    imap_uid        INTEGER,
    message_id      TEXT NOT NULL,
    in_reply_to     TEXT,
    references      TEXT,  -- JSON array of Message-IDs
    subject         TEXT,
    from_json       TEXT NOT NULL,  -- JSON [{name, address}]
    to_json         TEXT NOT NULL,
    cc_json         TEXT,
    bcc_json        TEXT,
    date_rfc2822    TEXT,
    received_at     INTEGER NOT NULL,
    body_text       TEXT,
    body_html       TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0,
    folder          TEXT NOT NULL DEFAULT 'INBOX',
    attachments_meta TEXT  -- JSON array [{filename, mimeType, sizeBytes, localPath?}]
);
```

**FTS5 Virtual Table:**
```sql
CREATE VIRTUAL TABLE emails_fts USING fts5(
    subject,
    body_text,
    body_html_stripped,
    content='emails',
    content_rowid='id'
);
```
Keep `emails_fts` synchronized with external content triggers.

**Table: `send_queue`**
```sql
CREATE TABLE send_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_json         TEXT NOT NULL,
    cc_json         TEXT,
    bcc_json        TEXT,
    subject         TEXT NOT NULL,
    body_html       TEXT,
    body_text       TEXT,
    attachments_meta TEXT,  -- JSON array of local file paths
    status          TEXT NOT NULL DEFAULT 'pending' CHECK( status IN ('pending','sent','failed') ),
    retry_count     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    sent_at         INTEGER
);
```

**Table: `app_settings`** (AI + global)
```sql
CREATE TABLE app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT
);
-- keys: ai_base_url, ai_model, ai_default_tone, first_run_complete
```

### 8.2 Network API Interfaces

#### IMAP / SMTP
- **IMAP:** RFC 3501 (IMAP4rev1) + RFC 7628 (SASL XOAUTH2 for Google/Microsoft).
- **SMTP:** RFC 5321 with STARTTLS / TLS + `AUTH LOGIN` / `XOAUTH2`.

#### OAuth 2.0 Endpoints (Hardcoded per Provider)
| Provider | Auth URL | Token URL | Scope |
|----------|----------|-----------|-------|
| Google | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | `https://mail.google.com/` |
| Microsoft | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` | `openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send` |

#### OpenAI-Compatible LLM API
- **Endpoint:** `POST {base_url}/v1/chat/completions`
- **Headers:**
  - `Authorization: Bearer {api_key}`
  - `Content-Type: application/json`
- **Request Body Schema:**
```json
{
  "model": "{user_model}",
  "messages": [
    { "role": "system", "content": "You are an email assistant..." },
    { "role": "user", "content": "Thread context..." }
  ],
  "temperature": 0.3,
  "max_tokens": 1024
}
```
- **Success Response:** Standard OpenAI `choices[0].message.content` string consumed by the Rust layer and passed to the React frontend via IPC.

---

## 9. Offene Punkte & Risiken

### 9.1 Risiken
| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-01 | Google/Microsoft OAuth desktop flows may display “unverified app” warnings during beta, deterring users. | Medium | High | Register app early; submit for publisher verification before public launch. |
| R-02 | macOS notarization / Gatekeeper blocks unsigned `.dmg` installs. | High | High | Enroll in Apple Developer Program (~$99/yr); notarize via `notarytool` in CI. |
| R-03 | Long threads exceed LLM context windows, causing truncated or failed summaries. | Medium | Medium | Truncate by character budget (e.g., 100k chars) and summarize in chunks if necessary. |
| R-04 | Polling many accounts aggressively triggers IMAP rate limits (e.g., Gmail fair-use). | Medium | Medium | Respect 60s floor; add per-account sync enable/disable; implement backoff on `THROTTLED` responses. |
| R-05 | Rich-text editor + HTML sanitizer increase bundle size, jeopardizing < 30 MB target. | Medium | Medium | Measure bundle per sprint; replace heavy deps if needed; use `cargo-bloat` and `vite-bundle-visualizer`. |
| R-06 | Windows SmartScreen warnings on `.exe` from unknown publisher. | Medium | Medium | Purchase EV code-signing certificate for Windows builds. |

### 9.2 Offene Punkte
| ID | Open Item | Owner | Resolution Target |
|----|-----------|-------|-------------------|
| OP-01 | Final rich-text editor selection (Tiptap vs. Lexical) based on bundle-size audit. | Lead Architect | End of Sprint 1 (M1) |
| OP-02 | Exact HTML sanitization strategy: `ammonia` (Rust) for defense-in-depth vs. DOMPurify (frontend) only. | Security Reviewer | End of Sprint 2 (M2) |
| OP-03 | Linux build pipeline (`.AppImage` / `.deb`) is technically feasible via Tauri but out of MVP scope; revisit post-v1.0. | Product Owner | Post-MVP |

---

## 10. Meilensteine & Zeitplan

The MVP is scoped for a **focused 1–2 person team** over approximately **12 weeks**.

| Milestone | Duration | Deliverables | Erfolgskriterien |
|-----------|----------|--------------|------------------|
| **M1: Foundation** | Week 1–2 | Tauri + React scaffolded; CI builds for macOS & Windows; SQLite schema + migrations; secure storage abstraction wired. | Successful cross-platform build artifact < 30 MB. |
| **M2: Authentication** | Week 3–4 | OAuth flows (Google & Microsoft) complete; manual IMAP config form; credentials stored in OS keychain; XOAUTH2 IMAP login working. | 3 test accounts (1 Gmail, 1 Outlook, 1 IMAP) connect and authenticate. |
| **M3: Sync & Threading** | Week 5–6 | IMAP polling engine; incremental sync; local SQLite caching; client-side thread graph reconstruction. | 10k emails sync in < 5 min; threads group correctly by headers. |
| **M4: UI / UX Core** | Week 7–8 | Unified inbox view; threaded reading pane; rich-text compose (Tiptap); account filter; native notifications. | Users can read, reply, forward, and archive without crashes. |
| **M5: Offline & Search** | Week 9 | FTS5 indexing + search UI; offline detection; send queue with exponential backoff; queue survives restart. | Search < 500 ms; airplane-mode compose queues and sends on reconnect. |
| **M6: AI Integration** | Week 10–11 | AI settings panel; thread summarization prompt pipeline; AI reply draft injection; tone & language matching tested. | AI features work with OpenRouter + OpenAI endpoints; no auto-send. |
| **M7: Hardening & Ship** | Week 12 | HTML sanitization hardening; code signing + notarization; QA pass on target devices; release `.dmg` and `.exe`. | Zero critical bugs; app launches on clean macOS/Windows without security warnings. |

---

## Anlage A: Definition of Ready (für Entwicklungsteams)
Bevor ein Feature in die Sprint-Planung aufgenommen wird, müssen folgende Bedingungen erfüllt sein:
1. Alle zugehörigen FRs/NFRs sind mit eindeutigen IDs versehen.
2. Akzeptanzkriterien im GIVEN-WHEN-THEN-Format sind vorhanden.
3. UI-Mockups oder Storybook-Screenshots für die 3 primären Ansichten (Inbox, Thread, Compose) liegen vor.
4. API-Schema (IMAP/SMTP/LLM) ist validiert und dokumentiert.
5. Security & Privacy Review akzeptiert den Credential-Flow.

---

*End of Document. All clarifying questions from the discovery phase have been answered and are incorporated above.*
