# Local Port Bridge

Local Port Bridge 用于把本机端口暴露到 VS Code 远程工作区，包括 Dev Containers 和 Remote SSH。

它解决的是 VS Code 常规端口转发的反方向：

```text
本机 127.0.0.1:<port>
  -> VS Code Remote 连接
  -> 远程工作区 Unix socket 或远程 127.0.0.1:<port>
```

典型场景是把本机浏览器 CDP 地址暴露到远程容器里：

```text
本机 http://127.0.0.1:9222
  -> 远程容器 /tmp/vscode-local-port-bridge/chrome-cdp.sock
  -> 远程容器 http://127.0.0.1:9222
```

这样不需要把浏览器调试端口开放到网络上。

## 扩展信息

```text
publisher: lwmacct
name: local-port-bridge
extension id: lwmacct.local-port-bridge
display name: Local Port Bridge
```

## 必须启用 Proposed API

当前实现依赖 VS Code 的 `resolvers` proposed API，必须显式启用，否则扩展无法调用：

```ts
vscode.workspace.getRemoteExecServer(authority)
```

扩展自身已经在 `package.json` 中声明：

```json
{
  "enabledApiProposals": [
    "resolvers"
  ]
}
```

但 VS Code 运行时还需要允许这个扩展使用 proposed API。

### 持久配置

在 VS Code 命令面板执行：

```text
Preferences: Configure Runtime Arguments
```

加入：

```json
{
  "enable-proposed-api": [
    "lwmacct.local-port-bridge"
  ]
}
```

保存后必须完全退出 VS Code，再重新打开。

### 临时启动

也可以用命令行临时启用：

```bash
code --enable-proposed-api=lwmacct.local-port-bridge
```

打开指定工作区：

```bash
code --enable-proposed-api=lwmacct.local-port-bridge \
  /data/project/260708-vscode-port-bridge/workspace
```

如果没有正确启用，通常会看到类似错误：

```text
Extension 'lwmacct.local-port-bridge' CANNOT use API proposal: resolvers
```

## 使用配置

在 VS Code `settings.json` 中配置映射：

```json
{
  "localPortBridge.autoStart": true,
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

字段说明：

- `name`: 映射名称，必须稳定且唯一。
- `localHost`: 本机侧要连接的 host，默认 `127.0.0.1`。
- `localPort`: 本机侧要连接的端口。
- `remoteSocket`: 在远程工作区创建的 Unix socket 路径。
- `remoteHost`: 远程 TCP 监听地址，默认 `127.0.0.1`。
- `remotePort`: 远程 TCP 监听端口。

`remoteSocket` 和 `remotePort` 至少配置一个。

推荐优先使用 `remoteSocket`，因为它只存在于远程文件系统中，暴露面比 TCP 端口更小。`remotePort` 适合只支持 `host:port` 的工具。

### 只暴露 Unix Socket

```json
{
  "localPortBridge.mappings": [
    {
      "name": "chrome-cdp",
      "localHost": "127.0.0.1",
      "localPort": 9222,
      "remoteSocket": "/tmp/vscode-local-port-bridge/chrome-cdp.sock"
    }
  ]
}
```

远程容器里验证：

```bash
curl --unix-socket /tmp/vscode-local-port-bridge/chrome-cdp.sock \
  http://localhost/json/version
```

### 暴露为远程 TCP 端口

```json
{
  "localPortBridge.mappings": [
    {
      "name": "chrome-cdp",
      "localHost": "127.0.0.1",
      "localPort": 9222,
      "remoteHost": "127.0.0.1",
      "remotePort": 9222
    }
  ]
}
```

远程容器里验证：

```bash
curl http://127.0.0.1:9222/json/version
```

如果远程环境里已经有服务占用了 `9222`，可以换成：

```json
{
  "remotePort": 39222
}
```

然后访问：

```bash
curl http://127.0.0.1:39222/json/version
```

## 命令

扩展提供这些命令：

```text
Local Port Bridge: Start
Local Port Bridge: Stop
Local Port Bridge: Restart
Local Port Bridge: Show Status
```

如果 `localPortBridge.autoStart` 为 `true`，扩展会在 VS Code 启动后自动启动映射。

## 技术方向

这个项目的模型刻意对齐 VS Code Remote 中 `SSH_AUTH_SOCK` 的转发方式：

```text
远程进程
  -> /tmp/vscode-local-port-bridge/<name>.sock
  -> 远程 helper 进程
  -> VS Code Remote raw stream
  -> 本机 UI extension host
  -> 本机 127.0.0.1:<port>
```

`SSH_AUTH_SOCK` 不是让 Unix socket 自己跨网络。Unix socket 只是远程侧入口；真正跨网络的是 VS Code Remote 已经存在的 client/server 通道。本项目复用相同形态，但目标是任意本机 TCP 端口。

当前实现只需要一个 VS Code 扩展：

```text
Local Port Bridge extension
  extensionKind: ["ui"]
  运行在本机 VS Code UI 侧
  用 node:net 连接本机端口
  用 proposed getRemoteExecServer() 启动远程 helper

Remote helper
  运行在远程工作区、容器或 SSH 目标中
  监听 Unix socket 和可选远程 TCP 端口
  通过 stdio 与 UI extension 交换二进制帧
```

它不需要第二个 workspace extension，也不需要 SSH/frp/Tailscale/ngrok。传输层仍然是当前 VS Code Remote 连接。

WebSocket 是支持的，因为扩展转发的是 raw TCP 字节流，不解析 HTTP、WebSocket 或 CDP 协议。

## 关键 VS Code 源码路径

当前探索基于这个 VS Code 版本：

```text
Version: 1.128.0
Commit: fc3def6774c76082adf699d366f31a557ce5573f
Date: 2026-07-07T15:14:24-07:00
Electron: 42.5.0
Chromium: 148.0.7778.271
Node.js: 24.17.0
OS: Darwin arm64 27.0.0
```

相关资料：

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

关键 API 是 `workspace.getRemoteExecServer(authority)`。在 `resolvers` proposal 里，它暴露 `ExecServer`，可以在远程环境启动进程，并通过 `Uint8Array` stream 与该进程交换原始字节。

这比 `commands.executeCommand` 更适合 CDP/WebSocket，因为 command RPC 会走 JSON 序列化，而 raw stream 可以直接转发 HTTP 和 WebSocket。

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

打包 VSIX：

```bash
pnpm run package
```

运行扩展开发宿主时，需要用启用了 proposed API 的 VS Code：

```bash
code --enable-proposed-api=lwmacct.local-port-bridge \
  /data/project/260708-vscode-port-bridge/workspace
```

扩展启动后会把 `dist/remote-helper.js` 上传到远程目标：

```text
/tmp/vscode-local-port-bridge/
```

然后通过 `workspace.getRemoteExecServer(authority)` 启动它。

## 已知限制

- 需要 VS Code `resolvers` proposed API。
- 需要 `package.json` 中声明 `enabledApiProposals: ["resolvers"]`。
- 需要在 VS Code runtime arguments 中配置 `"enable-proposed-api": ["lwmacct.local-port-bridge"]`，或用 `--enable-proposed-api` 启动。
- 依赖 proposed API 时，扩展不适合走普通 Marketplace 分发。
- 这个桥接会把本机能力暴露到远程环境。CDP 端口权限很高，优先使用 Unix socket 或远程 `127.0.0.1` 绑定，不要绑定到 `0.0.0.0`。

