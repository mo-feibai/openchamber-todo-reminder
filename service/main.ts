/**
 * todo-reminder service: holds reminder timers while OpenChamber runs and
 * fires Windows balloon notifications. No dependencies, Node built-ins only.
 *
 * Host contract (manifest apiVersion 1):
 * - Env: OPENCHAMBER_SERVICE_PORT, OPENCHAMBER_SERVICE_TOKEN.
 * - Bind 127.0.0.1 only. Every request (incl. /health) needs
 *   `Authorization: Bearer <token>`. Host polls GET /health until 200.
 * - Panel reaches us only through the host serviceRequest proxy.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || '0');
const TOKEN = String(process.env.OPENCHAMBER_SERVICE_TOKEN || '');
const DAILY_GRACE_MS = 10 * 60 * 1000; // overdue daily reminders fire within this window
const RECHECK_MS = 60 * 1000; // safety net against timer drift/sleep
const BALLOON_TITLE_MAX = 63;
const BALLOON_BODY_MAX = 250;

const homeDir = os.homedir();
const projectsDir = path.join(homeDir, '.config', 'openchamber', 'projects');
const dataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'openchamber-todo-reminder')
  : path.join(homeDir, '.openchamber-todo-reminder');
const dataFile = path.join(dataDir, 'reminders.json');

/** @type {{ version: 1, items: Array<any> }} */
let store = { version: 1, items: [] };
let timer = null;

const log = (...args) => console.error('[todo-reminder]', ...args);

async function loadStore() {
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) store = { version: 1, items: parsed.items };
  } catch (err) {
    if (err && err.code !== 'ENOENT') log('load failed:', err.message);
  }
}

async function saveStore() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(store), 'utf8');
  } catch (err) {
    log('save failed:', err.message);
  }
}

function todayStr(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/** Next daily occurrence strictly after now (local time, DST-safe). */
function nextDailyOccurrence(time, now) {
  const t = parseTime(time);
  if (!t) return null;
  const cand = new Date(now);
  cand.setHours(t.hh, t.mm, 0, 0);
  if (cand.getTime() <= now) cand.setDate(cand.getDate() + 1);
  return cand.getTime();
}

/** Most recent daily occurrence at or before now, or null. */
function lastDailyOccurrence(time, now) {
  const t = parseTime(time);
  if (!t) return null;
  const cand = new Date(now);
  cand.setHours(t.hh, t.mm, 0, 0);
  if (cand.getTime() > now) cand.setDate(cand.getDate() - 1);
  return cand.getTime();
}

function nextFireOf(item, now) {
  if (item.mode === 'once') {
    if (item.firedAt || typeof item.dueAt !== 'number') return null;
    return item.dueAt;
  }
  if (item.mode === 'daily') {
    return nextDailyOccurrence(item.time, now);
  }
  return null;
}

function truncate(s, max) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function readTodos(stem) {
  try {
    const raw = await fs.readFile(path.join(projectsDir, String(stem), 'context.json'), 'utf8');
    const ctx = JSON.parse(raw);
    const todos = Array.isArray(ctx.todos) ? ctx.todos : [];
    return todos.filter((t) => t && !t.completed && typeof t.text === 'string' && t.text.trim());
  } catch (err) {
    if (err && err.code !== 'ENOENT') log('read todos failed:', err.message);
    return null; // null = unreadable (missing file = empty list, handled by caller via exists check)
  }
}

async function fileExists(stem) {
  try {
    await fs.stat(path.join(projectsDir, String(stem), 'context.json'));
    return true;
  } catch {
    return false;
  }
}

function notify(title, body) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$icon = New-Object System.Windows.Forms.NotifyIcon',
    '$icon.Icon = [System.Drawing.SystemIcons]::Information',
    '$icon.Visible = $true',
    '$icon.ShowBalloonTip(15000, $env:OC_NOTIFY_TITLE, $env:OC_NOTIFY_BODY, [System.Windows.Forms.ToolTipIcon]::Info)',
    'Start-Sleep -Seconds 16',
    '$icon.Dispose()',
  ].join('; ');
  try {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          OC_NOTIFY_TITLE: truncate(title, BALLOON_TITLE_MAX),
          OC_NOTIFY_BODY: truncate(body, BALLOON_BODY_MAX),
        },
      },
    );
    child.unref();
    if (typeof child.on === 'function') child.on('error', (err) => log('notify spawn failed:', err.message));
  } catch (err) {
    log('notify failed:', err.message);
  }
}

function buildBody(todos, unreadable) {
  if (unreadable) return '待办读取失败，请打开面板查看。';
  if (todos.length === 0) return '当前没有未完成待办。';
  const head = todos.slice(0, 5).map((t, i) => `${i + 1}. ${t.text.trim()}`).join('\n');
  const tail = todos.length > 5 ? `\n…等 ${todos.length} 条` : '';
  return `未完成 ${todos.length} 条：\n${head}${tail}`;
}

async function fire(item, delayed) {
  const exists = await fileExists(item.stem);
  const todos = exists ? await readTodos(item.stem) : [];
  const title = `⏰ 待办提醒 · ${item.projectLabel || 'todo'}${delayed ? '（延迟提醒）' : ''}`;
  notify(title, buildBody(todos ?? [], todos === null));
  const now = Date.now();
  if (item.mode === 'once') {
    item.firedAt = now;
  } else {
    item.lastFiredOn = todayStr(new Date(now));
  }
  await saveStore();
  log('fired', item.id, delayed ? '(delayed)' : '');
  armTimer();
}

/** Fire overdue items right now (startup / sync). Returns true if anything fired. */
async function fireOverdue(now) {
  let fired = false;
  for (const item of store.items) {
    if (item.mode === 'once') {
      if (!item.firedAt && typeof item.dueAt === 'number' && item.dueAt <= now) {
        await fire(item, true);
        fired = true;
      }
    } else if (item.mode === 'daily') {
      const last = lastDailyOccurrence(item.time, now);
      if (last !== null && now - last <= DAILY_GRACE_MS && item.lastFiredOn !== todayStr(new Date(last))) {
        await fire(item, now - last > 60 * 1000);
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
        await fire(nearest.item, t - nearest.at > 60 * 1000);
      } else {
        await fireOverdue(t); // recheck tick: catch drift/sleep
        armTimer();
      }
    } catch (err) {
      log('timer error:', err.message);
      armTimer();
    }
  }, nearest ? delay : RECHECK_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function authorized(req) {
  if (!TOKEN) return false;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      send(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/reminders/status') {
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
          nextAt: nextFireOf(i, now),
        })),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/reminders/sync') {
      const body = await readJsonBody(req);
      if (!body || !Array.isArray(body.items)) {
        send(res, 400, { ok: false, error: 'items array required' });
        return;
      }
      // Merge by id: keep service-side fired state when the panel copy lacks it,
      // so a reminder fired while the panel was closed is never fired twice.
      const prev = new Map(store.items.map((i) => [i.id, i]));
      store.items = body.items
        .filter((i) => i && typeof i.id === 'string' && (i.mode === 'once' || i.mode === 'daily'))
        .map((i) => {
          const old = prev.get(i.id);
          return {
            id: i.id,
            mode: i.mode,
            dueAt: typeof i.dueAt === 'number' ? i.dueAt : undefined,
            time: typeof i.time === 'string' ? i.time : undefined,
            projectLabel: typeof i.projectLabel === 'string' ? i.projectLabel : 'todo',
            stem: typeof i.stem === 'string' ? i.stem : '',
            createdAt: typeof i.createdAt === 'number' ? i.createdAt : Date.now(),
            firedAt: typeof i.firedAt === 'number' ? i.firedAt : old?.firedAt,
            lastFiredOn: typeof i.lastFiredOn === 'string' ? i.lastFiredOn : old?.lastFiredOn,
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
    if (req.method === 'POST' && url.pathname === '/notify/test') {
      const body = await readJsonBody(req).catch(() => ({}));
      notify(typeof body.title === 'string' ? body.title : '⏰ 待办提醒 · 测试', typeof body.body === 'string' ? body.body : '通知链路正常。');
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log('request error:', err.message);
    send(res, 400, { ok: false, error: err.message || 'bad request' });
  }
});

await loadStore();
await fireOverdue(Date.now());
armTimer();
server.listen(PORT, '127.0.0.1', () => {
  log(`listening on 127.0.0.1:${server.address().port}, ${store.items.length} reminder(s) loaded`);
});
