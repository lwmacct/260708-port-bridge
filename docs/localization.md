# Localization and README Language Policy

本文档记录 PortRelay 的语言策略、VS Code 扩展展示限制，以及当前实现依据。

## 目标

- `README.md` 使用中文，作为 GitHub 默认入口和 VS Code Marketplace 扩展详情入口。
- 英文文档作为副语言，单独放在同目录的 `README.en.md`。
- VS Code 编辑器内可本地化的扩展 manifest 文本使用 `package.nls*.json`。
- 不依赖 Marketplace 或 VS Code 扩展详情页自动选择英文 README。

## 当前文件约定

根目录：

```text
README.md
README.en.md
```

扩展目录：

```text
extensions/portrelay-local/README.md
extensions/portrelay-local/README.en.md
extensions/portrelay-remote/README.md
extensions/portrelay-remote/README.en.md
```

扩展 manifest 本地化文件：

```text
extensions/portrelay-local/package.nls.json
extensions/portrelay-local/package.nls.zh-cn.json
extensions/portrelay-remote/package.nls.json
extensions/portrelay-remote/package.nls.zh-cn.json
```

## VS Code 显示语言

VS Code 的 UI 显示语言由编辑器本身控制。用户可以通过 `Configure Display Language` 命令选择显示语言，通常需要安装对应 Language Pack。

这会影响 VS Code 自身 UI，以及扩展 manifest 中通过 NLS 机制声明的文本，例如：

- extension `description`
- command `title`
- configuration `description`

当前仓库通过以下形式声明 manifest 本地化：

```json
{
  "description": "%extension.description%"
}
```

默认英文文本写在 `package.nls.json`，简体中文文本写在 `package.nls.zh-cn.json`。

## Marketplace 和 README

VS Code Marketplace 的扩展详情内容来自扩展包中的 `README.md`。当前没有在本仓库中采用“按用户 locale 自动选择不同 README 文件”的发布路径。

因此本仓库采用明确规则：

- `README.md` 始终是中文。
- `README.en.md` 是英文副语言版本。
- 中文 README 顶部链接英文文档。
- 英文 README 顶部链接中文文档。

这保证 GitHub、Marketplace、VSIX 本地安装场景都有稳定的默认中文入口，同时英文用户可以通过显式链接进入英文说明。

## 打包验证要点

发布前需要确认：

- `package.nls.json` 和 `package.nls.zh-cn.json` 被包含在 VSIX 中。
- VSIX manifest 中短描述解析为默认英文，而不是保留 `%...%` 占位符。
- `README.md` 为中文。
- `README.en.md` 未被 `.vscodeignore` 排除。

可用以下命令验证：

```bash
pnpm -r --filter './extensions/*' run typecheck
pnpm -r --filter './extensions/*' run compile
pnpm --dir extensions/portrelay-local exec vsce package --allow-missing-repository --out ../../artifacts/vsix/portrelay-local-check.vsix
pnpm --dir extensions/portrelay-remote exec vsce package --allow-missing-repository --out ../../artifacts/vsix/portrelay-remote-check.vsix
unzip -p artifacts/vsix/portrelay-local-check.vsix extension.vsixmanifest
unzip -p artifacts/vsix/portrelay-remote-check.vsix extension.vsixmanifest
```

检查完成后删除临时 `*-check.vsix` 文件。

## 参考依据

- VS Code Display Language:
  https://code.visualstudio.com/docs/configure/locales
- VS Code extension publishing and README packaging:
  https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- VS Code extension manifest:
  https://code.visualstudio.com/api/references/extension-manifest
- Microsoft `vscode-extension-samples` l10n sample:
  https://github.com/microsoft/vscode-extension-samples/tree/main/l10n-sample

## 结论

扩展展示可以分成两类处理：

- 编辑器内短文本：用 `package.nls*.json` 随 VS Code 显示语言切换。
- 长文档/详情页：`README.md` 用中文，英文放入 `README.en.md` 并显式链接。
