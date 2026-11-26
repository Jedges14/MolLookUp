// Minimal stand-in for PubChem PUG-REST used by the E2E run, so browser tests never touch the real service.
// Replays the recorded fixtures in backend/test/fixtures. Knows aspirin (CID 2244) only; anything else is a 404.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PUBCHEM_PORT ?? 4010);
const fx = (name) => readFileSync(new URL(`../backend/test/fixtures/${name}`, import.meta.url));
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

let requests = 0;
createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/health') return json(res, 200, JSON.stringify({ ok: true, requests }));
  requests++;
  const p = path.replace(/^\/rest\/pug/, '');
  if (p === '/compound/name/aspirin/cids/JSON') return json(res, 200, fx('aspirin_cids.json'));
  if (/^\/compound\/cid\/2244\/property\//.test(p)) {
    const table = JSON.parse(fx('aspirin_properties.json'));
    table.PropertyTable.Properties = table.PropertyTable.Properties.filter((r) => r.CID === 2244);
    return json(res, 200, JSON.stringify(table));
  }
  if (p === '/compound/cid/2244/synonyms/JSON') return json(res, 200, fx('aspirin_synonyms.json'));
  if (p === '/compound/cid/2244/PNG') {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(fx('aspirin.png'));
  }
  return json(res, 404, fx('notfound_cids.json'));
}).listen(PORT, '127.0.0.1', () => console.log(`mock PubChem on http://127.0.0.1:${PORT}`));
