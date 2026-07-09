# PortRelay

[Chinese documentation](README.md)

PortRelay exposes local `127.0.0.1:<port>` endpoints inside VS Code remote workspaces, including Dev Containers and Remote SSH.

It solves the reverse direction of regular VS Code port forwarding:

```text
local machine <local-endpoint>
  -> VS Code Remote tunnel
  -> remote workspace <remote-endpoint>
```

A typical use case is letting Playwright, Codex MCP, or other tools inside a remote container access the CDP port of a browser running on your local machine, without exposing that debug port to the network.

## Installation

PortRelay is made of two companion extensions. Install both:

- [PortRelay Local](https://marketplace.visualstudio.com/items?itemName=lwmacct.portrelay-local) (`lwmacct.portrelay-local`)
- [PortRelay Remote](https://marketplace.visualstudio.com/items?itemName=lwmacct.portrelay-remote) (`lwmacct.portrelay-remote`)

The extensions run in different extension hosts:

```text
PortRelay Local
  extensionKind: ["ui"]
  runs in the local VS Code UI side
  connects to local <local-endpoint>

PortRelay Remote
  extensionKind: ["workspace"]
  runs in the remote workspace/container/SSH side
  creates remote TCP listeners and Unix sockets
```

If either extension is manually installed in the wrong location, or `remote.extensionKind` overrides it into the wrong location, the extension reports an error and stops activating.

## Quick Start

Configure the local endpoint to expose in the VS Code remote window `settings.json`:

```json
{
  "portrelay.autoStart": true,
  "portrelay.mappings": [
    {
      "local": "127.0.0.1:9222",
      "remote": [
        "127.0.0.1:9222",
        "unix:/tmp/portrelay/chrome-cdp.sock"
      ]
    }
  ]
}
```

This exposes local `127.0.0.1:9222` inside the remote workspace and creates:

```text
127.0.0.1:9222
/tmp/portrelay/chrome-cdp.sock
```

If local `9222` is a Chrome CDP port, verify it from the remote terminal:

```bash
curl http://127.0.0.1:9222/json/version
```

Or verify through the Unix socket:

```bash
curl --unix-socket /tmp/portrelay/chrome-cdp.sock \
  http://localhost/json/version
```

## Chrome CDP Example

Start Chrome or Chromium with a CDP port on the local machine:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/portrelay-chrome-profile
```

On macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
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

The remote side creates:

```text
127.0.0.1:9222
/tmp/portrelay/chrome-cdp.sock
```

Playwright in the remote workspace can connect directly to the remote address:

```js
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://example.com');
  console.log(await page.title());

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

To let Codex use the same CDP forwarding address through Playwright MCP, configure Codex `config.toml`:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint=http://127.0.0.1:9222"]
```

The MCP server runs on the remote workspace side, so `127.0.0.1:9222` is forwarded to the local browser through PortRelay.

## Configuration

### `portrelay.autoStart`

Default: `true`

Starts configured mappings automatically after the remote window starts. Disable it if you prefer starting manually from a command.

### `portrelay.mappings`

Default: `[]`

Configures local-to-remote endpoint mappings. Each mapping is an object, so you can temporarily disable a mapping with `enabled` without deleting it:

```json
{
  "portrelay.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": false,
      "local": "127.0.0.1:9222",
      "remote": "127.0.0.1:9222"
    },
    {
      "name": "web-dev",
      "local": "127.0.0.1:3000",
      "remote": "127.0.0.1:3000"
    }
  ]
}
```

Both `local` and `remote` accept a string or an array of strings:

```json
{
  "name": "browser",
  "local": [
    "unix:/tmp/chrome-cdp.sock",
    "127.0.0.1:9222"
  ],
  "remote": [
    "127.0.0.1:9222",
    "unix:/tmp/portrelay/browser.sock"
  ]
}
```

The `local` array is an ordered fallback list, not multiple simultaneous local connections. The `remote` array creates multiple remote entrypoints.

Endpoint formats:

- `127.0.0.1:9222`: TCP endpoint shorthand.
- `tcp:127.0.0.1:9222`: explicit TCP endpoint.
- `tcp://127.0.0.1:9222`: TCP URI form.
- `unix:/tmp/chrome-cdp.sock`: Unix socket with an absolute path.

Advanced mappings can combine local socket fallback with multiple remote entrypoints:

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

Fields:

- `enabled`: whether this mapping is active; defaults to `true`. Set it to `false` to keep but skip the mapping.
- `name`: mapping name; defaults to a name generated from the first `local` and `remote` endpoints.
- `local`: local target endpoint, or an ordered array of fallback endpoints.
- `remote`: remote exposed endpoint, or an array of remote entrypoints to create.

Unix sockets exist only in the corresponding machine's filesystem and have a smaller exposure surface than TCP ports; remote TCP ports are useful for tools that only support `host:port`.

### `portrelay.controlReconnectDelayMs`

Default: `1000`

Delay, in milliseconds, before the remote extension recreates the internal control tunnel after it is closed.

## Commands

The Remote extension contributes:

```text
PortRelay: Start Remote
PortRelay: Stop Remote
PortRelay: Restart Remote
PortRelay: Reconnect Control Channel
PortRelay: Show Remote Status
```

The Local extension contributes:

```text
PortRelay: Show Local Status
```

## How It Works

Data path:

```text
remote process
  -> remote <remote-endpoint>
  -> portrelay-remote
  -> VS Code forwarded control tunnel
  -> portrelay-local
  -> local machine <local-endpoint>
```

`portrelay-remote` reads `portrelay.mappings`, creates remote TCP listeners and Unix sockets, starts an internal control server, and creates a VS Code tunnel through `vscode.env.asExternalUri()`.

`portrelay-local` receives the forwarded URI from the remote extension, connects to the control channel, and opens local target connections per session.

HTTP, WebSocket, and CDP traffic are not parsed. They are forwarded as raw TCP bytes.

VS Code's Ports/Forwarded Ports panel may show a random internal control port. It is not a business port. If the user closes that tunnel, the remote extension recreates it after `portrelay.controlReconnectDelayMs`.

More development notes are in [docs/notes.md](docs/notes.md).

## Known Limits

- Both Local and Remote extensions must be installed.
- The current control channel assumes `vscode.env.asExternalUri()` returns a locally reachable TCP URI in desktop Remote/Dev Containers/Remote SSH.
- VS Code for the Web or some cloud tunnel environments may return an HTTPS proxy URI; those environments need additional handling.
- PortRelay exposes local endpoint capabilities to the remote environment. CDP ports are powerful, so prefer binding the local side to `127.0.0.1`, and prefer remote Unix sockets or remote `127.0.0.1`. Do not bind privileged debug protocols to `0.0.0.0`.

## Development

Install dependencies:

```bash
pnpm install
```

Compile:

```bash
pnpm run compile
```

Typecheck:

```bash
pnpm run typecheck
```

Package both VSIX files:

```bash
pnpm run package
```

Output:

```text
artifacts/vsix/portrelay-local-<version>.vsix
artifacts/vsix/portrelay-remote-<version>.vsix
```

Publishing notes are in [docs/publish.md](docs/publish.md). Localization and README language rules are in [docs/localization.md](docs/localization.md).

## References

- [Extension host placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [`vscode.env.asExternalUri()` API](https://code.visualstudio.com/api/references/vscode-api)
