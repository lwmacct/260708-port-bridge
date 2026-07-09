# Port Bridge Remote

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-port-bridge/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-port-bridge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-port-bridge?label=release)](https://github.com/lwmacct/260708-port-bridge/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-port-bridge)](https://github.com/lwmacct/260708-port-bridge/blob/main/LICENSE)

Port Bridge Remote is the remote-workspace half of Port Bridge. It runs in the VS Code workspace extension host and creates remote TCP listeners and Unix sockets that forward to ports on your local machine.

Install this extension together with `lwmacct.port-bridge-local`. The remote extension owns configuration, starts the bridge, creates the internal control tunnel, and asks the local extension to connect back to local targets.

## What It Does

Port Bridge exposes a local-only port inside a VS Code remote workspace:

```text
remote process
  -> remote 127.0.0.1:<remotePort>
  -> remote Unix socket
  -> Port Bridge Remote
  -> VS Code forwarded control tunnel
  -> Port Bridge Local
  -> local machine 127.0.0.1:<localPort>
```

Typical use cases:

- Connect Playwright in a Dev Container to Chrome running on the local machine.
- Let remote tools call a local development service without making that service public.
- Create a stable Unix socket path in the remote filesystem for tools that support sockets.

HTTP, WebSocket, CDP, and other protocols are forwarded as raw TCP bytes. Port Bridge does not parse or terminate the protocol.

## Required Companion Extension

Port Bridge is split into two extensions because VS Code has separate local and remote extension hosts:

```text
lwmacct.port-bridge-local
  runs locally in the UI extension host
  connects to local 127.0.0.1:<localPort>

lwmacct.port-bridge-remote
  runs in the remote workspace extension host
  creates remote sockets and remote TCP listeners
```

Both extensions validate their runtime host during activation. If this extension is forced to run locally or in a non-remote window, it stops with an error instead of creating listeners on the wrong side.

## Configuration

Minimal remote workspace setting:

```json
{
  "portBridge.autoStart": true,
  "portBridge.mappings": [9222]
}
```

That exposes local `127.0.0.1:9222` inside the remote workspace as:

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/port-9222.sock
```

Named mapping:

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "port": 9222
    }
  ]
}
```

Advanced mapping:

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "localHost": "127.0.0.1",
      "localPort": 9222,
      "remoteHost": "127.0.0.1",
      "remotePort": 39222,
      "remoteSocket": "/tmp/vscode-port-bridge/chrome-cdp.sock"
    }
  ]
}
```

Mapping fields:

- `number`: shorthand for the common case, for example `9222`.
- `name`: stable mapping name; defaults to `port-<localPort>`.
- `port`: shared shorthand for `localPort` and default `remotePort`.
- `localHost`: local target host; defaults to `127.0.0.1`.
- `localPort`: local target port.
- `remoteHost`: remote TCP listener host; defaults to `127.0.0.1`.
- `remotePort`: remote TCP listener port.
- `remoteSocket`: remote Unix socket path; defaults to `/tmp/vscode-port-bridge/<name>.sock`.

## Chrome CDP Example

Start Chrome on the local machine:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/port-bridge-chrome-profile
```

Configure the remote workspace:

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "port": 9222
    }
  ]
}
```

Verify from the remote workspace:

```bash
curl http://127.0.0.1:9222/json/version
curl --unix-socket /tmp/vscode-port-bridge/chrome-cdp.sock http://localhost/json/version
```

Use Playwright from the remote workspace:

```js
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
  await page.goto('https://example.com');
  console.log(await page.title());
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## Commands

This extension contributes:

```text
Port Bridge: Start Remote
Port Bridge: Stop Remote
Port Bridge: Restart Remote
Port Bridge: Reconnect Control Channel
Port Bridge: Show Remote Status
```

If `portBridge.autoStart` is `true`, mappings start automatically after the remote window starts.

## Security Notes

Port Bridge moves local capabilities into a remote workspace. Treat forwarded endpoints as sensitive, especially Chrome CDP and other debugging ports.

Recommended defaults:

- Keep local services bound to `127.0.0.1`.
- Keep remote TCP listeners bound to `127.0.0.1`.
- Prefer the generated Unix socket when the remote client supports it.
- Do not expose CDP or other privileged debug protocols on `0.0.0.0`.

## Links

- Repository: https://github.com/lwmacct/260708-port-bridge
- Issues: https://github.com/lwmacct/260708-port-bridge/issues
- Publishing notes: https://github.com/lwmacct/260708-port-bridge/blob/main/docs/publish.md
