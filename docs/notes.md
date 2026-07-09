# 踩坑和尝试记录

本文档记录 PortRelay 开发过程中遇到的 VS Code Remote extension host、Proposed API 和 tunnel 生命周期相关问题。

## remote 扩展不能依赖 local 扩展

remote 扩展不能用 `extensionDependencies` 依赖 local 扩展。

`extensionDependencies` 会要求依赖扩展在当前激活环境中已加载；跨 UI host 和 workspace host 时会导致 remote 扩展激活失败。

当前实现只在建立 control channel 时调用 local 扩展命令。如果 local 未安装或未启用，会给出明确错误。

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

## 内部 control tunnel 会被用户关闭

启动后，远程容器里会多出一个随机监听端口，例如：

```text
127.0.0.1:37469
```

这是内部 control server，不是业务端口。它用于连接 `portrelay-remote` 和 `portrelay-local`：

```text
portrelay-remote 127.0.0.1:<random-control-port>
  -> VS Code forwarded port
  -> portrelay-local
```

这个端口是通过 `vscode.env.asExternalUri()` 创建的 VS Code tunnel，所以会出现在 VS Code Ports/Forwarded Ports 里。VS Code 官方 API 说明这类 tunnel 的生命周期由编辑器管理，用户可以关闭它。

如果用户误关这个随机 control port：

- 已有连接会断开。
- remote 扩展会在 `portrelay.controlReconnectDelayMs` 后自动重新创建 tunnel。
- 也可以执行 `PortRelay: Reconnect Control Channel` 手动重连。
- remote 状态栏项点击后也会触发重连。

默认重连延迟：

```json
{
  "portrelay.controlReconnectDelayMs": 1000
}
```
