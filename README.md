# Local Port Bridge

Expose ports from the local machine into a VS Code remote workspace, including
Dev Containers and Remote SSH workspaces.

This project is for the reverse direction of VS Code's normal port forwarding:

```text
local machine 127.0.0.1:<port>
  -> VS Code remote connection
  -> remote workspace Unix socket or remote loopback TCP port
```

The first target use case is exposing a local browser CDP endpoint such as
`http://127.0.0.1:9222` inside a remote container without opening the browser
debugging port on the network.

## Extension Identity

```text
publisher: lwmacct
name: local-port-bridge
extension id: lwmacct.local-port-bridge
display name: Local Port Bridge
```

Enable proposed API for this extension with:

```json
{
  "enable-proposed-api": [
    "lwmacct.local-port-bridge"
  ]
}
```

On macOS, open this file from VS Code with:

```text
Preferences: Configure Runtime Arguments
```

Then restart VS Code completely.

For one-off development launches:

```bash
code --enable-proposed-api=lwmacct.local-port-bridge
```

## Technical Direction

The model intentionally mirrors `SSH_AUTH_SOCK` forwarding in VS Code Remote:

```text
remote process
  -> /tmp/vscode-local-port-bridge/<name>.sock
  -> remote helper process
  -> VS Code Remote raw stream
  -> UI extension host on the local machine
  -> local machine 127.0.0.1:<port>
```

`SSH_AUTH_SOCK` itself is not magic Unix socket networking. The Unix socket is
only the remote-side entry point. The cross-network portion is VS Code Remote's
existing client/server channel. This project uses the same shape, but for
arbitrary local TCP ports.

## Key VS Code Source Paths

The current investigated VS Code version is:

```text
Version: 1.128.0
Commit: fc3def6774c76082adf699d366f31a557ce5573f
Date: 2026-07-07T15:14:24-07:00
Electron: 42.5.0
Chromium: 148.0.7778.271
Node.js: 24.17.0
OS: Darwin arm64 27.0.0
```

Relevant source files:

- Proposed resolver API:
  https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vscode-dts/vscode.proposed.resolvers.d.ts
- Extension host placement:
  https://code.visualstudio.com/api/advanced-topics/extension-host
- Remote extension guidance:
  https://code.visualstudio.com/api/advanced-topics/remote-extensions
- Proposed API usage:
  https://code.visualstudio.com/api/advanced-topics/using-proposed-api
- Internal managed socket service:
  https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/workbench/api/common/extHostManagedSockets.ts
- Internal main-thread managed socket service:
  https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/workbench/api/browser/mainThreadManagedSockets.ts

The important proposed API is `workspace.getRemoteExecServer(authority)`. In the
`resolvers` proposal it exposes an `ExecServer` that can spawn a process in the
remote environment and exchange raw `Uint8Array` streams with it.

This is better than `commands.executeCommand` for CDP/WebSocket traffic because
commands are JSON-serialized RPC calls. A raw framed byte stream can forward
HTTP and WebSocket without parsing either protocol.

## Current Architecture

Only one VS Code extension is needed for the first implementation:

```text
Local Port Bridge extension
  extensionKind: ["ui"]
  runs on the local VS Code UI side
  connects to local ports with node:net
  uses proposed getRemoteExecServer() to spawn a remote helper

Remote helper
  runs inside the remote workspace, container, or SSH target
  listens on Unix sockets and optional remote TCP ports
  frames accepted connections over stdio to the UI extension
```

This avoids a second workspace extension and avoids SSH/frp/Tailscale/ngrok. The
transport remains the existing VS Code Remote connection.

## Configuration

Example:

```json
{
  "localPortBridge.mappings": [
    {
      "name": "chrome-cdp",
      "localHost": "127.0.0.1",
      "localPort": 9222,
      "remoteSocket": "/tmp/vscode-local-port-bridge/chrome-cdp.sock",
      "remoteHost": "127.0.0.1",
      "remotePort": 9222
    }
  ]
}
```

`remoteSocket` is preferred because it is private to the remote filesystem.
`remotePort` is useful for tools that only accept `host:port`.

## Development

Install and compile:

```bash
pnpm install
pnpm run compile
```

Launch VS Code with proposed API enabled:

```bash
code --enable-proposed-api=lwmacct.local-port-bridge \
  /data/project/260708-vscode-port-bridge/workspace
```

In the extension development host, run:

```text
Local Port Bridge: Start
```

The extension uploads `dist/remote-helper.js` into the remote target under:

```text
/tmp/vscode-local-port-bridge/
```

Then it starts the helper through `workspace.getRemoteExecServer(authority)`.

## Validation Targets

For CDP over Unix socket:

```bash
curl --unix-socket /tmp/vscode-local-port-bridge/chrome-cdp.sock \
  http://localhost/json/version
```

For CDP over remote TCP:

```bash
curl http://127.0.0.1:9222/json/version
```

WebSocket is supported by design because the bridge forwards raw TCP bytes. CDP
handshake and frames are not parsed by the extension.

## Known Constraints

- Requires the VS Code `resolvers` proposed API.
- Requires `enabledApiProposals: ["resolvers"]` in `package.json`.
- Requires `"enable-proposed-api": ["lwmacct.local-port-bridge"]` in VS Code
  runtime arguments or a launch with `--enable-proposed-api`.
- Marketplace distribution is not a normal path while this depends on proposed
  API.
- The bridge exposes local machine capabilities into a remote environment. Treat
  local CDP ports as highly privileged and prefer Unix sockets or remote
  `127.0.0.1` bindings.
