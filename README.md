# Port Bridge

Port Bridge 用于把本机端口暴露到 VS Code 远程工作区，包括 Dev Containers 和 Remote SSH。

它解决的是 VS Code 常规端口转发的反方向：

```text
本机 127.0.0.1:<port>
  -> VS Code Remote tunnel
  -> 远程工作区 Unix socket 或远程 127.0.0.1:<port>
```

典型场景是把本机浏览器 CDP 地址暴露到远程容器里：

```text
本机 http://127.0.0.1:9222
  -> 远程容器 /tmp/vscode-port-bridge/chrome-cdp.sock
  -> 远程容器 http://127.0.0.1:9222
```

这样不需要把浏览器调试端口开放到网络上。

## 扩展组成

本项目现在由两个 companion extensions 组成：

```text
lwmacct.port-bridge-local
  目录: extensions/port-bridge-local
  extensionKind: ["ui"]
  运行在本机 VS Code UI 侧
  负责连接本机 127.0.0.1:<localPort>

lwmacct.port-bridge-remote
  目录: extensions/port-bridge-remote
  extensionKind: ["workspace"]
  运行在远程 workspace/container/SSH 侧
  负责创建远程 Unix socket 和远程 127.0.0.1:<remotePort>
```

必须两个扩展一起安装。原因是本机端口只能由 local 侧访问，远程 socket/端口只能由 remote 侧创建，单个 extension host 无法同时看到两边。

两个扩展都声明了固定运行位置，并且启动时会做运行环境校验：

```text
port-bridge-local  必须运行在本机 UI extension host
port-bridge-remote 必须运行在远程 workspace extension host
```

如果用户手动装错位置，或用 `remote.extensionKind` 覆盖导致运行位置错误，扩展会报错并停止启动。

注意：remote 扩展不能用 `extensionDependencies` 依赖 local 扩展。`extensionDependencies` 会要求依赖扩展在当前激活环境中已加载；跨 UI host 和 workspace host 时会导致 remote 扩展激活失败。当前实现只在建立 control channel 时调用 local 扩展命令，如果 local 未安装或未启用，会给出明确错误。

## 不再需要 Proposed API

旧实现尝试使用：

```ts
vscode.workspace.getRemoteExecServer(authority)
```

但 Dev Containers 的 `attached-container+...` authority 不会给普通扩展暴露 `ExecServer`，会返回 `undefined`。

当前实现改为：

```text
remote extension
  -> 在远程启动 control TCP server
  -> vscode.env.asExternalUri(http://127.0.0.1:<controlPort>)
  -> VS Code 建立远程端口转发
  -> local extension 连接 forwarded local URI
```

因此当前版本不需要：

```bash
code --enable-proposed-api=...
```

也不需要 `enabledApiProposals`。

## 工作原理

数据路径：

```text
远程进程
  -> /tmp/vscode-port-bridge/<name>.sock
  -> port-bridge-remote
  -> VS Code forwarded control port
  -> port-bridge-local
  -> 本机 127.0.0.1:<localPort>
```

`port-bridge-remote` 负责：

- 读取 `portBridge.mappings`
- 创建远程 Unix socket
- 创建可选的远程 TCP listener
- 启动一个远程 control server
- 通过 `vscode.env.asExternalUri()` 把 control server 转发到本机
- 通知 local 扩展连接这个 forwarded URI
- 如果 control tunnel 被用户关闭，自动重新创建并通知 local 扩展重连

`port-bridge-local` 负责：

- 接收 remote 扩展传来的 forwarded URI
- 连接 control channel
- 按 session 连接本机目标端口
- 双向转发原始 TCP 字节流

HTTP、WebSocket、CDP 都不被解析，只作为 raw TCP bytes 转发。

## 内部 Control Channel

启动后，远程容器里会多出一个随机监听端口，例如：

```text
127.0.0.1:37469
```

这是内部 control server，不是业务端口。它用于连接 `port-bridge-remote` 和 `port-bridge-local`：

```text
port-bridge-remote 127.0.0.1:<random-control-port>
  -> VS Code forwarded port
  -> port-bridge-local
```

这个端口是通过 `vscode.env.asExternalUri()` 创建的 VS Code tunnel，所以会出现在 VS Code Ports/Forwarded Ports 里。VS Code 官方 API 说明这类 tunnel 的生命周期由编辑器管理，用户可以关闭它。

如果你误关了这个随机 control port：

- 已有连接会断开。
- remote 扩展会在 `portBridge.controlReconnectDelayMs` 后自动重新创建 tunnel。
- 也可以执行 `Port Bridge: Reconnect Control Channel` 手动重连。
- remote 状态栏项点击后也会触发重连。

默认重连延迟：

```json
{
  "portBridge.controlReconnectDelayMs": 1000
}
```

## 使用配置

在 VS Code `settings.json` 中配置映射。最小配置只需要写端口号：

```json
{
  "portBridge.autoStart": true,
  "portBridge.mappings": [9222]
}
```

上面的配置会暴露本机 `127.0.0.1:9222`，并在远程侧创建：

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/port-9222.sock
```

如果需要稳定命名，例如 Chrome CDP，使用对象简写：

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

这会在远程侧创建：

```text
127.0.0.1:9222
/tmp/vscode-port-bridge/chrome-cdp.sock
```

字段说明：

- `number`: 端口号简写，例如 `9222`。
- `name`: 映射名称，建议稳定且唯一；默认 `port-<localPort>`。
- `port`: 同时作为 `localPort` 和默认 `remotePort`。
- `localHost`: 本机侧要连接的 host，默认 `127.0.0.1`。
- `localPort`: 本机侧要连接的端口；未配置时使用 `port`。
- `remoteHost`: 远程 TCP 监听地址，默认 `127.0.0.1`。
- `remotePort`: 远程 TCP 监听端口；未配置时使用 `port`，再 fallback 到 `localPort`。
- `remoteSocket`: 远程 Unix socket 路径，默认 `/tmp/vscode-port-bridge/<name>.sock`。

默认会同时创建远程 TCP listener 和远程 Unix socket。Unix socket 只存在于远程文件系统中，暴露面比 TCP 端口更小；远程 TCP 端口适合只支持 `host:port` 的工具。

### 高级配置

如果远程环境里已经有服务占用了 `9222`，可以只改远程端口：

```json
{
  "portBridge.mappings": [
    {
      "name": "chrome-cdp",
      "localPort": 9222,
      "remotePort": 39222
    }
  ]
}
```

这会把本机 `127.0.0.1:9222` 暴露为远程 `127.0.0.1:39222`，同时创建默认 socket `/tmp/vscode-port-bridge/chrome-cdp.sock`。

也可以完整覆盖 host、端口和 socket 路径：

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

远程容器里验证：

```bash
curl http://127.0.0.1:39222/json/version
```

或使用 Unix socket：

```bash
curl --unix-socket /tmp/vscode-port-bridge/chrome-cdp.sock \
  http://localhost/json/version
```

### Playwright CDP 转发示例

本机先启动带 CDP 端口的 Chromium/Chrome：

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

VS Code 远程工作区配置：

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

远程容器或 SSH 工作区里验证 CDP 已经转发成功：

```bash
curl http://127.0.0.1:9222/json/version
```

然后在远程工作区里用 Playwright 连接这个 CDP 地址：

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

运行：

```bash
node cdp-example.js
```

这里的 Playwright 进程运行在远程环境里，但 `http://127.0.0.1:9222` 实际会通过 Port Bridge 连接到本机浏览器的 CDP 端口。

如果要让 Codex 通过 Playwright MCP 复用同一个 CDP 转发地址，可以在 Codex `config.toml` 中配置：

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint=http://127.0.0.1:9222"]
```

此时 Playwright MCP server 运行在远程工作区侧，`--cdp-endpoint` 指向的是远程 `127.0.0.1:9222`，最终会通过 Port Bridge 转发到本机浏览器。

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

如果 `portBridge.autoStart` 为 `true`，remote 扩展会在远程窗口启动后自动启动映射，并通知 local 扩展建立 control channel。

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

## 发布

VS Code Marketplace 官方发布文档：

https://code.visualstudio.com/api/working-with-extensions/publishing-extension

本仓库使用 GitHub Actions 的 `publish` workflow 发布：

- 创建 `v<version>` tag，且 tag 版本必须和根目录及两个扩展的 `package.json` 版本一致。
- `release.yml` 会把 tag 转发给 `publish.yml`。
- `publish.yml` 会校验 tag、执行类型检查、打包 VSIX、发布 GitHub Release，然后用 Microsoft Entra ID 发布到 Visual Studio Marketplace。

Marketplace 发布使用官方推荐的 secure automated publishing：

- GitHub Actions environment: `marketplace`
- optional environment variables:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_SUBSCRIPTION_ID`
- workflow permission: `id-token: write`
- 发布命令: `vsce publish --azure-credential`

如果上面的 Azure variables 未配置，workflow 会跳过 Visual Studio Marketplace 发布，只发布 GitHub Release。

需要先在 Azure 中给发布身份配置 federated credential，并把该身份加入 Visual Studio Marketplace publisher `lwmacct`，角色至少为 `Contributor`。

## 关键 VS Code API

- `extensionKind: ["ui"]`: local 扩展运行在本机 UI extension host。
- `extensionKind: ["workspace"]`: remote 扩展运行在远程 extension host。
- `vscode.env.asExternalUri()`: remote 扩展把远程 control port 转成可被本机访问的 forwarded URI。
- `vscode.commands.executeCommand()`: remote 扩展只用它通知 local 扩展 control URI，不用它传输数据流。

相关资料：

- Extension host placement:
  https://code.visualstudio.com/api/advanced-topics/extension-host
- Remote extension guidance:
  https://code.visualstudio.com/api/advanced-topics/remote-extensions
- `asExternalUri` API:
  https://code.visualstudio.com/api/references/vscode-api

## 已知限制

- 需要同时安装 `lwmacct.port-bridge-local` 和 `lwmacct.port-bridge-remote`。
- 当前 control channel 假设 `asExternalUri()` 在桌面版 Remote/Dev Containers 下返回本机可直接 TCP 连接的 URI。
- Web 版 VS Code 或某些 cloud tunnel 环境可能返回 HTTPS 代理 URI，这种环境需要额外适配。
- 这个桥接会把本机能力暴露到远程环境。CDP 端口权限很高，优先使用 Unix socket 或远程 `127.0.0.1` 绑定，不要绑定到 `0.0.0.0`。
