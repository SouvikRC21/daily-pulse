// Turns whatever the iPhone Shortcut sends into one clean day record.
// Accepts short keys (steps, kcal, rhr, ...) or the full field names.

export const FIELDS = {
  steps: "int", activeKcal: "num", exerciseMin: "int", standHrs: "int", distanceKm: "num",
  flights: "int", sleepHrs: "num", restingHR: "int", avgHR: "int", maxHR: "int", hrv: "num",
  vo2max: "num", spo2: "num", respRate: "num", weightKg: "num", workoutMin: "int",
  water: "int", energy: "int", workouts: "text", note: "text",
};

export const ALIASES = {
  date: "date", day: "date",
  steps: "steps", step: "steps",
  kcal: "activeKcal", active: "activeKcal", activekcal: "activeKcal", move: "activeKcal", calories: "activeKcal",
  exmin: "exerciseMin", exercise: "exerciseMin", exerciseminutes: "exerciseMin",
  stand: "standHrs", standhours: "standHrs",
  km: "distanceKm", distance: "distanceKm", mi: "distanceMi",
  flights: "flights",
  rhr: "restingHR", resting: "restingHR", restinghr: "restingHR",
  hr: "avgHR", heart: "avgHR", heartrate: "avgHR", avghr: "avgHR", maxhr: "maxHR",
  hrv: "hrv",
  sleep: "sleepHrs", sleephrs: "sleepHrs",
  vo2: "vo2max", vo2max: "vo2max",
  spo2: "spo2", oxygen: "spo2",
  resp: "respRate", resprate: "respRate",
  weight: "weightKg", kg: "weightKg", weightkg: "weightKg", lb: "weightLb",
  workout: "workoutMin", workoutmin: "workoutMin", workouts: "workouts",
  water: "water", energy: "energy", mood: "energy", note: "note",
};

const pad = (n) => String(n).padStart(2, "0");

// "8,432" -> 8432, "7,5" -> 7.5, "512.4 kcal" -> 512.4
export function toNum(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (/,\d{3}(?!\d)/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function toDate(raw) {
  const m = String(raw ?? "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
}

// One flat object of key/value pairs -> { date, values }
export function normalize(input) {
  const values = {};
  let date = null;
  for (const [rawKey, rawVal] of Object.entries(input || {})) {
    const key = ALIASES[rawKey.toLowerCase().replace(/[^a-z0-9]/g, "")] || (FIELDS[rawKey] ? rawKey : null);
    if (!key) continue;
    if (key === "date") { date = toDate(rawVal); continue; }
    if (FIELDS[key] === "text") { const t = String(rawVal ?? "").trim().slice(0, 500); if (t) values[key] = t; continue; }
    let v = toNum(rawVal);
    if (v == null) continue;
    if (key === "sleepHrs") { if (v > 1440) v /= 3600; else if (v > 24) v /= 60; }
    if (key === "spo2" && v <= 1) v *= 100;
    if (key === "distanceMi") { values.distanceKm = round(v * 1.609, 2); continue; }
    if (key === "weightLb") { values.weightKg = round(v * 0.4536, 1); continue; }
    values[key] = FIELDS[key] === "int" ? Math.round(v) : round(v, 2);
  }
  return { date, values };
}

// "date=2026-10-15 steps=8432 kcal=512" (one or more lines) -> { "2026-10-15": {...} }
export function parseText(text, today) {
  const out = {};
  for (const line of String(text).replace(/\r/g, "").split(/[\n;|]+/)) {
    const obj = {};
    for (const m of line.matchAll(/([A-Za-z0-9₂]+)\s*[=:]\s*([^\s=:][^=:]*?)(?=\s+[A-Za-z0-9₂]+\s*[=:]|$)/g)) obj[m[1]] = m[2];
    const { date, values } = normalize(obj);
    if (!Object.keys(values).length) continue;
    const d = date || today;
    out[d] = { ...(out[d] || {}), ...values };
  }
  return out;
}

function round(v, dp) { const f = 10 ** dp; return Math.round(v * f) / f; }
