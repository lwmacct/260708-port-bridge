# Port Bridge

[英文文档](README.en.md)

Port Bridge 把本机 `127.0.0.1:<port>` 暴露到 VS Code 远程工作区里，适用于 Dev Containers、Remote SSH 等场景。

它解决的是 VS Code 常规端口转发的反方向：

```text
本机 127.0.0.1:<localPort>
  -> VS Code Remote tunnel
  -> 远程工作区 127.0.0.1:<remotePort> 或 /tmp/vscode-port-bridge/<name>.sock
```

典型用途是让远程容器里的 Playwright、Codex MCP 或其他工具访问本机浏览器的 CDP 端口，同时不需要把本机调试端口开放到网络。

## 安装

Port Bridge 由两个 companion extensions 组成，必须同时安装：

- [Port Bridge Local](https://marketplace.visualstudio.com/items?itemName=lwmacct.port-bridge-local) (`lwmacct.port-bridge-local`)
- [Port Bridge Remote](https://marketplace.visualstudio.com/items?itemName=lwmacct.port-bridge-remote) (`lwmacct.port-bridge-remote`)

两个扩展运行在不同 extension host：

```text
Port Bridge Local
  extensionKind: ["ui"]
  运行在本机 VS Code UI 侧
  负责连接本机 127.0.0.1:<localPort>

Port Bridge Remote
  extensionKind: ["workspace"]
  运行在远程 workspace/container/SSH 侧
  负责创建远程 TCP listener 和 Unix socket
```

如果扩展被手动装错位置，或被 `remote.extensionKind` 覆盖到错误位置，扩展会报错并停止启动。

## 快速开始

在 VS Code 远程窗口的 `settings.json` 中配置要暴露的本机端口：

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

这会把本机 `127.0.0.1:9222` 暴露到远程工作区，并创建：

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/port-9222.sock
```

如果本机 `9222` 是 Chrome CDP 端口，可以在远程终端里验证：

```bash
curl http://127.0.0.1:9222/json/version
```

或通过 Unix socket 验证：

```bash
curl --unix-socket /tmp/vscode-port-bridge/port-9222.sock \
  http://localhost/json/version
```

## Chrome CDP 示例

本机先启动带 CDP 端口的 Chrome 或 Chromium：

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/port-bridge-chrome-profile
```

macOS 可以使用：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/port-bridge-chrome-profile
```

远程工作区配置：

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

远程侧会创建：

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/chrome-cdp.sock
```

远程工作区里的 Playwright 可以直接连接远程地址：

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

如果要让 Codex 通过 Playwright MCP 复用同一个 CDP 转发地址，可以在 Codex `config.toml` 中配置：

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint=http://127.0.0.1:9222"]
```

这里的 MCP server 运行在远程工作区侧，`127.0.0.1:9222` 会通过 Port Bridge 转发到本机浏览器。

## 配置参考

### `portBridge.autoStart`

默认值：`true`

远程窗口启动后自动启动已配置的映射。关闭后可以通过命令手动启动。

### `portBridge.mappings`

默认值：`[]`

配置本机到远程的端口映射。每个映射都是对象，因此可以保留配置并通过 `enabled` 临时禁用：

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

最小映射对象等价于：

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

对象写法支持覆盖名称、host、端口和 socket 路径：

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

字段说明：

- `enabled`: 是否启用此映射，默认 `true`。设为 `false` 时会跳过但保留配置。
- `name`: 映射名称，默认 `port-<localPort>`。
- `port`: 同时作为 `localPort` 和默认 `remotePort`。
- `localHost`: 本机侧要连接的 host，默认 `127.0.0.1`。
- `localPort`: 本机侧要连接的端口；未配置时使用 `port`。
- `remoteHost`: 远程 TCP 监听地址，默认 `127.0.0.1`。
- `remotePort`: 远程 TCP 监听端口；未配置时使用 `port`，再 fallback 到 `localPort`。
- `remoteSocket`: 远程 Unix socket 路径，默认 `/tmp/vscode-port-bridge/<name>.sock`。

默认会同时创建远程 TCP listener 和远程 Unix socket。Unix socket 只存在于远程文件系统中，暴露面比 TCP 端口更小；远程 TCP 端口适合只支持 `host:port` 的工具。

### `portBridge.controlReconnectDelayMs`

默认值：`1000`

内部 control tunnel 被关闭后，remote 扩展等待多久再重新创建。单位是毫秒。

## 命令

Remote 扩展提供：

```text
Port Bridge: Start Remote
Port Bridge: Stop Remote
Port Bridge: Restart Remote
Port Bridge: Reconnect Control Channel
Port Bridge: Show Remote Status
```

Local 扩展提供：

```text
Port Bridge: Show Local Status
```

## 工作原理

数据路径：

```text
远程进程
  -> 远程 127.0.0.1:<remotePort> 或 /tmp/vscode-port-bridge/<name>.sock
  -> port-bridge-remote
  -> VS Code forwarded control tunnel
  -> port-bridge-local
  -> 本机 127.0.0.1:<localPort>
```

`port-bridge-remote` 负责读取 `portBridge.mappings`、创建远程 TCP listener 和 Unix socket、启动内部 control server，并通过 `vscode.env.asExternalUri()` 创建 VS Code tunnel。

`port-bridge-local` 负责接收 remote 扩展传来的 forwarded URI，连接 control channel，并按 session 连接本机目标端口。

HTTP、WebSocket、CDP 都不会被解析，只作为 raw TCP bytes 转发。

VS Code 的 Ports/Forwarded Ports 面板中可能会出现一个随机内部 control port。它不是业务端口。如果用户关闭这个 tunnel，remote 扩展会按 `portBridge.controlReconnectDelayMs` 自动重建。

更多开发过程中的踩坑记录见 [docs/notes.md](docs/notes.md)。

## 已知限制

- 需要同时安装 Local 和 Remote 两个扩展。
- 当前 control channel 假设 `vscode.env.asExternalUri()` 在桌面版 Remote/Dev Containers/Remote SSH 下返回本机可直接 TCP 连接的 URI。
- Web 版 VS Code 或某些 cloud tunnel 环境可能返回 HTTPS 代理 URI，这类环境需要额外适配。
- Port Bridge 会把本机端口能力暴露到远程环境。CDP 端口权限很高，建议优先绑定本机 `127.0.0.1`，远程侧也优先使用 Unix socket 或 `127.0.0.1`，不要绑定到 `0.0.0.0`。

## 开发

安装依赖：

```bash
pnpm install
```

编译：

```bash
pnpm run compile
```

类型检查：

```bash
pnpm run typecheck
```

打包两个 VSIX：

```bash
pnpm run package
```

输出：

```text
artifacts/vsix/port-bridge-local-<version>.vsix
artifacts/vsix/port-bridge-remote-<version>.vsix
```

发布说明见 [docs/publish.md](docs/publish.md)。本地化和 README 语言规则见 [docs/localization.md](docs/localization.md)。

## 相关资料

- [Extension host placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [`vscode.env.asExternalUri()` API](https://code.visualstudio.com/api/references/vscode-api)
