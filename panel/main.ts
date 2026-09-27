/**
 * todo-reminder panel: visual config + todo viewer, styled with the host kit.
 * The service (not this frame) owns timers and fires OS notifications.
 */
import { connectHost } from '@openchamber/sdk';
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountList,
  mountSelect,
  mountSeparator,
  mountTabs,
  mountText,
  mountTextField,
} from '@openchamber/sdk/ui';

const $ = (id) => document.getElementById(id);
const host = connectHost();

let directory = null;
let sessionTitle = null;
let overrideStem = null;
let reminders = [];
let todos = [];
let mode = 'once';
let minutes = '25';
let clock = '09:00';
let selectedRem = null;

/* ---------- project id <-> context path (mirrors host project-id.js) ---------- */

function normalizeDir(dir) {
  return String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(s) {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function sha256Sync(ascii) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / 2 ** (i * 8)) & 0xff);
  const w = new Array(64);
  for (let c = 0; c < bytes.length; c += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[c + i * 4] << 24) | (bytes[c + i * 4 + 1] << 16) | (bytes[c + i * 4 + 2] << 8) | bytes[c + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c2, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c2) ^ (b & c2);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c2; c2 = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c2) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(s) {
  try {
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return sha256Sync(unescape(encodeURIComponent(s)));
}

async function stemOf(dir) {
  const id = 'path_' + bytesToBase64Url(new TextEncoder().encode(normalizeDir(dir)));
  if (id.length <= 200) return id;
  return 'path_sha256_' + (await sha256Hex(id));
}

function pathFromStem(stem) {
  if (!stem.startsWith('path_') || stem.startsWith('path_sha256_')) return null;
  try {
    return base64UrlToString(stem.slice('path_'.length));
  } catch {
    return null;
  }
}

async function storageKey(stem) {
  const plain = 'reminders:' + stem;
  if (plain.length <= 128) return plain;
  return 'reminders-h:' + (await sha256Hex(stem));
}

const contextFile = (stem) => `~/.config/openchamber/projects/${stem}/context.json`;

function projectLabel(dir) {
  const norm = normalizeDir(dir || '');
  const last = norm.split('/').pop() || 'todo';
  if (/^session-[0-9a-f-]{8,}$/i.test(last) && sessionTitle) return sessionTitle.slice(0, 40);
  return last.slice(0, 40);
}

function uuid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

/* ---------- kit handles (mounted once) ---------- */

let hHead, hSub, hTodos, hPicker, hTabs, hMinutes, hClock, hAdd, hRemsHead, hRems;
let hSelDesc, hDel, hTest, hRefresh, hErr;

function mountChrome() {
  hHead = mountText($('head'), { text: '待办提醒' });
  hSub = mountText($('sub'), { text: '' });
  hTodos = mountList($('todos'), { items: [], onSelect: () => {}, emptyText: '暂无未完成待办', ariaLabel: '待办列表' });
  mountSeparator($('sep1'), {});
  hTabs = mountTabs($('tabs'), {
    items: [{ id: 'once', label: '单次' }, { id: 'daily', label: '每天' }],
    activeId: mode,
    onChange: (id) => {
      mode = id;
      hTabs.update({ activeId: id }); // kit 不自切高亮，受控模式必须显式同步
      $('onceRow').hidden = id !== 'once';
      $('dailyRow').hidden = id !== 'daily';
    },
  });
  hMinutes = mountTextField($('minutesField'), { value: minutes, onChange: (v) => { minutes = v; }, helper: 'N 分钟后提醒一次' });
  hClock = mountTextField($('clockField'), { value: clock, onChange: (v) => { clock = v; }, helper: '每天固定时刻 (HH:mm)', mono: true });
  hAdd = mountButton($('addRow'), { label: '开始', variant: 'default', onClick: () => addReminder() });
  mountSeparator($('sep2'), {});
  hRemsHead = mountText($('remsHead'), { text: '已有提醒' });
  hRems = mountList($('rems'), { items: [], onSelect: (id) => selectReminder(id), emptyText: '暂无提醒', ariaLabel: '提醒列表' });
  hSelDesc = mountText($('selDesc'), { text: '' });
  hDel = mountButton($('delBtn'), { label: '取消该提醒', variant: 'destructive', size: 'sm', onClick: () => deleteSelected() });
  hTest = mountButton($('footRow'), { label: '发送测试通知', variant: 'secondary', size: 'sm', onClick: () => testNotify() });
  hRefresh = mountButton($('footRow'), { label: '刷新', variant: 'ghost', size: 'sm', onClick: () => refresh() });
}

function showError(msg) {
  $('errSlot').innerHTML = '';
  if (hErr) { try { hErr.dispose(); } catch { /* ignore */ } hErr = null; }
  if (msg) hErr = mountBanner($('errSlot'), { tone: 'error', title: '出错了', body: msg });
}

/* ---------- host calls ---------- */

async function readTodos(stem) {
  try {
    const { content } = await host.readFile(contextFile(stem));
    const ctx = JSON.parse(content);
    const list = Array.isArray(ctx.todos) ? ctx.todos : [];
    return list.filter((t) => t && !t.completed && typeof t.text === 'string' && t.text.trim());
  } catch (e) {
    if (e && (e.code === 'NOT_FOUND' || /NOT_FOUND/.test(String(e.message)))) return [];
    throw e;
  }
}

async function syncToService() {
  const keys = await host.storage.keys();
  const all = [];
  for (const k of keys) {
    if (!k.startsWith('reminders:') && !k.startsWith('reminders-h:')) continue;
    const v = await host.storage.get(k);
    if (v && Array.isArray(v.items)) all.push(...v.items);
  }
  /*
   * The host validates `body` as a JSON *string* (GuestRequest.body?: string)
   * and silently drops a message that fails its schema — which surfaces as
   * HOST_TIMEOUT twenty seconds later. Always stringify.
   */
  try {
    const res = await host.serviceRequest({ method: 'POST', path: '/reminders/sync', body: JSON.stringify({ items: all }) });
    if (res && res.status >= 400) {
      throw new Error(`service ${res.status} ${String(res.body || '').slice(0, 120)}`);
    }
  } catch (e) {
    throw new Error(`同步到本地服务失败 (${e && e.code ? e.code : e})。请确认扩展已获批“运行本地服务”。`);
  }
  try {
    // GuestRequestResult carries the service answer as a JSON string.
    const res = await host.serviceRequest({ method: 'GET', path: '/reminders/status' });
    const st = res && res.body ? JSON.parse(res.body) : null;
    if (st && Array.isArray(st.items)) {
      const state = new Map(st.items.map((i) => [i.id, i]));
      for (const k of keys) {
        if (!k.startsWith('reminders:') && !k.startsWith('reminders-h:')) continue;
        const v = await host.storage.get(k);
        if (!v || !Array.isArray(v.items)) continue;
        let dirty = false;
        for (const it of v.items) {
          const s = state.get(it.id);
          if (!s) continue;
          if (typeof s.firedAt === 'number' && s.firedAt !== it.firedAt) { it.firedAt = s.firedAt; dirty = true; }
          if (typeof s.lastFiredOn === 'string' && s.lastFiredOn !== it.lastFiredOn) { it.lastFiredOn = s.lastFiredOn; dirty = true; }
        }
        if (dirty) await host.storage.set(k, v);
      }
    }
    return st;
  } catch {
    return null;
  }
}

/* ---------- render ---------- */

function fmtRemain(ms) {
  if (ms < 0) return '已过期';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return `剩余 ${m} 分钟`;
  return `剩余 ${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

function remDesc(r, now) {
  if (r.mode === 'once') {
    if (r.firedAt) return '单次 · 已触发';
    return `单次 · ${fmtRemain((r.dueAt || 0) - now)}`;
  }
  const n = nextAtOf(r, now);
  return n ? `每天 · ${r.time}（${fmtRemain(n - now)}）` : `每天 · ${r.time || '??:??'}`;
}

function nextAtOf(r, now) {
  if (r.mode === 'once') return !r.firedAt && typeof r.dueAt === 'number' ? r.dueAt : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(r.time || '');
  if (!m) return null;
  const c = new Date(now);
  c.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (c.getTime() <= now) c.setDate(c.getDate() + 1);
  return c.getTime();
}

function paintLists() {
  const now = Date.now();
  hTodos.update({
    items: todos.slice(0, 30).map((t, i) => ({ id: `t${i}`, title: t.text.trim() })),
  });
  hRems.update({
    items: reminders.map((r) => ({
      id: r.id,
      title: remDesc(r, now),
      meta: r.projectLabel || '',
    })),
    selectedId: selectedRem,
  });
}

async function refresh() {
  showError('');
  try {
    const stem = overrideStem || (directory ? await stemOf(directory) : null);
    if (!stem) {
      hHead.update({ text: '待办提醒' });
      hSub.update({ text: '未打开目录' });
      todos = [];
      reminders = [];
    } else {
      todos = await readTodos(stem);
      const label = overrideStem ? ((pathFromStem(stem) || stem).split('/').pop() || stem) : projectLabel(directory);
      hHead.update({ text: label });
      hSub.update({ text: todos.length ? `未完成 ${todos.length} 条` : '当前没有未完成待办' });
      const key = await storageKey(stem);
      const v = await host.storage.get(key);
      reminders = v && Array.isArray(v.items) ? v.items : [];
    }
    paintLists();
    paintSelection();
    const st = await syncToService().catch((e) => { showError(e.message); return null; });
    if (st) {
      $('svc').textContent = `服务运行中 · ${st.count} 条`;
      const key2 = stem ? await storageKey(stem) : null;
      if (key2) {
        const v2 = await host.storage.get(key2);
        if (v2 && Array.isArray(v2.items)) { reminders = v2.items; paintLists(); paintSelection(); }
      }
    } else if (!$('errSlot').textContent) {
      $('svc').textContent = '服务未就绪';
    } else {
      $('svc').textContent = '';
    }
  } catch (e) {
    showError(`读取失败：${e && e.message ? e.message : e}`);
  }
}

function paintSelection() {
  const r = reminders.find((x) => x.id === selectedRem);
  $('selRow').hidden = !r;
  if (r) hSelDesc.update({ text: `${remDesc(r, Date.now())} · ${r.projectLabel || ''}` });
}

function selectReminder(id) {
  selectedRem = selectedRem === id ? null : id; // tap again to deselect
  hRems.update({ selectedId: selectedRem });
  paintSelection();
}

async function deleteSelected() {
  if (!selectedRem) return;
  reminders = reminders.filter((x) => x.id !== selectedRem);
  selectedRem = null;
  const stem = overrideStem || (directory ? await stemOf(directory) : null);
  if (stem) await host.storage.set(await storageKey(stem), { version: 1, items: reminders });
  await refresh();
}

/* ---------- actions ---------- */

async function addReminder() {
  showError('');
  const stem = overrideStem || (directory ? await stemOf(directory) : null);
  if (!stem) { showError('当前没有可用的目录，请先打开一个项目或手动选择。'); return; }
  const label = overrideStem ? (((pathFromStem(stem) || stem).split('/').pop()) || 'todo') : projectLabel(directory);
  if (mode === 'once') {
    const mins = Math.max(1, Math.min(1440, Number(minutes) || 0));
    if (!mins) { showError('请填写有效的分钟数。'); return; }
    reminders.push({ id: uuid(), mode: 'once', dueAt: Date.now() + mins * 60000, projectLabel: label, stem, createdAt: Date.now(), firedAt: null });
  } else {
    if (!/^(\d{1,2}):(\d{2})$/.test(clock.trim())) { showError('时间格式应为 HH:mm，例如 09:30。'); return; }
    reminders.push({ id: uuid(), mode: 'daily', time: clock.trim(), projectLabel: label, stem, createdAt: Date.now(), lastFiredOn: null });
  }
  await host.storage.set(await storageKey(stem), { version: 1, items: reminders });
  await refresh();
}

async function testNotify() {
  showError('');
  try {
    await host.serviceRequest({ method: 'POST', path: '/notify/test', body: JSON.stringify({ title: '⏰ 待办提醒 · 测试', body: '通知链路正常。面板关闭后提醒仍会弹出。' }) });
  } catch (e) {
    showError(`测试失败：${e && e.message ? e.message : e}`);
  }
}

async function fillPicker() {
  try {
    const { entries } = await host.listDir('~/.config/openchamber/projects');
    const opts = entries
      .filter((e) => e.kind === 'directory' && e.name.startsWith('path_'))
      .map((e) => ({ stem: e.name, label: pathFromStem(e.name) || e.name }));
    if (!opts.length) return;
    hPicker = mountSelect($('picker'), {
      value: null,
      placeholder: '（当前目录）',
      options: [{ id: '', label: '（当前目录）' }, ...opts.slice(0, 100).map((o) => ({
        id: o.stem,
        label: o.label.length > 50 ? '…' + o.label.slice(-49) : o.label,
      }))],
      onChange: async (id) => {
        overrideStem = id || null;
        await refresh();
      },
    });
    $('pickerSlot').hidden = false;
  } catch { /* picker stays hidden */ }
}

/* ---------- boot ---------- */

async function onReadySnapshot(ctx) {
  applyHostReady(ctx, document.documentElement);
  directory = (ctx && ctx.directory) || null;
  sessionTitle = (ctx && ctx.session && ctx.session.title) || null;
}

async function boot() {
  mountChrome();
  const ready = await new Promise((resolve) => { host.onReady(resolve); });
  await onReadySnapshot(ready);
  try {
    await host.onReady((ctx) => { onReadySnapshot(ctx).then(() => refresh().catch(() => {})); });
  } catch { /* ignore */ }
  await fillPicker();
  await refresh();
  try { await host.onDirectory(async (d) => { directory = d; overrideStem = null; if (hPicker) hPicker.update({ value: null }); await refresh(); }); } catch { /* ignore */ }
  try { await host.onSession(async (s) => { sessionTitle = (s && s.title) || null; await refresh(); }); } catch { /* ignore */ }
  setInterval(() => { paintLists(); }, 5000);
  window.addEventListener('focus', () => { refresh().catch(() => {}); });
  window.addEventListener('beforeunload', () => { try { host.dispose(); } catch { /* ignore */ } });
}

boot().catch((e) => showError(`启动失败：${e && e.message ? e.message : e}`));
