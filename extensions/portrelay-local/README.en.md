# PortRelay Local

[Chinese documentation](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-portrelay/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-portrelay/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-portrelay?label=release)](https://github.com/lwmacct/260708-portrelay/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-portrelay)](https://github.com/lwmacct/260708-portrelay/blob/main/LICENSE)

PortRelay Local is the local-machine half of PortRelay. It runs in the VS Code UI extension host and connects to services that only exist on your computer, such as `127.0.0.1:9222`.

Install this extension together with `lwmacct.portrelay-remote`. The local extension does not create remote sockets or remote ports by itself; it waits for the remote extension to create the control tunnel and then forwards raw TCP bytes to local targets.

## What It Does

PortRelay exposes a local-only endpoint inside a VS Code remote workspace:

```text
local machine <local-endpoint>
  -> PortRelay Local
  -> VS Code forwarded control tunnel
  -> PortRelay Remote
  -> remote <remote-endpoint>
```

Typical use cases:

- Use a local Chrome or Chromium CDP endpoint from a Dev Container or Remote SSH workspace.
- Let a remote tool connect to a local development server without binding that server to the network.
- Prefer a remote Unix socket for tools that can use one, while keeping an optional remote TCP listener for `host:port` clients.

## Required Companion Extension

PortRelay is split into two extensions because VS Code has separate local and remote extension hosts:

```text
lwmacct.portrelay-local
  runs locally in the UI extension host
  connects to local <local-endpoint>

lwmacct.portrelay-remote
  runs in the remote workspace extension host
  creates remote sockets and remote TCP listeners
```

Both extensions validate their runtime host during activation. If this extension is forced to run remotely, it stops with an error instead of silently forwarding from the wrong side.

## Configuration

Mappings are configured on the remote side through `portrelay.mappings`. The local extension receives the active mapping list from the remote extension.

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

## Commands

This extension contributes:

```text
PortRelay: Show Local Status
```

The remote companion contributes start, stop, restart, reconnect, and status commands.

## Security Notes

PortRelay moves local capabilities into a remote workspace. Treat forwarded endpoints as sensitive, especially Chrome CDP and other debugging ports.

Recommended defaults:

- Keep local services bound to `127.0.0.1`.
- Keep remote TCP listeners bound to `127.0.0.1`.
- Prefer the generated Unix socket when the remote client supports it.
- Do not expose CDP or other privileged debug protocols on `0.0.0.0`.

## Links

- Repository: https://github.com/lwmacct/260708-portrelay
- Issues: https://github.com/lwmacct/260708-portrelay/issues
- Publishing notes: https://github.com/lwmacct/260708-portrelay/blob/main/docs/publish.md
