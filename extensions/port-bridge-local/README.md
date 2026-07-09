# Port Bridge Local

[Chinese documentation](https://github.com/lwmacct/260708-port-bridge/blob/main/extensions/port-bridge-local/README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-port-bridge/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-port-bridge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-port-bridge?label=release)](https://github.com/lwmacct/260708-port-bridge/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-port-bridge)](https://github.com/lwmacct/260708-port-bridge/blob/main/LICENSE)

Port Bridge Local is the local-machine half of Port Bridge. It runs in the VS Code UI extension host and connects to services that only exist on your computer, such as `127.0.0.1:9222`.

Install this extension together with `lwmacct.port-bridge-remote`. The local extension does not create remote sockets or remote ports by itself; it waits for the remote extension to create the control tunnel and then forwards raw TCP bytes to local targets.

## What It Does

Port Bridge exposes a local-only port inside a VS Code remote workspace:

```text
local machine 127.0.0.1:<localPort>
  -> Port Bridge Local
  -> VS Code forwarded control tunnel
  -> Port Bridge Remote
  -> remote 127.0.0.1:<remotePort>
  -> remote Unix socket
```

Typical use cases:

- Use a local Chrome or Chromium CDP endpoint from a Dev Container or Remote SSH workspace.
- Let a remote tool connect to a local development server without binding that server to the network.
- Prefer a remote Unix socket for tools that can use one, while keeping an optional remote TCP listener for `host:port` clients.

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

Both extensions validate their runtime host during activation. If this extension is forced to run remotely, it stops with an error instead of silently forwarding from the wrong side.

## Configuration

Mappings are configured on the remote side through `portBridge.mappings`. The local extension receives the active mapping list from the remote extension.

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

## Commands

This extension contributes:

```text
Port Bridge: Show Local Status
```

The remote companion contributes start, stop, restart, reconnect, and status commands.

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
