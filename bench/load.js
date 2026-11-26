// SPEC §5 benchmark 2: k6 load test against an API running with CACHE_ONLY=true, so a cache miss
// returns 503 instead of calling PubChem. This test never sends load to PubChem.
//
// Four steps, each its own scenario so it gets its own numbers: 10, 50, 100, 200 virtual users,
// STEP_SECONDS each, 10 s apart. Closed loop with no think time: every VU sends its next request as
// soon as the previous one returns (a worst case, not a model of human browsing).
// Queries are the 180 found names from bench/compounds.txt (warmed by bench/latency.mjs).
//
// Run (k6 in Docker, API on the host):
//   docker run --rm -v "${PWD}/bench:/bench" -e BASE_URL=http://host.docker.internal:3201 grafana/k6:1.8.2 run /bench/load.js

import { check } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3201';
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 60);
const STEPS = [10, 50, 100, 200];

const names = open('./compounds.txt')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .slice(0, 180); // the deliberate misspellings (last 20) are excluded

const scenarios = {};
const thresholds = {};
STEPS.forEach((vus, i) => {
  const name = `vus_${vus}`;
  scenarios[name] = {
    executor: 'constant-vus',
    vus,
    duration: `${STEP_SECONDS}s`,
    startTime: `${i * (STEP_SECONDS + 10)}s`,
    gracefulStop: '5s',
  };
  // Thresholds on tagged sub-metrics make k6 report each step separately; limits here are loose
  // on purpose: the point is to record numbers, and the run fails only if a step mostly errors.
  thresholds[`http_req_duration{scenario:${name}}`] = ['p(50)>=0', 'p(95)>=0'];
  thresholds[`http_req_failed{scenario:${name}}`] = ['rate<0.5'];
  thresholds[`http_reqs{scenario:${name}}`] = ['count>=0'];
});

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  const q = names[Math.floor(Math.random() * names.length)];
  const res = http.get(`${BASE_URL}/api/compounds/search?q=${encodeURIComponent(q)}`, {
    tags: { name: 'search' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'served from cache': (r) => r.headers['X-Cache'] === 'redis' || r.headers['X-Cache'] === 'db',
  });
}

export function handleSummary(data) {
  const rows = STEPS.map((vus) => {
    const name = `vus_${vus}`;
    const d = data.metrics[`http_req_duration{scenario:${name}}`]?.values ?? {};
    const f = data.metrics[`http_req_failed{scenario:${name}}`]?.values ?? {};
    const r = data.metrics[`http_reqs{scenario:${name}}`]?.values ?? {};
    return {
      vus,
      requests: r.count ?? 0,
      rps: (r.count ?? 0) / STEP_SECONDS,
      p50Ms: d.med,
      p95Ms: d['p(95)'],
      p99Ms: d['p(99)'],
      maxMs: d.max,
      errorRate: f.rate,
    };
  });
  const md = [
    '| VUs | requests | req/s | p50 ms | p95 ms | p99 ms | error rate |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (x) =>
        `| ${x.vus} | ${x.requests} | ${x.rps.toFixed(0)} | ${x.p50Ms?.toFixed(1)} | ${x.p95Ms?.toFixed(1)} | ${x.p99Ms?.toFixed(1)} | ${((x.errorRate ?? 0) * 100).toFixed(2)}% |`,
    ),
  ].join('\n');
  return {
    stdout: `\n${md}\n`,
    '/bench/results/k6-summary.json': JSON.stringify(
      { date: new Date().toISOString(), baseUrl: BASE_URL, stepSeconds: STEP_SECONDS, steps: rows, raw: data.metrics },
      null,
      2,
    ),
  };
}
