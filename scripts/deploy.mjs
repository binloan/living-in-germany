// Prepares the Google Cloud project (APIs, App Engine app, Firestore, permissions), builds, generates app.yaml
// from .env and deploys with gcloud. The project id never touches the repo.
//   npm run deploy                 setup + build + deploy
//   npm run deploy -- --skip-setup deploy only (setup already done)
//   npm run deploy -- --seed       afterwards put the starting rents of the cities' seed/rents.json on the live site
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';
import { setupGcp } from './gcp-setup.mjs';
import { DEMO, readCityIndex } from './data/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCP_PROJECT_ID;
if (!project) { console.error('GCP_PROJECT_ID missing in .env'); process.exit(1); }
if (DEMO) { console.error('Only the demo city is set up (invented data): there is nothing to deploy. Your own cities go in cities/, see ADDING_A_CITY.md.'); process.exit(1); }
const cityIndex = readCityIndex();
for (const id of cityIndex.cities) {
  if (!fs.existsSync(path.join(root, 'cities', id, 'generated', 'cells.json'))) {
    console.error(`cities/${id}/generated/cells.json missing: run "npm run data -- --city ${id}" first`); process.exit(1);
  }
}
const flags = new Set(process.argv.slice(2));

const quote = (a) => (/^[\w.=:/@,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const run = (...cmd) => {
  const r = spawnSync(cmd.map(quote).join(' '), { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

let host = null;
if (!flags.has('--skip-setup')) {
  try { ({ host } = setupGcp()); } catch (e) { console.error(`\n${e.setup ? '' : 'Setup failed:\n'}${e.message}`); process.exit(1); }
}
run('npm', 'run', 'build');
run('node', 'scripts/gen-app-yaml.mjs');
run('gcloud', 'app', 'deploy', 'app.yaml', `--project=${project}`, '--quiet');

const service = process.env.GAE_SERVICE || 'default';
const url = host ? (service === 'default' ? `https://${host}` : `https://${service}-dot-${host}`) : null;
if (url) console.log(`\nLive at ${url}`);
if (flags.has('--seed')) {
  if (!url) { console.error('--seed needs the app URL; run without --skip-setup once'); process.exit(1); }
  run('node', 'scripts/seed-prices.mjs', '--url', url);
}
