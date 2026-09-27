// service/main.ts
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || "0");
var TOKEN = String(process.env.OPENCHAMBER_SERVICE_TOKEN || "");
var DAILY_GRACE_MS = 10 * 60 * 1e3;
var RECHECK_MS = 60 * 1e3;
var BALLOON_TITLE_MAX = 63;
var BALLOON_BODY_MAX = 250;
var homeDir = os.homedir();
var projectsDir = path.join(homeDir, ".config", "openchamber", "projects");
var dataDir = process.env.APPDATA ? path.join(process.env.APPDATA, "openchamber-todo-reminder") : path.join(homeDir, ".openchamber-todo-reminder");
var dataFile = path.join(dataDir, "reminders.json");
var store = { version: 1, items: [] };
var timer = null;
var log = (...args) => console.error("[todo-reminder]", ...args);
async function loadStore() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) store = { version: 1, items: parsed.items };
  } catch (err) {
    if (err && err.code !== "ENOENT") log("load failed:", err.message);
  }
}
async function saveStore() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(store), "utf8");
  } catch (err) {
    log("save failed:", err.message);
  }
}
function todayStr(d = /* @__PURE__ */ new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}
function nextDailyOccurrence(time, now) {
  const t = parseTime(time);
  if (!t) return null;
  const cand = new Date(now);
  cand.setHours(t.hh, t.mm, 0, 0);
  if (cand.getTime() <= now) cand.setDate(cand.getDate() + 1);
  return cand.getTime();
}
function lastDailyOccurrence(time, now) {
  const t = parseTime(time);
  if (!t) return null;
  const cand = new Date(now);
  cand.setHours(t.hh, t.mm, 0, 0);
  if (cand.getTime() > now) cand.setDate(cand.getDate() - 1);
  return cand.getTime();
}
function nextFireOf(item, now) {
  if (item.mode === "once") {
    if (item.firedAt || typeof item.dueAt !== "number") return null;
    return item.dueAt;
  }
  if (item.mode === "daily") {
    return nextDailyOccurrence(item.time, now);
  }
  return null;
}
function truncate(s, max) {
  s = String(s ?? "");
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
async function readTodos(stem) {
  try {
    const raw = await fs.readFile(path.join(projectsDir, String(stem), "context.json"), "utf8");
    const ctx = JSON.parse(raw);
    const todos = Array.isArray(ctx.todos) ? ctx.todos : [];
    return todos.filter((t) => t && !t.completed && typeof t.text === "string" && t.text.trim());
  } catch (err) {
    if (err && err.code !== "ENOENT") log("read todos failed:", err.message);
    return null;
  }
}
async function fileExists(stem) {
  try {
    await fs.stat(path.join(projectsDir, String(stem), "context.json"));
    return true;
  } catch {
    return false;
  }
}
function notify(title, body) {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$icon = New-Object System.Windows.Forms.NotifyIcon",
    "$icon.Icon = [System.Drawing.SystemIcons]::Information",
    "$icon.Visible = $true",
    "$icon.ShowBalloonTip(15000, $env:OC_NOTIFY_TITLE, $env:OC_NOTIFY_BODY, [System.Windows.Forms.ToolTipIcon]::Info)",
    "Start-Sleep -Seconds 16",
    "$icon.Dispose()"
  ].join("; ");
  try {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          OC_NOTIFY_TITLE: truncate(title, BALLOON_TITLE_MAX),
          OC_NOTIFY_BODY: truncate(body, BALLOON_BODY_MAX)
        }
      }
    );
    child.unref();
    if (typeof child.on === "function") child.on("error", (err) => log("notify spawn failed:", err.message));
  } catch (err) {
    log("notify failed:", err.message);
  }
}
function buildBody(todos, unreadable) {
  if (unreadable) return "\u5F85\u529E\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u6253\u5F00\u9762\u677F\u67E5\u770B\u3002";
  if (todos.length === 0) return "\u5F53\u524D\u6CA1\u6709\u672A\u5B8C\u6210\u5F85\u529E\u3002";
  const head = todos.slice(0, 5).map((t, i) => `${i + 1}. ${t.text.trim()}`).join("\n");
  const tail = todos.length > 5 ? `
\u2026\u7B49 ${todos.length} \u6761` : "";
  return `\u672A\u5B8C\u6210 ${todos.length} \u6761\uFF1A
${head}${tail}`;
}
async function fire(item, delayed) {
  const exists = await fileExists(item.stem);
  const todos = exists ? await readTodos(item.stem) : [];
  const title = `\u23F0 \u5F85\u529E\u63D0\u9192 \xB7 ${item.projectLabel || "todo"}${delayed ? "\uFF08\u5EF6\u8FDF\u63D0\u9192\uFF09" : ""}`;
  notify(title, buildBody(todos ?? [], todos === null));
  const now = Date.now();
  if (item.mode === "once") {
    item.firedAt = now;
  } else {
    item.lastFiredOn = todayStr(new Date(now));
  }
  await saveStore();
  log("fired", item.id, delayed ? "(delayed)" : "");
  armTimer();
}
async function fireOverdue(now) {
  let fired = false;
  for (const item of store.items) {
    if (item.mode === "once") {
      if (!item.firedAt && typeof item.dueAt === "number" && item.dueAt <= now) {
        await fire(item, true);
        fired = true;
      }
    } else if (item.mode === "daily") {
      const last = lastDailyOccurrence(item.time, now);
      if (last !== null && now - last <= DAILY_GRACE_MS && item.lastFiredOn !== todayStr(new Date(last))) {
        await fire(item, now - last > 60 * 1e3);
        fired = true;
      }
    }
  }
  return fired;
}
function armTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const now = Date.now();
  let nearest = null;
  for (const item of store.items) {
    const at = nextFireOf(item, now);
    if (at !== null && (nearest === null || at < nearest.at)) nearest = { at, item };
  }
  const delay = nearest ? Math.max(0, Math.min(nearest.at - now, 2 ** 31 - 1)) : RECHECK_MS;
  timer = setTimeout(async () => {
    try {
      const t = Date.now();
      if (nearest && t >= nearest.at) {
        await fire(nearest.item, t - nearest.at > 60 * 1e3);
      } else {
        await fireOverdue(t);
        armTimer();
      }
    } catch (err) {
      log("timer error:", err.message);
      armTimer();
    }
  }, nearest ? delay : RECHECK_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
}
function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function authorized(req) {
  if (!TOKEN) return false;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}
var server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      send(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/reminders/status") {
      const now = Date.now();
      send(res, 200, {
        ok: true,
        running: true,
        count: store.items.length,
        items: store.items.map((i) => ({
          id: i.id,
          mode: i.mode,
          dueAt: i.dueAt ?? null,
          time: i.time ?? null,
          projectLabel: i.projectLabel ?? null,
          stem: i.stem ?? null,
          firedAt: i.firedAt ?? null,
          lastFiredOn: i.lastFiredOn ?? null,
          nextAt: nextFireOf(i, now)
        }))
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/reminders/sync") {
      const body = await readJsonBody(req);
      if (!body || !Array.isArray(body.items)) {
        send(res, 400, { ok: false, error: "items array required" });
        return;
      }
      const prev = new Map(store.items.map((i) => [i.id, i]));
      store.items = body.items.filter((i) => i && typeof i.id === "string" && (i.mode === "once" || i.mode === "daily")).map((i) => {
        const old = prev.get(i.id);
        return {
          id: i.id,
          mode: i.mode,
          dueAt: typeof i.dueAt === "number" ? i.dueAt : void 0,
          time: typeof i.time === "string" ? i.time : void 0,
          projectLabel: typeof i.projectLabel === "string" ? i.projectLabel : "todo",
          stem: typeof i.stem === "string" ? i.stem : "",
          createdAt: typeof i.createdAt === "number" ? i.createdAt : Date.now(),
          firedAt: typeof i.firedAt === "number" ? i.firedAt : old?.firedAt,
          lastFiredOn: typeof i.lastFiredOn === "string" ? i.lastFiredOn : old?.lastFiredOn
        };
      });
      await saveStore();
      const now = Date.now();
      await fireOverdue(now);
      armTimer();
      const next = store.items.map((i) => nextFireOf(i, Date.now())).filter((v) => v !== null);
      send(res, 200, { ok: true, count: store.items.length, nextAt: next.length ? Math.min(...next) : null });
      return;
    }
    if (req.method === "POST" && url.pathname === "/notify/test") {
      const body = await readJsonBody(req).catch(() => ({}));
      notify(typeof body.title === "string" ? body.title : "\u23F0 \u5F85\u529E\u63D0\u9192 \xB7 \u6D4B\u8BD5", typeof body.body === "string" ? body.body : "\u901A\u77E5\u94FE\u8DEF\u6B63\u5E38\u3002");
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    log("request error:", err.message);
    send(res, 400, { ok: false, error: err.message || "bad request" });
  }
});
process.on("unhandledRejection", (err) => log("unhandled rejection:", err && err.message ? err.message : err));
process.on("uncaughtException", (err) => {
  log("uncaught exception:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
async function main() {
  await loadStore();
  await fireOverdue(Date.now());
  armTimer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  log(`listening on 127.0.0.1:${server.address().port}, ${store.items.length} reminder(s) loaded`);
}
main().catch((err) => {
  log("startup failed:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
