CREATE TABLE IF NOT EXISTS days (
  date    TEXT PRIMARY KEY,   -- YYYY-MM-DD, your local date
  data    TEXT NOT NULL,      -- JSON: steps, activeKcal, restingHR, hrv, sleepHrs, ...
  updated INTEGER NOT NULL    -- ms since epoch
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
