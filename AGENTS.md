# AGENTS.md — openchamber-todo-reminder

## 发布

- 每次改动面板/service/manifest 后必须 bump `package.json` 的 `version`，否则宿主检测不到更新（只推代码不升版本 = 用户侧无更新）。
- 提交信息单行格式：`:sparkles: feat(提醒): <中文描述>`。

## 构建（本机无 bun，勿用官方 bunx 脚本）

- `npm run build` = 面板 `esbuild --bundle --format=iife --platform=browser --minify` +
  服务 `esbuild --bundle --format=esm --platform=node --packages=external`。
- 安装前两个 `main.js` 必须已存在，否则报 `missing-build`；面板产物不得含 ESM `import`。
- `package.json` 必须保留 `"type": "module"`（service/main.js 是 ESM）。

## Manifest 红线（宿主 OpenChamber 2.0.2，SDK 2.0.2，apiVersion/wire 均为 1）

- `panel.id/name/icon` 必填；`icon` 只能用宿主内置 sprite 的 88 个短名（已用 `timer`，`alarm-line` 会渲染为空白）。
- 权限只有两项：`filesystem: ["~/.config/openchamber/projects/**"]` + `service: { entry, runtime: "host" }`；`capabilities` 为空。改 glob 会触发重新批准。
- `engines.openchamber: ">=2.0.2"`。

## 目录 → 待办文件的推导（与宿主 project-id.js 逐字一致）

`normalize = dir.replace(/\\/g,'/').replace(/\/+$/,'')` → `id = 'path_'+base64url(utf8)` →
`stem = id.length<=200 ? id : 'path_sha256_'+sha256hex(id)` → `~/.config/.../projects/<stem>/context.json`。
必须用宿主给的 `ctx.directory` 原串；读路径用正斜杠（反斜杠 = BAD_PATH）；`NOT_FOUND` 当空清单。

## Service 契约

- Env `OPENCHAMBER_SERVICE_PORT/TOKEN`；只绑 127.0.0.1；所有请求（含 `/health`）验 Bearer；就绪靠 `GET /health` → 200。
- 面板 → `serviceRequest` 代理；面板永远见不到 token/端口。
- 面板是配置源，service 是触发源；sync 按 id 合并，service 侧 `firedAt/lastFiredOn` 优先（防面板关闭期间重复触发）。
- 通知走 inbox PowerShell `NotifyIcon` 气球：标题 ≤63 字、正文 ≤250 字，无点击回调。
- `onReady` 会多次触发：面板每次重建前先清定时器/订阅，注意 32 订阅上限与 `dispose()`。

## Storage

`host.storage` 只有 get/set/delete/keys（无 scan）；键 ≤128 字符，超长用 `reminders-h:<sha256>`；单值 ≤64KiB。
