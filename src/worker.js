// Daily Pulse API. Static files in /public are served by Cloudflare before this runs;
// everything under /api lands here.
import { normalize, parseText, toDate, FIELDS } from "./normalize.js";

const DEFAULT_GOALS = { move: 500, exercise: 30, stand: 12, steps: 10000, sleep: 8 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      if (!env.SYNC_TOKEN) return json({ error: "SYNC_TOKEN secret is not set on the server. See README." }, 500);
      await ensureSchema(env);
      if (!authorized(request, url, env.SYNC_TOKEN)) return json({ error: "Wrong or missing token." }, 401);
      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case "POST /api/sync": return await sync(request, env);
        case "GET /api/days": return await listDays(url, env);
        case "POST /api/days": return await writeDays(request, env);
        case "GET /api/settings": return json({ goals: await getGoals(env) });
        case "PUT /api/settings": return await putSettings(request, env);
        case "GET /api/report": return json({ report: await report(env, toDate(url.searchParams.get("date")) || today(env)) });
        default: return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500);
    }
  },
};

// Creates the tables on first use, so setup needs no database console step.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

// ---- auth ----
function authorized(request, url, token) {
  const h = request.headers.get("authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7).trim() : (url.searchParams.get("token") || "");
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ---- routes ----

// The iPhone Shortcut posts here every evening. Body can be JSON
// ({"date":"2026-10-15","steps":8432,...}) or text ("date=2026-10-15 steps=8432 ...").
async function sync(request, env) {
  const type = request.headers.get("content-type") || "";
  const body = await request.text();
  let days = {};
  if (type.includes("json") || body.trim().startsWith("{")) {
    let obj;
    try { obj = JSON.parse(body); } catch { throw httpError(400, "Body is not valid JSON."); }
    const { date, values } = normalize(obj);
    if (Object.keys(values).length) days[date || today(env)] = values;
  } else {
    days = parseText(body, today(env));
  }
  const dates = Object.keys(days);
  if (!dates.length) throw httpError(400, "No numbers found. Send fields like steps, kcal, rhr, hrv, sleep.");
  for (const d of dates) await upsert(env, d, days[d]);
  const last = [...dates].sort().pop();
  return json({ ok: true, saved: dates, report: await report(env, last) });
}

async function listDays(url, env) {
  const from = toDate(url.searchParams.get("from")) || "0000-00-00";
  const { results } = await env.DB.prepare("SELECT date, data FROM days WHERE date >= ? ORDER BY date").bind(from).all();
  const days = {};
  for (const r of results) days[r.date] = JSON.parse(r.data);
  return json({ days });
}

// Bulk write from the web page: Health export import, manual edits, deletes (value null).
async function writeDays(request, env) {
  const { days, replace } = await request.json().catch(() => ({}));
  if (!days || typeof days !== "object") throw httpError(400, "Expected {days: {...}}");
  const entries = Object.entries(days);
  if (entries.length > 5000) throw httpError(413, "Too many days in one request. Send at most 5000.");
  const stmts = [];
  for (const [rawDate, v] of entries) {
    const d = toDate(rawDate);
    if (!d) continue;
    if (v === null) { stmts.push(env.DB.prepare("DELETE FROM days WHERE date = ?").bind(d)); continue; }
    const clean = cleanRecord(v);
    if (replace) stmts.push(env.DB.prepare("INSERT INTO days (date, data, updated) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(d, JSON.stringify(clean), Date.now()));
    else stmts.push(await mergeStmt(env, d, clean));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return json({ ok: true, count: stmts.length });
}

async function putSettings(request, env) {
  const { goals } = await request.json().catch(() => ({}));
  const g = { ...DEFAULT_GOALS };
  for (const k of Object.keys(DEFAULT_GOALS)) { const n = Number(goals?.[k]); if (n > 0) g[k] = n; }
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('goals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(g)).run();
  return json({ ok: true, goals: g });
}

// ---- storage helpers ----
function cleanRecord(v) {
  const out = {};
  for (const [k, val] of Object.entries(v || {})) {
    if (!FIELDS[k] || val === "" || val == null) continue;
    if (FIELDS[k] === "text") out[k] = String(val).slice(0, 500);
    else if (Number.isFinite(Number(val))) out[k] = Number(val);
  }
  return out;
}

async function mergeStmt(env, date, values) {
  const row = await env.DB.prepare("SELECT data FROM days WHERE date = ?").bind(date).first();
  const merged = { ...(row ? JSON.parse(row.data) : {}), ...values };
  return env.DB.prepare("INSERT INTO days (date, data, updated) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated = excluded.updated")
    .bind(date, JSON.stringify(merged), Date.now());
}

async function upsert(env, date, values) {
  await (await mergeStmt(env, date, cleanRecord(values))).run();
}

async function getGoals(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'goals'").first();
  return { ...DEFAULT_GOALS, ...(row ? JSON.parse(row.value) : {}) };
}

// ---- the short daily report the Shortcut shows as a notification ----
export async function report(env, date) {
  const row = await env.DB.prepare("SELECT data FROM days WHERE date = ?").bind(date).first();
  if (!row) return `No data for ${date} yet.`;
  const d = JSON.parse(row.data);
  const g = await getGoals(env);
  const since = shiftDate(date, -30);
  const { results } = await env.DB.prepare("SELECT data FROM days WHERE date >= ? AND date < ?").bind(since, date).all();
  const hist = results.map((r) => JSON.parse(r.data));
  const avg = (k) => { const v = hist.map((h) => h[k]).filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return buildReport(d, g, { restingHR: avg("restingHR"), hrv: avg("hrv") });
}

export function buildReport(d, g, base) {
  const parts = [];
  const n = (v) => Math.round(v).toLocaleString("en-US");
  if (d.steps != null) parts.push(`${n(d.steps)} steps (${Math.round((d.steps / g.steps) * 100)}%)`);
  if (d.activeKcal != null) parts.push(`${n(d.activeKcal)} kcal`);
  if (d.exerciseMin != null) parts.push(`${n(d.exerciseMin)} exercise min`);
  if (d.restingHR != null) parts.push(`resting HR ${n(d.restingHR)}${base.restingHR ? ` (usual ${n(base.restingHR)})` : ""}`);
  if (d.hrv != null) parts.push(`HRV ${n(d.hrv)} ms`);
  if (d.sleepHrs != null) parts.push(`sleep ${d.sleepHrs.toFixed(1)} h`);
  const score = readiness(d, g, base);
  return (score != null ? `Readiness ${score}. ` : "") + (parts.length ? parts.join(" · ") : "Saved.");
}

// Same formula as the web page: HRV 40%, resting HR 30%, sleep 30%, against your own baseline.
export function readiness(d, g, base) {
  const p = [];
  if (d.hrv != null && base.hrv) { const r = clamp(d.hrv / base.hrv, 0.6, 1.4); p.push([0.4, (r - 0.6) / 0.8]); }
  if (d.restingHR != null && base.restingHR) { const r = clamp(base.restingHR / d.restingHR, 0.85, 1.15); p.push([0.3, (r - 0.85) / 0.3]); }
  if (d.sleepHrs != null) p.push([0.3, Math.min(d.sleepHrs / g.sleep, 1)]);
  if (!p.length) return null;
  const w = p.reduce((a, x) => a + x[0], 0);
  return Math.round((100 * p.reduce((a, x) => a + x[0] * x[1], 0)) / w);
}

// ---- small utils ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function shiftDate(d, n) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function today(env) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function cors(res) {
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-allow-headers", "authorization, content-type");
  res.headers.set("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
  return res;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }));
}
