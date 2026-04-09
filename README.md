# openclaw-channel-deltachat

This was a quick and dirty experiment to get Delta Chat to work with open claw. I decided to pursue a more mature version of [this with Claude Code channels](https://github.com/jhayashi/dc-claude-channel), but if this starting point is useful to folks, please feel free to fork or send improvements.

An [OpenClaw](https://openclaw.ai) channel plugin that bridges [Delta Chat](https://delta.chat) messaging to OpenClaw's AI agent pipeline.

Users interact with OpenClaw agents via end-to-end encrypted Delta Chat messages.

## Prerequisites

- [OpenClaw](https://openclaw.ai) gateway running
- [`deltachat-rpc-server`](https://github.com/chatmail/core/releases) on your `$PATH` (see below)

### Installing deltachat-rpc-server

The easiest way is via pip (ships a prebuilt binary):

```bash
pip install deltachat-rpc-server
```

Alternatively, download a prebuilt binary from the [Delta Chat core releases](https://github.com/chatmail/core/releases) and place it on your `$PATH`.

Verify the install:

```bash
deltachat-rpc-server --version
```

## Install

```bash
openclaw plugins install openclaw-channel-deltachat
```

Or from source:

```bash
git clone https://github.com/jhayashi/dcbot.git
cd dcbot
npm install && npm run build
openclaw plugins install -l .
```

## Quick Start (Zero Config)

Add a minimal entry to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "deltachat": {
      "email": "auto"
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

On first start, the plugin automatically:
1. Creates a [chatmail](https://delta.chat/chatmail) account (no email credentials needed)
2. Generates a SecureJoin invite link and QR code
3. Reads the agent's display name from `IDENTITY.md` in the workspace

Open `http://127.0.0.1:18789/deltachat/invite` in your browser to see the QR code. Scan it with Delta Chat to establish an encrypted connection, then start chatting.

## Using a Custom Email Account

To use a regular email provider (Gmail, Fastmail, etc.) instead of chatmail:

```json
{
  "channels": {
    "deltachat": {
      "email": "bot@example.com",
      "password": "app-password"
    }
  }
}
```

With a regular email account, encryption is established automatically after the first message exchange (no QR scan needed). Any IMAP/SMTP provider works.

## Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `email` | yes | — | Set to `"auto"` for chatmail, or a real email address |
| `password` | no | — | Email password (only needed with a real email address) |
| `chatmailServer` | no | `"nine.testrun.org"` | Chatmail server for auto-created accounts |
| `dataDir` | no | `~/.openclaw/deltachat-data` | Delta Chat data directory |
| `rpcServerPath` | no | `"deltachat-rpc-server"` | Path to rpc-server binary |
| `enabled` | no | `true` | Enable/disable the channel |

The bot's display name is read from `IDENTITY.md` in the OpenClaw workspace.

## Invite Page

The plugin serves a SecureJoin invite page at `/deltachat/invite` on the gateway:

- `/deltachat/invite` — HTML page with QR code and instructions
- `/deltachat/invite/qr.svg` — Raw QR code SVG
- `/deltachat/invite/link` — Plain text invite link

## How It Works

The plugin spawns `deltachat-rpc-server` as a child process and communicates via JSON-RPC over stdio. When a message arrives, it's dispatched to OpenClaw's agent pipeline via `channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher()`. Agent responses are sent back as Delta Chat messages.

Supports both 1:1 DMs and group chats. Each conversation gets its own OpenClaw session. All AI logic, conversation history, and access control are managed by OpenClaw.

## License

MIT
