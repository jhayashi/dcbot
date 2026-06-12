# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An OpenClaw channel plugin (`openclaw-channel-deltachat`) that bridges Delta Chat (end-to-end encrypted email messaging) to OpenClaw's AI agent pipeline. It spawns `deltachat-rpc-server` as a child process and talks to it via JSON-RPC over stdio using `@deltachat/jsonrpc-client`.

## Commands

```bash
npm run build        # tsc → dist/
npm run lint         # tsc --noEmit (type-check only; no eslint)
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
npx vitest run tests/channel.test.ts          # single test file
npx vitest run -t "parses dm session key"     # single test by name
```

Local install into a running OpenClaw gateway: `npm run build && openclaw plugins install -l .` then `openclaw gateway restart`. Live testing requires `deltachat-rpc-server` on `$PATH` (`pip install deltachat-rpc-server`).

## Architecture

Three layers, one file each in `src/`:

- **`index.ts`** — plugin entry (`openclaw.plugin.json` → `dist/index.js`). Registers the channel and an HTTP route serving the SecureJoin invite page at `/deltachat/invite` (HTML, `/qr.svg`, `/link`). Reads QR/link from the `inviteState` object exported by `channel.ts`.
- **`channel.ts`** — the OpenClaw `ChannelPlugin` object (`createDeltaChatChannel()`): config resolution, outbound `sendText`/`sendMedia`, and the `gateway.startAccount`/`stopAccount` lifecycle. `startAccount` must block until `stopAccount` is called — it parks on a promise after wiring everything up. Inbound messages are dispatched to the agent via `channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher()`.
- **`deltachat.ts`** — `DeltaChatClient`, the wrapper around the `deltachat-rpc-server` child process: account creation/configuration, send/receive, contact/chat queries, crash-respawn (gives up after 3 crashes in 60s), graceful stop that waits for in-flight message handlers.

Key conventions:

- **Session keys** route conversations: `deltachat:dm:<email>` for DMs, `deltachat:group:<chatId>` for groups. Built/parsed by static methods on `DeltaChatClient`; each maps to one OpenClaw agent session.
- **OpenClaw SDK types are stubbed locally** in `channel.ts` (`ChannelGatewayContext`, etc.) — `openclaw` is a peerDependency and is not imported. Keep the stubs in sync with the real contract when adding adapter slots.
- **Account setup is zero-config by default**: with `email: "auto"` (or no credentials) the client auto-provisions a chatmail account via `DCACCOUNT:` QR config; with `email`+`password` it configures a regular IMAP/SMTP transport. Accounts are set `bot=1, show_emails=2`; incoming-message handling uses the `IncomingMsg` event (not `waitNextMsgs`, which misses plain emails).
- **Display name** comes from `IDENTITY.md` in the OpenClaw workspace (`**Name:** ...` line), not from config.
- `deltachat-rpc-server` holds an exclusive SQLite lock per data dir — never run two processes against the same `dataDir`.
- Don't log message bodies at info level beyond a short prefix (E2EE plaintext).

## Tests

Unit tests cover only the pure helpers (session key parse/build, `buildInboundContext`, `shouldSkipChat`) — the rpc-server is not mocked or spawned in tests. `tsconfig.json` excludes `tests/`; vitest type-checks them itself.

## Docs

`docs/architecture.md` and `docs/openclaw-channel-spec.md` describe the **target** architecture (a ~30-adapter `createChatChannelPlugin` layout with `monitor/`, `bot/delivery.ts`, pairing, WebXDC, sub-agents). The current code is a much smaller subset — don't assume files or adapters named there exist. Implementation plans live in `docs/superpowers/plans/`.
