# AGENTS.md · 给 AI 助手的说明

## 跨机开发日志（重点）

本仓库有**两台电脑**的 AI 助手在改（Windows 端 / macOS 端）。跨机的开发记录放在一个**私有库**里，两边都看得到：

- 私有库：`DDDMUC/repo-devlogs`（private，需 `DDDMUC` 账号权限）
- **它是所有仓库共用的**：一个项目一个文件夹，文件夹名 = 公开库仓库名。本仓库的记录在 `LyricAssistant/` 里
- 首次拉取：
  - `git clone https://github.com/DDDMUC/repo-devlogs.git`
  - 已经拉过的：在该目录 `git pull`

进去后只写自己那份（别写进别人的文件）：

| 机器 | 文件 | 条目前缀 |
| --- | --- | --- |
| Windows | `LyricAssistant/WORKLOG-windows.md` | `[Windows]` |
| macOS | `LyricAssistant/WORKLOG-macos.md` | `[macOS]` |

开工前先读 `LyricAssistant/HANDOFF.md`（交接说明，最新一轮在最上面）。

每条写清楚：**做了什么、动了哪些文件、怎么验证的、有没有遗留问题**。

## 其它约定

- 跨机日志**不要**写进本公开库；`dev-notes/` 已在 `.gitignore` 里，是各机本地草稿，不入库。
- 不要在本文件或任何提交里放 token / 密钥。
- 用户说中文；问句先直接答（是/不是、能/不能），再解释。
- 动手前先拿到明确许可，一次授权只管它指的那一处。
- 宣称完成前跑：`npm run build` 和 `npx vitest run --maxWorkers=2`（当前 36 文件、326 条应全过）。
