function nextId(prefix, existing) {
  const nums = existing
    .map((v) => {
      const m = String(v || "").match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    })
    .filter((n) => Number.isFinite(n));

  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

module.exports = { nextId };
