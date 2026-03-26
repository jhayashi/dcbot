import type { IncomingMessage, ServerResponse } from "node:http";
import { createDeltaChatChannel, inviteState } from "./channel.js";

export default function register(api: any) {
  const channel = createDeltaChatChannel();
  api.registerChannel(channel);

  // Serve the SecureJoin invite page on the gateway dashboard
  api.registerHttpRoute({
    path: "/deltachat/invite",
    auth: "gateway",
    match: "prefix",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.endsWith("/qr.svg")) {
        // Serve raw SVG
        if (!inviteState.svg) {
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("Delta Chat channel not started yet");
          return;
        }
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(inviteState.svg);
        return;
      }

      if (req.url?.endsWith("/link")) {
        // Return just the invite link as plain text
        if (!inviteState.inviteLink) {
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("Delta Chat channel not started yet");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(inviteState.inviteLink);
        return;
      }

      // Serve HTML page with QR code and invite link
      if (!inviteState.inviteLink || !inviteState.svg) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Delta Chat channel not started yet");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect to OpenClaw via Delta Chat</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 480px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
      background: #1a1a2e;
      color: #e0e0e0;
    }
    h1 { font-size: 1.4em; margin-bottom: 8px; color: #fff; }
    p { color: #aaa; font-size: 0.95em; line-height: 1.5; }
    .qr-container {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      margin: 24px auto;
      display: inline-block;
    }
    .qr-container svg { width: 280px; height: 280px; }
    .invite-link {
      display: inline-block;
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 12px 20px;
      margin: 16px 0;
      word-break: break-all;
      font-size: 0.85em;
      color: #5dade2;
      text-decoration: none;
    }
    .invite-link:hover { background: #1a2744; }
    .steps { text-align: left; margin: 24px 0; }
    .steps li { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>Connect to OpenClaw Bot</h1>
  <p>Scan this QR code with Delta Chat to start an encrypted conversation.</p>
  <div class="qr-container">${inviteState.svg}</div>
  <p>Or open this invite link in Delta Chat:</p>
  <a class="invite-link" href="${inviteState.inviteLink}">${inviteState.inviteLink}</a>
  <ol class="steps">
    <li>Open Delta Chat on your phone</li>
    <li>Tap the QR code scanner (or paste the link)</li>
    <li>Scan the code above to verify and connect</li>
    <li>Send a message to start chatting with the AI agent</li>
  </ol>
</body>
</html>`;

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    },
  });
}
