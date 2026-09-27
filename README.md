# openchamber-todo-reminder

OpenChamber 扩展：给右侧栏待办加倒计时 / 每天提醒。面板负责可视化配置，常驻本地 service 负责守表，到点发 Windows 系统通知 —— 面板关了照样响（OpenChamber 开着即可）。

## 安装

1. `npm install`（需联网，装 `@openchamber/sdk` + `esbuild`），`npm run build`。
2. OpenChamber → 设置 → 扩展 → 粘贴本目录路径 → 添加。
3. 批准两项权限（读写项目外文件、运行本地服务）→ 启用。侧栏出现 ⏱ 图标。

## 使用

1. 点 ⏱ 打开面板，确认看到当前目录的未完成待办。
2. 点「发送测试通知」收到系统通知 = 链路正常。
3. 「单次」填 N 分钟 → 开始；「每天」填 `HH:mm` → 开始。面板可以关掉。
4. 列表可取消。OpenChamber 关了提醒全停；重开后过期的单次补一条"延迟提醒"，每天的跳到下一天。

## 行为

- 单次：到点提醒一次；面板没开时到点 → 下次同步/打开面板时补"延迟提醒"。
- 每天：每天固定时刻一次；迟到 10 分钟内补发，超过则跳到明天。
- 到点时实时重读待办文件；正文列前 5 条（气球上限约 250 字）。
- 待办只读不写（`~/.config/openchamber/projects/<stem>/context.json`），新增/勾选仍在 OpenChamber 里做。

## 结构

```
package.json        manifest（openchamber 块）+ 构建脚本
panel/index.html    面板页面
panel/main.ts       面板源码 → panel/main.js（浏览器 IIFE，esbuild）
service/main.ts     服务源码 → service/main.js（Node ESM，esbuild --node 等价参数）
```

## 卸载

扩展卡片「停用」暂停（数据保留）；「移除」删除全部提醒数据。
