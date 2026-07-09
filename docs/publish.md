# 发布

本文档记录 Port Bridge 扩展发布到 GitHub Release 和 Visual Studio Marketplace 的流程。

## 相关链接

- VS Code Marketplace 发布文档:
  https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- lwmacct publisher 管理页:
  https://marketplace.visualstudio.com/manage/publishers/lwmacct

## 发布流程

本仓库使用 GitHub Actions 的 `publish` workflow 发布：

- 创建 `v<version>` tag，且 tag 版本必须和根目录及两个扩展的 `package.json` 版本一致。
- `release.yml` 会把 tag 转发给 `publish.yml`。
- `publish.yml` 会校验 tag、执行类型检查、打包 VSIX、发布 GitHub Release。
- 如果 Azure publishing variables 已配置，`publish.yml` 会继续用 Microsoft Entra ID 发布到 Visual Studio Marketplace。
- 如果 Azure publishing variables 未配置，`publish.yml` 会跳过 Visual Studio Marketplace 发布，只发布 GitHub Release。

## Marketplace 身份

Marketplace 发布使用官方推荐的 secure automated publishing：

- GitHub Actions environment: `marketplace`
- optional environment variables:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_SUBSCRIPTION_ID`
- workflow permission: `id-token: write`
- 发布命令: `vsce publish --azure-credential`

需要先在 Azure 中给发布身份配置 federated credential，并把该身份加入 Visual Studio Marketplace publisher `lwmacct`，角色至少为 `Contributor`。

## 本地打包

发布前可以本地打包确认 VSIX：

```bash
pnpm run package
```

输出：

```text
artifacts/vsix/port-bridge-local-<version>.vsix
artifacts/vsix/port-bridge-remote-<version>.vsix
```
