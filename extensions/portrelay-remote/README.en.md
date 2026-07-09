# Port Relay Remote

[Chinese documentation](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-portrelay/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-portrelay/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-portrelay?label=release)](https://github.com/lwmacct/260708-portrelay/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-portrelay)](https://github.com/lwmacct/260708-portrelay/blob/main/LICENSE)

Port Relay Remote is the remote-workspace half of Port Relay. It runs in the VS Code workspace extension host and creates remote TCP listeners and Unix sockets that forward to endpoints on your local machine.

Install this extension together with `lwmacct.portrelay-local`. The remote extension owns configuration, starts the relay, creates the internal control tunnel, and asks the local extension to connect back to local targets.

## What It Does

Port Relay exposes a local-only endpoint inside a VS Code remote workspace:

```text
remote process
  -> remote <remote-endpoint>
  -> Port Relay Remote
  -> VS Code forwarded control tunnel
  -> Port Relay Local
  -> local machine <local-endpoint>
```

Typical use cases:

- Connect Playwright in a Dev Container to Chrome running on the local machine.
- Let remote tools call a local development service without making that service public.
- Create a stable Unix socket path in the remote filesystem for tools that support sockets.

HTTP, WebSocket, CDP, and other protocols are forwarded as raw TCP bytes. Port Relay does not parse or terminate the protocol.

## Required Companion Extension

Port Relay is split into two extensions because VS Code has separate local and remote extension hosts:

```text
lwmacct.portrelay-local
  runs locally in the UI extension host
  connects to local <local-endpoint>

lwmacct.portrelay-remote
  runs in the remote workspace extension host
  creates remote sockets and remote TCP listeners
```

Both extensions validate their runtime host during activation. If this extension is forced to run locally or in a non-remote window, it stops with an error instead of creating listeners on the wrong side.

## Configuration

Minimal remote workspace setting:

```json
{
  "portrelay.autoStart": true,
  "portrelay.mappings": [
    {
      "local": "127.0.0.1:9222",
      "remote": "127.0.0.1:9222"
    }
  ]
}
```

That exposes local `127.0.0.1:9222` inside the remote workspace as:

```text
127.0.0.1:9222
```

Named mapping:

```json
{
  "portrelay.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": true,
      "local": "127.0.0.1:9222",
      "remote": [
        "127.0.0.1:9222",
        "unix:/tmp/portrelay/chrome-cdp.sock"
      ]
    }
  ]
}
```

Advanced mapping:

```json
{
  "portrelay.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": true,
      "local": [
        "unix:/tmp/chrome-cdp.sock",
        "127.0.0.1:9222"
      ],
      "remote": [
        "127.0.0.1:39222",
        "unix:/tmp/portrelay/chrome-cdp.sock"
      ]
    }
  ]
}
```

Mapping fields:

- `enabled`: whether this mapping is active; defaults to `true`. Set it to `false` to keep but skip the mapping.
- `name`: stable mapping name; defaults to a name generated from the first local and remote endpoints.
- `local`: local target endpoint, or an ordered array of fallback endpoints.
- `remote`: remote entrypoint to create, or an array of remote entrypoints.

Endpoint formats support `127.0.0.1:9222`, `tcp:127.0.0.1:9222`, `tcp://127.0.0.1:9222`, and `unix:/tmp/name.sock`.

## Chrome CDP Example

Start Chrome on the local machine:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/portrelay-chrome-profile
```

Configure the remote workspace:

```json
{
  "portrelay.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": true,
      "local": "127.0.0.1:9222",
      "remote": [
        "127.0.0.1:9222",
        "unix:/tmp/portrelay/chrome-cdp.sock"
      ]
    }
  ]
}
```

Verify from the remote workspace:

```bash
curl http://127.0.0.1:9222/json/version
curl --unix-socket /tmp/portrelay/chrome-cdp.sock http://localhost/json/version
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
Port Relay: Start Remote
Port Relay: Stop Remote
Port Relay: Restart Remote
Port Relay: Reconnect Control Channel
Port Relay: Show Remote Status
```

If `portrelay.autoStart` is `true`, mappings start automatically after the remote window starts.

## Security Notes

Port Relay moves local capabilities into a remote workspace. Treat forwarded endpoints as sensitive, especially Chrome CDP and other debugging ports.

Recommended defaults:

- Keep local services bound to `127.0.0.1`.
- Keep remote TCP listeners bound to `127.0.0.1`.
- Prefer the generated Unix socket when the remote client supports it.
- Do not expose CDP or other privileged debug protocols on `0.0.0.0`.

## Links

- Repository: https://github.com/lwmacct/260708-portrelay
- Issues: https://github.com/lwmacct/260708-portrelay/issues
- Publishing notes: https://github.com/lwmacct/260708-portrelay/blob/main/docs/publish.md
