# Port Relay Local

[英文文档](https://github.com/lwmacct/260708-portrelay/blob/main/extensions/portrelay-local/README.en.md)

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-portrelay/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-portrelay/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-portrelay?label=release)](https://github.com/lwmacct/260708-portrelay/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-portrelay)](https://github.com/lwmacct/260708-portrelay/blob/main/LICENSE)

Port Relay Local 是 Port Relay 的本机侧扩展。它运行在 VS Code 的 UI extension host 中，负责连接只存在于本机的服务，例如 `127.0.0.1:9222`。

请将它与 `lwmacct.portrelay-remote` 一起安装。Local 扩展本身不会创建远程 socket 或远程端口；它会等待 Remote 扩展创建控制 tunnel，然后把原始 TCP 字节转发到本机目标服务。

## 功能

Port Relay 可以把一个仅本机可访问的端点暴露到 VS Code 远程工作区内：

```text
本机 <local-endpoint>
  -> Port Relay Local
  -> VS Code forwarded control tunnel
  -> Port Relay Remote
  -> 远程 <remote-endpoint>
```

典型场景：

- 在 Dev Container 或 Remote SSH 工作区中访问本机 Chrome/Chromium CDP 端点。
- 让远程工具连接本机开发服务，而不需要把本机服务暴露到网络上。
- 远程工具支持 Unix socket 时，使用稳定的远程 socket 路径，同时保留可选的远程 TCP listener。

## 必需的配套扩展

Port Relay 拆分为两个扩展，因为 VS Code 有独立的本机和远程 extension host：

```text
lwmacct.portrelay-local
  运行在本机 UI extension host
  连接本机 <local-endpoint>

lwmacct.portrelay-remote
  运行在远程 workspace extension host
  创建远程 socket 和远程 TCP listener
```

两个扩展都会在激活时检查运行位置。如果 Local 扩展被强制放到远程运行，它会报错并停止，避免从错误的一侧转发流量。

## 配置

映射配置在远程侧的 `portrelay.mappings` 中维护。Local 扩展会从 Remote 扩展接收当前生效的映射列表。

最小远程工作区配置：

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

这会把本机 `127.0.0.1:9222` 暴露到远程工作区：

```text
127.0.0.1:9222
```

命名映射：

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

高级映射：

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

## 命令

此扩展贡献：

```text
Port Relay: 显示本机状态
```

远程配套扩展提供启动、停止、重启、重连和状态命令。

## 安全说明

Port Relay 会把本机能力带入远程工作区。请把被转发的端点视为敏感资源，尤其是 Chrome CDP 和其他调试端口。

建议默认做法：

- 让本机服务绑定到 `127.0.0.1`。
- 让远程 TCP listener 绑定到 `127.0.0.1`。
- 远程客户端支持 Unix socket 时优先使用生成的 socket。
- 不要把 CDP 或其他高权限调试协议暴露到 `0.0.0.0`。

## 链接

- Repository: https://github.com/lwmacct/260708-portrelay
- Issues: https://github.com/lwmacct/260708-portrelay/issues
- Publishing notes: https://github.com/lwmacct/260708-portrelay/blob/main/docs/publish.md
