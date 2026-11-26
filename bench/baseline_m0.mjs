// M0 baseline: time the exact request the current app makes on search
// (src/submitAPI.js -> Wikipedia REST page summary), for 10 common drug names.
// Usage: node bench/baseline_m0.mjs [rounds]   (default 3 rounds, sequential, 1 s apart)
// Measures network + JSON parse time from Node, not browser render time.

const NAMES = [
  'aspirin', 'ibuprofen', 'acetaminophen', 'caffeine', 'metformin',
  'atorvastatin', 'amoxicillin', 'omeprazole', 'lisinopril', 'penicillin',
];
const ROUNDS = Number(process.argv[2] ?? 3);
const UA = 'MolLookUp-audit/0.1 (baseline latency benchmark)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const name of NAMES) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const t0 = performance.now();
    let status = 0;
    let ok = false;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      status = res.status;
      const body = await res.json();
      ok = res.ok && typeof body.extract === 'string';
    } catch {
      status = -1;
    }
    rows.push({ round, name, status, ok, ms: performance.now() - t0 });
    await sleep(1000);
  }
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const stats = (arr) => ({
  n: arr.length,
  mean: arr.reduce((a, b) => a + b, 0) / arr.length,
  p50: pct(arr, 50),
  p95: pct(arr, 95),
  min: Math.min(...arr),
  max: Math.max(...arr),
});
const fmt = (s) =>
  `n=${s.n} mean=${s.mean.toFixed(1)} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} min=${s.min.toFixed(1)} max=${s.max.toFixed(1)} (ms)`;

for (const r of rows) console.log(`${r.round}\t${r.name}\t${r.status}\t${r.ok}\t${r.ms.toFixed(1)}`);
console.log('ALL      ', fmt(stats(rows.map((r) => r.ms))));
console.log('ROUND 1  ', fmt(stats(rows.filter((r) => r.round === 1).map((r) => r.ms))));
console.log('ROUNDS 2+', fmt(stats(rows.filter((r) => r.round > 1).map((r) => r.ms))));
console.log(`failures: ${rows.filter((r) => !r.ok).length}/${rows.length}`);
console.log(`date: ${new Date().toISOString()}  node: ${process.version}  platform: ${process.platform}`);
