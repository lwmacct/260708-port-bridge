# Port Bridge

[Chinese documentation](README.md)

Port Bridge exposes local `127.0.0.1:<port>` endpoints inside VS Code remote workspaces, including Dev Containers and Remote SSH.

It solves the reverse direction of regular VS Code port forwarding:

```text
local machine 127.0.0.1:<localPort>
  -> VS Code Remote tunnel
  -> remote workspace 127.0.0.1:<remotePort> or /tmp/vscode-port-bridge/<name>.sock
```

A typical use case is letting Playwright, Codex MCP, or other tools inside a remote container access the CDP port of a browser running on your local machine, without exposing that debug port to the network.

## Installation

Port Bridge is made of two companion extensions. Install both:

- [Port Bridge Local](https://marketplace.visualstudio.com/items?itemName=lwmacct.port-bridge-local) (`lwmacct.port-bridge-local`)
- [Port Bridge Remote](https://marketplace.visualstudio.com/items?itemName=lwmacct.port-bridge-remote) (`lwmacct.port-bridge-remote`)

The extensions run in different extension hosts:

```text
Port Bridge Local
  extensionKind: ["ui"]
  runs in the local VS Code UI side
  connects to local 127.0.0.1:<localPort>

Port Bridge Remote
  extensionKind: ["workspace"]
  runs in the remote workspace/container/SSH side
  creates remote TCP listeners and Unix sockets
```

If either extension is manually installed in the wrong location, or `remote.extensionKind` overrides it into the wrong location, the extension reports an error and stops activating.

## Quick Start

Configure the local port to expose in the VS Code remote window `settings.json`:

```json
{
  "portBridge.autoStart": true,
  "portBridge.mappings": [
    {
      "port": 9222
    }
  ]
}
```

This exposes local `127.0.0.1:9222` inside the remote workspace and creates:

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/port-9222.sock
```

If local `9222` is a Chrome CDP port, verify it from the remote terminal:

```bash
curl http://127.0.0.1:9222/json/version
```

Or verify through the Unix socket:

```bash
curl --unix-socket /tmp/vscode-port-bridge/port-9222.sock \
  http://localhost/json/version
```

## Chrome CDP Example

Start Chrome or Chromium with a CDP port on the local machine:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/port-bridge-chrome-profile
```

On macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
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
      "enabled": true,
      "port": 9222
    }
  ]
}
```

The remote side creates:

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/chrome-cdp.sock
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

The MCP server runs on the remote workspace side, so `127.0.0.1:9222` is forwarded to the local browser through Port Bridge.

## Configuration

### `portBridge.autoStart`

Default: `true`

Starts configured mappings automatically after the remote window starts. Disable it if you prefer starting manually from a command.

### `portBridge.mappings`

Default: `[]`

Configures local-to-remote port mappings. Each mapping is an object, so you can temporarily disable a mapping with `enabled` without deleting it:

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": false,
      "port": 9222
    },
    {
      "name": "web-dev",
      "port": 3000
    }
  ]
}
```

The minimal mapping object is equivalent to:

```json
{
  "enabled": true,
  "name": "port-9222",
  "localHost": "127.0.0.1",
  "localPort": 9222,
  "remoteHost": "127.0.0.1",
  "remotePort": 9222,
  "remoteSocket": "/tmp/vscode-port-bridge/port-9222.sock"
}
```

Object mappings can override the name, host, ports, and socket path:

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "enabled": true,
      "localHost": "127.0.0.1",
      "localPort": 9222,
      "remoteHost": "127.0.0.1",
      "remotePort": 39222,
      "remoteSocket": "/tmp/vscode-port-bridge/chrome-cdp.sock"
    }
  ]
}
```

Fields:

- `enabled`: whether this mapping is active; defaults to `true`. Set it to `false` to keep but skip the mapping.
- `name`: mapping name; defaults to `port-<localPort>`.
- `port`: shorthand used for `localPort` and the default `remotePort`.
- `localHost`: local target host; defaults to `127.0.0.1`.
- `localPort`: local target port; falls back to `port`.
- `remoteHost`: remote TCP listen address; defaults to `127.0.0.1`.
- `remotePort`: remote TCP listen port; falls back to `port`, then `localPort`.
- `remoteSocket`: remote Unix socket path; defaults to `/tmp/vscode-port-bridge/<name>.sock`.

By default Port Bridge creates both a remote TCP listener and a remote Unix socket. The Unix socket exists only in the remote filesystem and has a smaller exposure surface; the remote TCP port is useful for tools that only support `host:port`.

### `portBridge.controlReconnectDelayMs`

Default: `1000`

Delay, in milliseconds, before the remote extension recreates the internal control tunnel after it is closed.

## Commands

The Remote extension contributes:

```text
Port Bridge: Start Remote
Port Bridge: Stop Remote
Port Bridge: Restart Remote
Port Bridge: Reconnect Control Channel
Port Bridge: Show Remote Status
```

The Local extension contributes:

```text
Port Bridge: Show Local Status
```

## How It Works

Data path:

```text
remote process
  -> remote 127.0.0.1:<remotePort> or /tmp/vscode-port-bridge/<name>.sock
  -> port-bridge-remote
  -> VS Code forwarded control tunnel
  -> port-bridge-local
  -> local machine 127.0.0.1:<localPort>
```

`port-bridge-remote` reads `portBridge.mappings`, creates remote TCP listeners and Unix sockets, starts an internal control server, and creates a VS Code tunnel through `vscode.env.asExternalUri()`.

`port-bridge-local` receives the forwarded URI from the remote extension, connects to the control channel, and opens local target connections per session.

HTTP, WebSocket, and CDP traffic are not parsed. They are forwarded as raw TCP bytes.

VS Code's Ports/Forwarded Ports panel may show a random internal control port. It is not a business port. If the user closes that tunnel, the remote extension recreates it after `portBridge.controlReconnectDelayMs`.

More development notes are in [docs/notes.md](docs/notes.md).

## Known Limits

- Both Local and Remote extensions must be installed.
- The current control channel assumes `vscode.env.asExternalUri()` returns a locally reachable TCP URI in desktop Remote/Dev Containers/Remote SSH.
- VS Code for the Web or some cloud tunnel environments may return an HTTPS proxy URI; those environments need additional handling.
- Port Bridge exposes local port capabilities to the remote environment. CDP ports are powerful, so prefer binding the local side to `127.0.0.1`, and prefer remote Unix sockets or remote `127.0.0.1`. Do not bind privileged debug protocols to `0.0.0.0`.

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
artifacts/vsix/port-bridge-local-<version>.vsix
artifacts/vsix/port-bridge-remote-<version>.vsix
```

Publishing notes are in [docs/publish.md](docs/publish.md). Localization and README language rules are in [docs/localization.md](docs/localization.md).

## References

- [Extension host placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [`vscode.env.asExternalUri()` API](https://code.visualstudio.com/api/references/vscode-api)
