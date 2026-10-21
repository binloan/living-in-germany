// Prepares a Google Cloud project for `gcloud app deploy`, so deploying never stops on a missing API, App Engine app,
// database or permission. Safe to run again: it only changes what is missing.
//   node scripts/gcp-setup.mjs            do it
//   node scripts/gcp-setup.mjs --check    only report what would change
// Used by scripts/deploy.mjs. Settings come from .env: GCP_PROJECT_ID (required), GAE_REGION, GAE_SERVICE.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';
import { CITIES, readCityIndex } from './data/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** APIs the deploy and the running app need, and why. */
const APIS = {
  'serviceusage.googleapis.com': 'enabling the others',
  'cloudresourcemanager.googleapis.com': 'gcloud project lookups and IAM',
  'appengine.googleapis.com': 'App Engine',
  'cloudbuild.googleapis.com': 'building the app on deploy',
  'artifactregistry.googleapis.com': 'storing the built image',
  'storage.googleapis.com': 'the deploy staging bucket',
  'compute.googleapis.com': 'creates the default service account that Cloud Build runs as',
  'firestore.googleapis.com': 'shared rent prices',
};

const tag = { ok: '✓', todo: '+', warn: '!' };

/** Roles per service account (placeholders resolved once the project number is known). */
const roleGrants = (project, number) => [
  { member: `serviceAccount:${project}@appspot.gserviceaccount.com`, role: 'roles/datastore.user', why: 'the running app reads and writes Firestore' },
  { member: `serviceAccount:${number}-compute@developer.gserviceaccount.com`, role: 'roles/cloudbuild.builds.builder', why: 'Cloud Build builds the app as this account' },
  { member: `serviceAccount:${number}-compute@developer.gserviceaccount.com`, role: 'roles/artifactregistry.writer', why: 'push the built image' },
  { member: `serviceAccount:${number}-compute@developer.gserviceaccount.com`, role: 'roles/logging.logWriter', why: 'build logs' },
  { member: `serviceAccount:${number}-compute@developer.gserviceaccount.com`, role: 'roles/storage.objectViewer', why: 'read the uploaded source' },
];

/** Legacy App Engine locations map to a different Firestore location name. */
const firestoreLocation = (gae) => ({ 'us-central': 'nam5', 'europe-west': 'eur3' })[gae] ?? gae;

// one command string through the shell: gcloud is a .cmd file on Windows, and passing an args array with shell:true is deprecated
const quote = (a) => (/^[\w.=:/@,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function gcloud(args, { json = false, allowFail = false } = {}) {
  const cmd = ['gcloud', ...args, ...(json ? ['--format=json'] : [])].map(quote).join(' ');
  const r = spawnSync(cmd, { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`gcloud ${args.join(' ')}\n${(r.stderr || r.stdout || '').trim()}`);
  }
  if (!json) return r.stdout;
  try { return r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { return null; }
}

/** Service accounts appear a few seconds after their API is enabled, so a grant may need a moment. */
function retry(fn, tries = 6, waitMs = 8000) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tries || !/does not exist|not found|INVALID_ARGUMENT/i.test(e.message)) throw e;
      console.log(`    waiting for the service account to appear (${i}/${tries - 1})…`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

const fail = (msg) => { throw Object.assign(new Error(msg), { setup: true }); };

/**
 * @param {{ check?: boolean }} opts check: change nothing, only say what is missing.
 * @returns {{ project: string, region: string, host: string | null }}
 */
export function setupGcp({ check = false } = {}) {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) fail('GCP_PROJECT_ID missing in .env');
  const wantRegion = process.env.GAE_REGION || 'europe-west3';
  const service = process.env.GAE_SERVICE || 'default';
  let changes = 0;
  const act = (what, fn) => {
    changes++;
    if (check) { console.log(`  ${tag.todo} would ${what}`); return; }
    console.log(`  ${tag.todo} ${what}…`);
    fn();
  };

  console.log(`Google Cloud setup for ${project}${check ? ' (check only)' : ''}`);

  // gcloud and a login
  if (!gcloud(['--version'], { allowFail: true })) fail('gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install and run `gcloud auth login`.');
  const accounts = gcloud(['auth', 'list'], { json: true, allowFail: true }) ?? [];
  const account = accounts.find((a) => a.status === 'ACTIVE')?.account;
  if (!account) fail('Not logged in to gcloud. Run `gcloud auth login` (in this session: `! gcloud auth login`), then deploy again.');
  console.log(`  ${tag.ok} gcloud logged in as ${account}`);

  // the project itself
  const info = gcloud(['projects', 'describe', project], { json: true, allowFail: true });
  if (!info) fail(`Project "${project}" not found or ${account} cannot see it. Check GCP_PROJECT_ID in .env, or create it: gcloud projects create ${project}`);
  if (info.lifecycleState && info.lifecycleState !== 'ACTIVE') fail(`Project "${project}" is ${info.lifecycleState}.`);
  const number = info.projectNumber;
  console.log(`  ${tag.ok} project ${project} (number ${number})`);

  // billing: App Engine will not deploy without it
  const billing = gcloud(['billing', 'projects', 'describe', project], { json: true, allowFail: true });
  if (billing && billing.billingEnabled === false) {
    fail(`Billing is not enabled for ${project}. App Engine needs a billing account (the free quota still applies): https://console.cloud.google.com/billing/linkedaccount?project=${project}`);
  }
  console.log(billing ? `  ${tag.ok} billing enabled` : `  ${tag.warn} could not read the billing status; continuing`);

  // APIs
  const enabled = new Set((gcloud(['services', 'list', '--enabled', `--project=${project}`], { json: true, allowFail: true }) ?? []).map((s) => s.config?.name));
  const missingApis = Object.keys(APIS).filter((a) => !enabled.has(a));
  if (missingApis.length) {
    act(`enable APIs: ${missingApis.map((a) => a.replace('.googleapis.com', '')).join(', ')} (about a minute)`, () => {
      gcloud(['services', 'enable', ...missingApis, `--project=${project}`]);
    });
  } else console.log(`  ${tag.ok} APIs enabled (${Object.keys(APIS).length})`);

  // App Engine application
  let app = gcloud(['app', 'describe', `--project=${project}`], { json: true, allowFail: true });
  if (!app) {
    act(`create the App Engine app in ${wantRegion} (the region cannot be changed later)`, () => {
      gcloud(['app', 'create', `--region=${wantRegion}`, `--project=${project}`, '--quiet']);
      app = gcloud(['app', 'describe', `--project=${project}`], { json: true, allowFail: true });
    });
  } else {
    console.log(`  ${tag.ok} App Engine app in ${app.locationId}`);
    if (app.locationId && app.locationId !== wantRegion) console.log(`  ${tag.warn} GAE_REGION is ${wantRegion}, but the app already lives in ${app.locationId}; the existing region stays`);
  }
  const region = app?.locationId ?? wantRegion;

  // a non-default service can only be deployed once the default one exists
  if (service !== 'default' && app) {
    const services = gcloud(['app', 'services', 'list', `--project=${project}`], { json: true, allowFail: true }) ?? [];
    if (!services.some((s) => (s.id ?? s.name) === 'default')) {
      fail(`GAE_SERVICE is "${service}", but App Engine has no "default" service yet and it must be deployed first. Set GAE_SERVICE=default for the first deploy.`);
    }
  }

  // Firestore (native mode) for the shared rent prices. A named database: App Engine creates the (default) one in
  // Datastore mode, which cannot hold Firestore documents and cannot be converted.
  // Which databases: the one each listed city names (prices.database in its manifest, else "prices"); PRICE_DATABASE names the default city's.
  const index = readCityIndex();
  const dbNames = [...new Set(index.cities.map((id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CITIES, id, 'city.json'), 'utf8'));
    return (id === index.default && process.env.PRICE_DATABASE) || manifest.prices?.database || 'prices';
  }))];
  const dbs = missingApis.includes('firestore.googleapis.com') && check ? [] : gcloud(['firestore', 'databases', 'list', `--project=${project}`], { json: true, allowFail: true }) ?? [];
  for (const dbName of dbNames) {
    const db = dbs.find((d) => (d.name ?? '').endsWith(`/databases/${dbName}`));
    if (!db) {
      act(`create the Firestore database "${dbName}" in ${firestoreLocation(region)}`, () => {
        gcloud(['firestore', 'databases', 'create', `--database=${dbName}`, `--location=${firestoreLocation(region)}`, '--type=firestore-native', `--project=${project}`]);
      });
    } else if (db.type && db.type !== 'FIRESTORE_NATIVE') {
      fail(`The database "${dbName}" of ${project} is in ${db.type} mode. The app needs Firestore in Native mode. Name another one in prices.database of the city's manifest (or PRICE_DATABASE for the default city), or set PRICE_STORE=file to skip it (prices then stay per instance).`);
    } else console.log(`  ${tag.ok} Firestore database "${dbName}" (${db.locationId ?? 'default'})`);
  }

  // permissions
  const policy = gcloud(['projects', 'get-iam-policy', project], { json: true, allowFail: true });
  const have = new Set((policy?.bindings ?? []).flatMap((b) => (b.members ?? []).map((m) => `${m}|${b.role}`)));
  const missingRoles = roleGrants(project, number).filter((g) => !have.has(`${g.member}|${g.role}`));
  if (!policy) console.log(`  ${tag.warn} could not read the IAM policy (needs resourcemanager.projects.getIamPolicy); skipping the permission check`);
  else if (!missingRoles.length) console.log(`  ${tag.ok} service account permissions`);
  for (const g of missingRoles) {
    act(`grant ${g.role} to ${g.member.replace('serviceAccount:', '')} (${g.why})`, () => {
      retry(() => gcloud(['projects', 'add-iam-policy-binding', project, `--member=${g.member}`, `--role=${g.role}`, '--condition=None', '--quiet']));
    });
  }

  console.log(changes ? (check ? `${changes} change(s) needed; run without --check to apply them.` : `Setup done (${changes} change(s)).`) : 'Nothing to change: ready to deploy.');
  return { project, region, host: app?.defaultHostname ?? null };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { setupGcp({ check: process.argv.includes('--check') }); }
  catch (e) { console.error(`\n${e.setup ? '' : 'Setup failed:\n'}${e.message}`); process.exit(1); }
}
