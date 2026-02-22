const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function normalizeDays(workingDays) {
  const n = Math.max(1, Math.min(6, Number(workingDays || 5)));
  return DAY_ORDER.slice(0, n);
}

function groupSlots(slots) {
  const out = {};
  for (const d of DAY_ORDER) out[d] = [];
  for (const s of slots) {
    if (!out[s.day]) out[s.day] = [];
    out[s.day].push(s);
  }
  for (const d of Object.keys(out)) out[d].sort((a, b) => a.period - b.period);
  return out;
}

module.exports = { DAY_ORDER, normalizeDays, groupSlots };
