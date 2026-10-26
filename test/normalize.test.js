import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseText, toNum } from "../src/normalize.js";
import { buildReport, readiness } from "../src/worker.js";

test("numbers from Shortcuts in different locales", () => {
  assert.equal(toNum("8,432"), 8432);
  assert.equal(toNum("7,5"), 7.5);
  assert.equal(toNum("512.4 kcal"), 512.4);
  assert.equal(toNum(""), null);
});

test("JSON body with short keys", () => {
  const { date, values } = normalize({ date: "2026-10-26", steps: "9,120", kcal: 540.3, rhr: 57.6, hrv: "48", sleep: 432, mi: 3 });
  assert.equal(date, "2026-10-26");
  assert.deepEqual(values, { steps: 9120, activeKcal: 540.3, restingHR: 58, hrv: 48, sleepHrs: 7.2, distanceKm: 4.83 });
});

test("sleep given in seconds or hours", () => {
  assert.equal(normalize({ sleep: 25920 }).values.sleepHrs, 7.2);
  assert.equal(normalize({ sleep: 6.5 }).values.sleepHrs, 6.5);
});

test("text lines, with and without dates", () => {
  const out = parseText("date=2026-10-25 steps=100\nsteps=200 kcal=10", "2026-10-26");
  assert.deepEqual(out, { "2026-10-25": { steps: 100 }, "2026-10-26": { steps: 200, activeKcal: 10 } });
});

test("unknown keys are ignored", () => {
  assert.deepEqual(normalize({ foo: 1, steps: 5 }).values, { steps: 5 });
});

test("report and readiness", () => {
  const g = { move: 500, exercise: 30, stand: 12, steps: 10000, sleep: 8 };
  assert.equal(readiness({ hrv: 50, restingHR: 60, sleepHrs: 8 }, g, { hrv: 50, restingHR: 60 }), 65);
  const r = buildReport({ steps: 8432, activeKcal: 512, restingHR: 58, sleepHrs: 7.2 }, g, { restingHR: 60 });
  assert.match(r, /^Readiness \d+\. 8,432 steps \(84%\) · 512 kcal · resting HR 58 \(usual 60\) · sleep 7\.2 h$/);
});
