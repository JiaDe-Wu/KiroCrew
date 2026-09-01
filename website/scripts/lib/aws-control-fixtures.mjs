/**
 * Fixtures and the `/api/**` route handler for AWS Control capture harnesses.
 *
 * ONE source of server answers for the still-frame harness
 * (`scripts/capture-aws-control.mjs`). The recorder that shot this PR's clip is
 * skill-driven and lives outside the tree, so it is NOT a consumer here -- naming
 * it as one would be this module asserting a relationship nothing in the repo
 * can show. Extraction still pays for itself against a single importer: the
 * harness's own two phases (still capture and the causal assertions) read the
 * same handler, so a fixture that drifts cannot make one of them pass while the
 * other reads something else. That sharing is
 * the point rather than tidiness: the screenshots and the clip are evidence for
 * the same claim, so they must be answered by the same fixtures or one of them
 * is quietly describing a different server.
 *
 * No gateway, no credentials, no AWS call. Every response here is a fixture.
 */
import { randomBytes } from 'node:crypto'

export const BASE = '/api/apps/aws-control'

// Three accounts so the list reads as a list, with one degraded key so the
// health dot is not uniformly green.
export const ACCOUNTS = {
  supported: true,
  accounts: [
    {
      account: '217681647555', name: 'personal', health: 'ok',
      profiles: [{ name: 'personal', kind: 'credential-process', region: 'us-west-2', account: '217681647555', default: true, identityOk: true }],
    },
    {
      account: '740412361337', name: 'wombats-alpha', health: 'ok',
      profiles: [
        { name: 'wombats-alpha-admin', kind: 'sso', region: 'us-west-2', account: '740412361337', default: true, identityOk: true },
        { name: 'wombats-alpha-ro', kind: 'sso', region: 'us-east-1', account: '740412361337', default: false, identityOk: true },
      ],
    },
    {
      account: '000417292745', name: 'beetlejuice-auth-syd', health: 'degraded',
      profiles: [{ name: 'beetlejuice-syd', kind: 'sso', region: 'ap-southeast-2', account: '000417292745', default: true, identityOk: false }],
    },
  ],
  totals: { accounts: 3, profiles: 4, profilesHealthy: 3 },
}

export const CONSENT = (service) => ({
  service,
  serviceLabel: service === 's3' ? 'Amazon S3 (cloud drive storage)' : 'AWS Cost Explorer',
  granted: true,
  region: 'us-west-2',
  credentialSource: 'profile personal',
  account: '217681647555',
  identityResolved: true,
  revokedOnAccountChange: false,
  // The account the grant was RECORDED for. The console only shows a receipt
  // whose grant matches the console's own account, so this has to be the first
  // account in ACCOUNTS or the console captures would show no receipt at all.
  grant: { account: '217681647555', region: 'us-west-2', profile: 'personal', granted_at: '2026-08-28T00:00:00+00:00' },
})

export const COSTS = { monthToDate: 2.25, currency: 'USD', fetchedAt: new Date().toISOString(), fresh: true, consentMissing: false }

// `usage.sections` is required, not optional: the drive root reads
// `drive.usage.sections[s]` for each of the three section cards, so a fixture
// carrying only the rolled-up totals throws on the first card and the whole
// root branch renders nothing below the header. The three add up to the total.
export const DRIVE = {
  exists: true,
  bucket: 'kirocrew-drive-7f3a91c4',
  region: 'us-west-2',
  usage: {
    bytes: 44677427,
    objects: 18,
    sections: {
      drive: { bytes: 32715570, objects: 4 },
      library: { bytes: 9532817, objects: 12 },
      backup: { bytes: 2429040, objects: 2 },
    },
  },
}

export const LISTING = {
  folders: ['demos'],
  files: [
    { key: 'terrace-deck.pdf', size: 2516582, modified: '2026-08-26T09:12:00Z' },
    { key: 'pr-watch-e2e.mp4', size: 19818086, modified: '2026-08-24T18:40:00Z' },
    { key: 'session-storage-demo.mp4', size: 10380902, modified: '2026-08-21T11:05:00Z' },
  ],
}

export const LIBRARY = { artifacts: [] }
export const BACKUP = { nightly: false, runs: {}, remote: { snapshot: [], sessions: [] } }

/**
 * The durable job runtime's view of one run, exactly as `job_routes._public_view`
 * serves it. Used when a harness wants the row to ADOPT a run it did not start.
 */
export const RUNNING_SNAPSHOT_RUN = {
  run_id: 'a3f19c4b28e7d0516af92c3b7e4d81f0',
  kind: 'snapshot',
  account: '217681647555',
  status: 'running',
  created_at: '2026-09-01T21:31:00Z',
  updated_at: '2026-09-01T21:31:02Z',
  finished_at: '',
  error: '',
}

/**
 * What the app's own account-scoped endpoint answers, and the two ways it gets
 * there.
 *
 * `set` is the adoption case: the host already has a run in flight and the UI must
 * pick it up on mount. `startRun` is the CAUSAL case -- it mints a run the way the
 * real route does (`_handle_backup_run` -> `sdk.start_async`) and returns its id,
 * so the run the row then shows IS the run the POST returned rather than one
 * swapped in beside it. That distinction is the difference between filming the
 * code path and staging a lookalike.
 *
 * Runs carry their account, because the page reads an ACCOUNT-scoped payload:
 * `GET /backup/{account}` serves only this account's run, since the shared
 * `_jobs/active` surface is app-scoped and withholds the account. A stub that
 * ignored the account would hide exactly the phantom-busy bug that scoping fixes.
 */
const state = { active: [] }

export const jobs = {
  active: () => state.active.slice(),
  set(runs) { state.active = runs.slice() },
  clear() { state.active = [] },
  /** Mint a run for `kind` on `account`, as the real start route would. */
  startRun(kind, account = ACCOUNTS.accounts[0].account) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    const run = {
      run_id: randomBytes(16).toString('hex'),
      kind,
      account,
      status: 'running',
      created_at: now,
      updated_at: now,
      finished_at: '',
      error: '',
    }
    state.active = [...state.active.filter((r) => !(r.kind === kind && r.account === account)), run]
    return run.run_id
  },
  /** The `jobs` block of `GET /backup/{account}`, as `routes._account_jobs` builds it. */
  blockFor(account) {
    const out = {}
    for (const kind of ['snapshot', 'sessions']) {
      const active = state.active.find((r) => r.kind === kind && r.account === account) || null
      out[kind] = {
        // The account is the dedupe key and never crosses to the client.
        active: active && { ...active, account: undefined },
        lastFailed: null,
      }
    }
    return out
  },
}

const unmatched = new Set()
export const unmatchedPaths = () => [...unmatched]

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Playwright `page.route('**\/api/**', answer)` handler. */
export async function answer(route) {
  const url = new URL(route.request().url())
  const path = url.pathname
  if (path.endsWith('/accounts')) return json(route, ACCOUNTS)
  if (path === '/api/aws/consent') {
    return json(route, CONSENT(url.searchParams.get('service') || 's3'))
  }
  // Paths are BASE-prefixed (/api/apps/aws-control/...) and account-scoped, so
  // match on the segment after the base rather than on a suffix.
  const app = path.startsWith(BASE) ? path.slice(BASE.length) : ''
  if (/^\/drive\/[^/]+\/list$/.test(app)) return json(route, LISTING)
  if (/^\/drive\/[^/]+$/.test(app)) return json(route, DRIVE)
  if (/^\/costs\/[^/]+$/.test(app)) return json(route, COSTS)
  if (app === '/profiles/available') return json(route, { supported: true, profiles: [], max: 20 })
  if (/^\/library\/[^/]+$/.test(app)) return json(route, LIBRARY)
  // The start route, answered CAUSALLY: it mints the run and returns its id, and
  // the same run is what the account-scoped status payload serves from here on.
  // Declared before the status route because `/backup/<acct>` is a prefix of
  // `/backup/<acct>/run`.
  const runMatch = app.match(/^\/backup\/([^/]+)\/run$/)
  if (runMatch) {
    let kind = 'snapshot'
    try {
      kind = JSON.parse(route.request().postData() || '{}').kind || 'snapshot'
    } catch { /* a malformed body means the default kind */ }
    return json(route, { started: true, kind, runId: jobs.startRun(kind, runMatch[1]) })
  }
  // The app's OWN account-scoped read. The page asks "is a backup running for THIS
  // account", which the app-scoped `_jobs/active` surface cannot answer because it
  // withholds the account.
  const statusMatch = app.match(/^\/backup\/([^/]+)$/)
  if (statusMatch) {
    return json(route, { ...BACKUP, jobs: jobs.blockFor(statusMatch[1]) })
  }
  if (app.startsWith('/shares')) return json(route, { shares: [] })
  // ---- dashboard shell, not this app. The shell mounts BEFORE the app page and
  // several of these are consumed as ARRAYS, so a blanket {} crashes the app
  // shell's error boundary ("x.filter is not a function") and the app page never
  // mounts at all.
  if (path === '/api/apps') return json(route, [])
  if (path === '/api/auth/me') return json(route, { user: 'owner', app: '' })
  if (path === '/api/status') {
    return json(route, { sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0, uptime: 1, version: '0.1.0' })
  }
  if (path === '/api/kiro-prerequisite') return json(route, { installed: true, authenticated: true, ready: true })
  if (path === '/api/dashboard/branding') return json(route, { bot_name: 'Kiro Crew', avatar: '' })
  if (path === '/api/theme/boot') return json(route, { mode: 'dark', theme: '' })
  if (path === '/api/themes') return json(route, { themes: [], installed: [] })
  if (path === '/api/notifications') return json(route, { notifications: [], unread: 0 })
  if (path === '/api/chat/slots') return json(route, [])
  if (path === '/api/models') return json(route, { models: [], default: 'auto' })
  if (path.startsWith('/api/instances')) return json(route, { instances: [], active: '' })
  // Unknown paths: object-ish names get {}, everything else an array, because a
  // list endpoint answered with an object is what crashes the shell.
  const objectish = /(config|tips|voice|autonudge|branding|status|themes|system)/.test(path)
  unmatched.add(path)
  return json(route, objectish ? {} : [])
}

/** localStorage seeds that clear the first-run wizards for a capture. */
export const STORAGE_SEEDS = {
  'mc-onboarded': '1',
  'mc-import-onboarded': '1',
  'mc-privacy-acked': '1',
  'mc-theme-mode': 'dark',
}
