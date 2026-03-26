# openclaw-channel-deltachat

An [OpenClaw](https://openclaw.ai) channel plugin that bridges [Delta Chat](https://delta.chat) messaging to OpenClaw's AI agent pipeline.

Users interact with OpenClaw agents by messaging a bot email address via any Delta Chat client, with automatic end-to-end encryption.

## Prerequisites

- [OpenClaw](https://openclaw.ai) gateway running
- [`deltachat-rpc-server`](https://github.com/chatmail/core/releases) on your `$PATH`
- An email account for the bot

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

## Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "deltachat": {
      "email": "bot@example.com",
      "password": "secret"
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `email` | yes | — | Bot email address |
| `password` | yes | — | Bot email password |
| `displayName` | no | `"OpenClaw Bot"` | Bot display name |
| `dataDir` | no | `~/.openclaw/deltachat-data` | Delta Chat data directory |
| `rpcServerPath` | no | `"deltachat-rpc-server"` | Path to rpc-server binary |
| `enabled` | no | `true` | Enable/disable the channel |

## How It Works

The plugin spawns `deltachat-rpc-server` as a child process and communicates via JSON-RPC. When a Delta Chat message arrives, it's dispatched to OpenClaw's agent pipeline. Agent responses are sent back as Delta Chat messages.

Supports both 1:1 DMs and group chats. All AI logic, conversation history, and access control are managed by OpenClaw.

## License

MIT
