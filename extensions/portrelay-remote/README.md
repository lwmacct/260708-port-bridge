# Port Relay Remote

[英文文档](https://github.com/lwmacct/260708-portrelay/blob/main/extensions/portrelay-remote/README.en.md)

[![CI](https://img.shields.io/github/actions/workflow/status/lwmacct/260708-portrelay/ci.yml?branch=main&label=ci)](https://github.com/lwmacct/260708-portrelay/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lwmacct/260708-portrelay?label=release)](https://github.com/lwmacct/260708-portrelay/releases)
[![License](https://img.shields.io/github/license/lwmacct/260708-portrelay)](https://github.com/lwmacct/260708-portrelay/blob/main/LICENSE)

Port Relay Remote 是 Port Relay 的远程工作区侧扩展。它运行在 VS Code 的 workspace extension host 中，负责创建远程 TCP listener 和 Unix socket，并把流量转发到本机端点。

请将它与 `lwmacct.portrelay-local` 一起安装。Remote 扩展负责读取配置、启动转发、创建内部控制 tunnel，并要求 Local 扩展回连到本机目标服务。

## 功能

Port Relay 可以把一个仅本机可访问的端点暴露到 VS Code 远程工作区内：

```text
远程进程
  -> 远程 <remote-endpoint>
  -> Port Relay Remote
  -> VS Code forwarded control tunnel
  -> Port Relay Local
  -> 本机 <local-endpoint>
```

典型场景：

- 让 Dev Container 中的 Playwright 连接本机运行的 Chrome。
- 让远程工具调用本机开发服务，而不需要把本机服务公开到网络上。
- 为支持 socket 的远程工具提供稳定的远程 Unix socket 路径。

HTTP、WebSocket、CDP 和其他协议都会按原始 TCP 字节转发。Port Relay 不解析也不终止这些协议。

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

两个扩展都会在激活时检查运行位置。如果 Remote 扩展被强制放到本机运行，或在非远程窗口中运行，它会报错并停止，避免在错误的一侧创建 listener。

## 配置

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

字段说明：

- `enabled`: 是否启用此映射，默认 `true`。设为 `false` 时会跳过但保留配置。
- `name`: 稳定的映射名称；未配置时基于第一个本机端点和远程端点生成。
- `local`: 本机目标端点，或按顺序尝试的 fallback 端点数组。
- `remote`: 要创建的远程入口，或远程入口数组。

端点格式支持 `127.0.0.1:9222`、`tcp:127.0.0.1:9222`、`tcp://127.0.0.1:9222` 和 `unix:/tmp/name.sock`。

## Chrome CDP 示例

在本机启动 Chrome：

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/portrelay-chrome-profile
```

配置远程工作区：

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

在远程工作区中验证：

```bash
curl http://127.0.0.1:9222/json/version
curl --unix-socket /tmp/portrelay/chrome-cdp.sock http://localhost/json/version
```

在远程工作区中使用 Playwright：

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

## 命令

此扩展贡献：

```text
Port Relay: 启动远程转发
Port Relay: 停止远程转发
Port Relay: 重启远程转发
Port Relay: 重连控制通道
Port Relay: 显示远程状态
```

如果 `portrelay.autoStart` 为 `true`，映射会在远程窗口启动后自动启动。

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
