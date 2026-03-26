# dcbot — Delta Chat Claude Bot CLI

## Overview

**dcbot** is a self-hosted Delta Chat bot that bridges conversations to Anthropic's Claude API. It is a single Go binary that acts as a personal AI assistant accessible through any Delta Chat client. Users interact with Claude by sending messages to the bot's email address, with automatic end-to-end encryption via Delta Chat.

The project is inspired by OpenClaw's Telegram bot but built for the Delta Chat ecosystem, prioritizing privacy, simplicity, and self-hosting.

## Architecture

### Tech Stack

- **Language:** Go
- **Delta Chat integration:** `deltabot-cli-go` (high-level Go library wrapping `deltachat-rpc-server` via JSON-RPC)
- **LLM provider:** Anthropic Claude API (REST with `stream: true` — SSE streaming, buffered internally before sending reply)
- **Storage:** SQLite (conversation history, user state, config)
- **Distribution:** Go binary + `deltachat-rpc-server` (Rust binary, must be installed separately or on `$PATH`). The Go code itself is pure-Go with no CGo.

### Project Structure

```
dcbot/
  cmd/dcbot/main.go          — CLI entry point, flag parsing, signal handling
  internal/bot/bot.go         — Core bot logic, event handling, message routing
  internal/bot/commands.go    — Chat command dispatch and handlers
  internal/claude/client.go   — Anthropic API client (streaming, vision, files)
  internal/store/store.go     — SQLite-backed conversation history and user state
  internal/config/config.go   — TOML config parsing, runtime config updates
  internal/media/media.go     — Media detection, image conversion, text extraction
```

### Runtime Flow

1. On startup, `dcbot` reads the config file and CLI flags, initializes the SQLite database, and connects to the configured email account via `deltabot-cli-go`.
2. The Delta Chat core engine (bundled `deltachat-rpc-server`) handles IMAP/SMTP connections, message encryption/decryption, and contact management.
3. When a message arrives, the bot:
   - Checks access control (is this user/group approved, pending, or blocked?)
   - If a `/command`, routes to command handler
   - Otherwise, loads conversation history for this chat (from in-memory map for session mode, from SQLite for persistent mode, or none for ephemeral)
   - Prepends the system prompt (from config or runtime override) and sends the conversation context + new message to the Claude API
   - Sends Claude's response back as a Delta Chat message
4. On shutdown (SIGINT/SIGTERM), flushes pending writes and closes the database cleanly.

## Account Setup

Two methods for setting up the bot's email account:

### CLI Flags (Primary)

```
dcbot --email bot@example.com --password "secret"
```

On first run, Delta Chat core auto-discovers IMAP/SMTP settings, configures the account, and stores its state in the data directory (`~/.config/dcbot/data/` by default). Subsequent runs reuse the stored account with no credentials needed.

### Backup Import (Alternative)

```
dcbot --import-backup /path/to/backup.tar
```

Import an existing Delta Chat account backup (`.tar` file exported from Delta Chat desktop/mobile). Useful for migrating a bot between machines or pre-configuring the account in the GUI.

## Access Control

### Pairing/Approval Model

- **Pending:** New users who message the bot are placed in `pending` state. The bot replies: "Access requested. Waiting for approval."
- **Notification:** The bot owner receives a message in their 1:1 chat with the bot: "New access request from user@example.com". The owner must message the bot first (at startup, the bot creates a chat with the owner's configured email).
- **Approved:** Owner approves via `/approve user@example.com`. User can now interact with Claude.
- **Blocked:** Owner denies via `/deny user@example.com`. Messages from blocked users are silently ignored (no reply, no read receipt). `/approve` can be used on a previously blocked user to unblock and grant access.

### Owner

The bot owner is defined in the config file (`owner.email`). The owner has access to admin commands and receives access request notifications.

### Group Chats

- When the bot is added to a group, the group is `pending` by default
- The bot notifies the owner with the group name and ID: "New group access request: 'Book Club' (id: 42)"
- Owner approves groups via `/approve-group <id>` from their 1:1 chat with the bot
- All members of an approved group can interact with the bot
- Each group has its own isolated conversation thread

## Conversation History & Context Modes

Three modes, configurable globally (via config file) or per-chat (via `/mode` command). Per-chat mode preference is stored in the `users` table in SQLite and persists across restarts.

| Mode | Behavior | Storage |
|------|----------|---------|
| **Ephemeral** | No history. Each message is independent. | None |
| **Session** | History kept in an in-memory map, cleared after inactivity timeout. Lost on restart. | In-memory map |
| **Persistent** | Full history stored in SQLite, survives restarts. | SQLite |

**Default mode:** Session (configurable in config file).

### Context Management

- Each 1:1 chat and each group chat gets its own conversation thread
- When sending to Claude, the bot loads the most recent messages up to `max_history_messages` (default: 100) to stay within the context window
- History includes user messages, Claude responses, and media references
- If the Claude API returns a context-length error, the bot drops the oldest 50% of the included history and retries once

### Session Mode Details

- Inactivity timeout: configurable, default 30 minutes. Measured from the last message sent by the user in that chat.
- On timeout, session history is cleared and the next message starts a fresh conversation

### Group Chat Mode

- In group chats, `/mode` can only be used by the first group member to message the bot (recorded as `added_by` in the groups table), or by the bot owner. This prevents conflicts from multiple members changing the mode.
- The mode applies to the entire group conversation thread.

### Concurrency

- Messages are processed sequentially per chat (one at a time per conversation thread). A mutex per chat ID ensures no race conditions on shared history.
- Different chats are processed concurrently.

## Media Handling

### Inbound (User to Bot)

| Media Type | Handling |
|------------|----------|
| **Images** (JPEG, PNG, WEBP, GIF) | Converted to base64, sent to Claude's vision API |
| **Documents** (PDF) | Sent directly to Claude API as base64 (native PDF support). No local text extraction needed. |
| **Documents** (TXT, CSV, code files) | Read as plain text, included in Claude message |
| **Audio/Video** | Not supported. Bot replies: "Sorry, I can't process audio/video files yet." |

- Configurable max file size per attachment (default: 10MB)
- Files over the limit are rejected with a friendly message

### Outbound (Bot to User)

- Primary output is text messages. Long responses are sent as a single message (no chunking).
- **Future consideration:** Code blocks in Claude's response could be sent as file attachments. Deferred from v1.

## Configuration

### Environment Variables

The Claude API key can be provided via the `ANTHROPIC_API_KEY` environment variable to avoid storing secrets in the config file. Precedence: CLI flag > environment variable > config file.

### Config File (`~/.config/dcbot/config.toml`)

```toml
[claude]
api_key = "sk-ant-..."  # or use ANTHROPIC_API_KEY env var
model = "claude-sonnet-4-6-20250514"
max_tokens = 4096
system_prompt = "You are a helpful assistant."

[bot]
data_dir = "~/.config/dcbot/data"
default_mode = "session"
session_timeout = "30m"
max_history_messages = 100
max_file_size = "10MB"
log_level = "info"

[owner]
email = "owner@example.com"
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--email` | Bot email address (first-run setup) |
| `--password` | Bot email password (first-run setup) |
| `--import-backup` | Path to Delta Chat backup file |
| `--config` | Custom config file path |
| `--data-dir` | Custom data directory |
| `--model` | Override Claude model |
| `--api-key` | Anthropic API key (avoid storing in config) |
| `--log-level` | Log level (debug, info, warn, error) |

Precedence for all settings: CLI flag > environment variable > config file.

### Bot Commands (via Chat)

#### User Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/mode <ephemeral\|session\|persistent>` | Switch conversation mode |
| `/clear` | Clear conversation history |
| `/status` | Show current mode and message count in current session/history |

#### Owner Commands

| Command | Description |
|---------|-------------|
| `/approve <email>` | Approve a pending user |
| `/deny <email>` | Deny and block a user |
| `/revoke <email>` | Remove user access (returns user to pending state; they can re-request) |
| `/users` | List all users and their statuses |
| `/approve-group <id>` | Approve a pending group |
| `/deny-group <id>` | Deny and ignore a pending group |
| `/revoke-group <id>` | Remove group access (returns to pending) |

## Database Schema

SQLite with schema versioning via `PRAGMA user_version`. The bot checks `user_version` on startup and runs any pending migrations sequentially.

```sql
-- Users and their access state
CREATE TABLE users (
    email       TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, blocked
    mode        TEXT,                              -- NULL = use global default; ephemeral, session, persistent
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Group chats and their access state
CREATE TABLE groups (
    group_id    INTEGER PRIMARY KEY,
    name        TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, approved
    mode        TEXT,                              -- NULL = use global default
    added_by    TEXT,                              -- email of user who added the bot
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversation history (persistent mode only)
CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,                     -- "user:<email>" or "group:<id>"
    role        TEXT NOT NULL,                     -- user, assistant
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id, created_at);
```

## Error Handling & Resilience

### Network/Email

- Delta Chat core handles IMAP/SMTP reconnection automatically
- Messages queue in Delta Chat core during connectivity loss and send when restored

### Claude API

| Error | Handling |
|-------|----------|
| Rate limit (429) | Exponential backoff, max 3 retries. Then reply: "I'm being rate limited, please try again in a moment." |
| Auth error (401) | Log error. Reply: "Bot configuration error. Please contact the owner." |
| Server error (5xx) | Retry once. Then reply: "Claude is temporarily unavailable." |
| Context too long | Drop oldest 50% of included history, retry once. If still too long, reply: "Conversation too long. Use /clear to start fresh." |

### Storage

- SQLite with WAL mode for concurrent read access during message handling
- Graceful shutdown on SIGINT/SIGTERM — flush pending writes, close database

### Logging

- Structured logging via Go `slog` package to stderr
- Configurable log level via config file or `--log-level` flag
- No sensitive data (message contents, API keys) in logs

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `github.com/deltachat-bot/deltabot-cli-go` | Delta Chat bot framework |
| `modernc.org/sqlite` | Pure-Go SQLite driver (no CGo) |
| `github.com/BurntSushi/toml` | TOML config parsing |
| Go standard library (`net/http`, `encoding/json`, `slog`) | Claude API client, logging |

## Non-Goals (v1)

- Multiple LLM providers (Claude only)
- Docker/container distribution
- Web UI or admin dashboard
- Tool use / function calling (future consideration)
- Audio/video processing
- Inline keyboards or interactive UI elements (Delta Chat doesn't support these natively)
