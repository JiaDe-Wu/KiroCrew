/**
 * Screenshot harness for the AWS Control app (accounts list + account console).
 *
 * Runs the REAL built SPA (website/dist) on a tiny static server with SPA
 * fallback, with every /api/** call intercepted by Playwright and answered from
 * fixtures — no gateway, no dashboard token. Same technique as
 * capture-apps.mjs, which this is modelled on.
 *
 * Captures:
 *   home.png                 the accounts list
 *   account.png              one account's console
 *   drive-root.png           the drive's three sections plus the share ledger
 *   drive-files.png          the Files listing
 *   drive-narrow.png         the same controls at 320px, measured for wrap
 *   folder-delete-confirm.png  the folder delete confirmation
 *   backup-idle.png          the backup rows with nothing in flight
 *   backup-adopted.png       the same rows on a FRESH mount that adopted a
 *                            snapshot run from the host's `_jobs/active`
 *
 * Usage: node scripts/capture-aws-control.mjs <outDir>
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { serveDist } from './lib/serve-dist.mjs'
import {
  answer, jobs, unmatchedPaths, ACCOUNTS, RUNNING_SNAPSHOT_RUN, STORAGE_SEEDS,
} from './lib/aws-control-fixtures.mjs'

const OUT = process.argv[2] || '/tmp/aws-control-shots'
mkdirSync(OUT, { recursive: true })

// ---- fixtures -------------------------------------------------------------
// Shared with the video recorder, so the screenshots and the clip are answered
// by the SAME server fixtures rather than two copies that can drift.

// ---- run ------------------------------------------------------------------
const { srv: server, base } = await serveDist()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
await page.route('**/api/**', answer)
await page.route('**/api/ws', (route) => route.abort())
page.on('pageerror', (err) => console.log('PAGEERROR:', (err.stack || String(err)).slice(0, 400)))
await page.addInitScript((seeds) => {
  for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v)
}, STORAGE_SEEDS)

await page.goto(`${base}/aws-control`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/home.png`, fullPage: false })
console.log('shot home')
// Assertions must FAIL the run, not just print. A logged count is not a gate:
// a stale dist would exit 0 while every screenshot showed the old page. Home-page
// assertions run WHILE on the home page.
const failures = []
const expectCount = async (t, want) => {
  const got = await page.locator(`[data-testid="${t}"]`).count()
  const ok = got === want
  console.log(`ASSERT ${t} want=${want} got=${got} ${ok ? 'ok' : 'MISMATCH'}`)
  if (!ok) failures.push(`${t}: want ${want}, got ${got}`)
}
await expectCount('aggregate-line', 0)
// The account list is accounts and nothing else. The confirmation surface moved
// to the console, so a non-zero count here is the regression this pins.
await expectCount('paid-services', 0)
// The rescue mount fires only for a grant no registered account owns. The
// fixture's grant belongs to the first account, so it must stay absent - a hit
// here means the general condition regressed into always-on.
await expectCount('orphan-consent', 0)
await expectCount('accounts-search', 1)
await expectCount('accounts-list', 1)

// Into the first account.
const row = page.locator('[data-testid="account-card"]').first()
if (await row.count()) {
  await row.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/account.png`, fullPage: false })
  console.log('shot account')

} else {
  console.log('NO account row found')
}

// Assert on the RENDERED tree, not on the PNG: a stale dist silently produces a
// plausible-looking screenshot of the OLD page. Printed so the caller can diff
// the two runs; `expect` is not available in a plain script.
await expectCount('general-section', 0)
await expectCount('console-ghosts', 0)
await expectCount('console-guard', 0)
// The other half of the move: with both fixtures granted, the console is where
// the confirmations are readable and withdrawable.
await expectCount('paid-services', 1)
await expectCount('console-payments-toggle', 0)
await expectCount('console-copy-id', 1)
// The four inline sections are gone; ONE capability row stands for the drive.
await expectCount('console-capabilities', 1)
await expectCount('capability-drive', 1)
await expectCount('drive-section', 0)

// Into the drive page, then into its Files section.
const cap = page.locator('[data-testid="capability-drive"]')
if (await cap.count()) {
  await cap.click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/drive-root.png`, fullPage: false })
  console.log('shot drive-root')
  // The bucket's three sections are the drive's top level, and the share ledger
  // sits with them because it governs links into all three.
  await expectCount('drive-sections', 1)
  await expectCount('drive-section-drive', 1)
  await expectCount('drive-section-library', 1)
  await expectCount('drive-section-backup', 1)
  await expectCount('access-section', 1)

  const files = page.locator('[data-testid="drive-section-drive"]')
  if (await files.count()) {
    await files.click()
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/drive-files.png`, fullPage: false })
    console.log('shot drive-files')
    // Table only: one listing, no gallery and no view toggle anywhere.
    await expectCount('drive-listing', 1)
    await expectCount('drive-view-toggle', 0)
    await expectCount('drive-folder', 1)
    await expectCount('drive-file', 3)
    // Folder creation and its delete confirm are both reachable from here.
    await expectCount('drive-folder-create', 1)
    await expectCount('drive-folder-delete-confirm', 0)
    // Two controls per row: Download plus one overflow trigger. The menu comes
    // from ui/dropdown-menu, which PORTALS its content out of the table - a
    // hand-rolled absolute menu is clipped here, because the scroll container
    // the pinned Actions column needs is overflow-x-auto and that computes
    // overflow-y to auto as well. These counts are the guard: three inline
    // buttons would breach the two-per-row cap, and a non-portalled menu would
    // leave the items unreachable.
    await expectCount('drive-download', 3)
    await expectCount('drive-more', 3)
    await expectCount('drive-folder-more', 1)
    await expectCount('drive-share', 0)
    await expectCount('drive-delete', 0)
    await expectCount('drive-folder-delete', 0)
    // Open the folder overflow and reach the delete through it, then confirm.
    await page.locator('[data-testid="drive-folder-more"]').first().click()
    await page.waitForTimeout(300)
    await expectCount('drive-folder-delete', 1)
    await page.locator('[data-testid="drive-folder-delete"]').first().click()
    await page.waitForTimeout(300)
    await expectCount('drive-folder-delete-confirm', 1)
    // Narrow viewport: the controls must WRAP, not run off-screen. Measured
    // rather than eyeballed - a class change that fails to wrap still produces a
    // plausible screenshot at 1280px.
    await page.setViewportSize({ width: 320, height: 900 })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => {
      const bad = []
      for (const t of ['drive-folder-name', 'drive-folder-create', 'drive-upload-btn',
                       'drive-folder-delete-cancel', 'drive-folder-delete-action']) {
        const el = document.querySelector(`[data-testid="${t}"]`)
        if (!el) { bad.push(`${t}: missing`); continue }
        const r = el.getBoundingClientRect()
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          bad.push(`${t}: ${Math.round(r.left)}..${Math.round(r.right)} outside 0..${window.innerWidth}`)
        }
      }
      return { bad, docScroll: document.documentElement.scrollWidth, win: window.innerWidth }
    })
    console.log(`ASSERT narrow-viewport controls-onscreen ${overflow.bad.length === 0 ? 'ok' : 'MISMATCH ' + overflow.bad.join('; ')}`)
    if (overflow.bad.length) failures.push(`narrow viewport: ${overflow.bad.join('; ')}`)
    await page.screenshot({ path: `${OUT}/drive-narrow.png`, fullPage: false })
    console.log('shot drive-narrow')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/folder-delete-confirm.png`, fullPage: false })
    console.log('shot folder-delete-confirm')
  } else {
    console.log('NO Files section row found')
  }
} else {
  console.log('NO drive capability row found')
}

// ---- Backup: the row reads its running state from the SERVER ---------------
// Two frames of the same row, distinguished only by what `_jobs/active` answers.
// The second is reached by navigating AWAY from the section and back, so the
// BackupSection that renders it is a fresh mount that started nothing: the
// spinning row is adopted from the host's record, which is the whole change.
const expectFlag = (label, got, want) => {
  const ok = got === want
  console.log(`ASSERT ${label} want=${want} got=${got} ${ok ? 'ok' : 'MISMATCH'}`)
  if (!ok) failures.push(`${label}: want ${want}, got ${got}`)
}

// Leave whatever the Files section left open, then climb back to the drive root.
const openCancel = page.locator('[data-testid="drive-folder-delete-cancel"]')
if (await openCancel.count()) {
  await openCancel.first().click()
  await page.waitForTimeout(250)
}
if (await page.locator('[data-testid="drive-section-backup"]').count() === 0) {
  await page.locator('[data-testid="drive-crumb-back"]').first().click()
  await page.waitForTimeout(700)
}

const backupRow = page.locator('[data-testid="drive-section-backup"]')
if (await backupRow.count()) {
  // Frame 1: nothing in flight.
  jobs.clear()
  await backupRow.first().click()
  await page.waitForTimeout(1100)
  await expectCount('backup-section', 1)
  await expectCount('backup-row-snapshot', 1)
  await expectCount('backup-row-sessions', 1)
  expectFlag('idle snapshot row enabled',
    await page.locator('[data-testid="backup-run-snapshot"]').first().isDisabled(), false)
  await page.screenshot({ path: `${OUT}/backup-idle.png`, fullPage: false })
  console.log('shot backup-idle')

  // Away, arm a run, and back. Nothing in this session clicked Back up now.
  await page.locator('[data-testid="drive-crumb-back"]').first().click()
  await page.waitForTimeout(600)
  jobs.set([RUNNING_SNAPSHOT_RUN])
  await page.locator('[data-testid="drive-section-backup"]').first().click()
  await page.waitForTimeout(1400)

  const snapBtn = page.locator('[data-testid="backup-run-snapshot"]').first()
  expectFlag('adopted snapshot row disabled', await snapBtn.isDisabled(), true)
  const label = ((await snapBtn.textContent()) || '').trim()
  expectFlag('adopted snapshot row says Backing up', label.includes('Backing up'), true)
  // The sibling row must stay usable: the host scopes a run to (kind, account),
  // so a snapshot in flight says nothing about a sessions backup.
  expectFlag('sessions row still enabled',
    await page.locator('[data-testid="backup-run-sessions"]').first().isDisabled(), false)
  // Nothing may be covering the row in the frame.
  expectFlag('no dialog over the row',
    await page.locator('[role="dialog"], [data-testid$="-confirm"]').count(), 0)
  await page.screenshot({ path: `${OUT}/backup-adopted.png`, fullPage: false })
  console.log('shot backup-adopted')
} else {
  console.log('NO backup section row found')
  failures.push('backup section row not reachable')
}

// ---- the click is what starts the run ---------------------------------------
// The adopted frame above proves the UI picks up a run it did NOT start. This
// block proves the other half, and it is the half no screenshot can carry: that
// the run the row follows is the run the start POST returned, rather than one
// that merely appeared alongside it. Without the identity check the frames would
// be a lookalike sequence; with it they are the code path.
if (await page.locator('[data-testid="drive-section-backup"], [data-testid="backup-section"]').count()) {
  let postedRunId = null
  let lastStatus = null
  page.on('response', async (res) => {
    const p = new URL(res.url()).pathname
    try {
      if (/\/backup\/[^/]+\/run$/.test(p)) postedRunId = (await res.json()).runId
      else if (/\/backup\/[^/]+$/.test(p)) lastStatus = await res.json()
    } catch {
      /* not a JSON body: leave it null so the assertions below report it */
    }
  })
  const clientRunId = (kind) => lastStatus?.jobs?.[kind]?.active?.run_id ?? null

  jobs.clear()
  await page.goto(`${base}/aws-control`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-testid="account-card"]').first().click()
  await page.waitForTimeout(1000)
  await page.locator('[data-testid="capability-drive"]').first().click()
  await page.waitForTimeout(900)
  await page.locator('[data-testid="drive-section-backup"]').first().click()
  await page.waitForTimeout(1000)

  const snap = () => page.locator('[data-testid="backup-run-snapshot"]').first()
  expectFlag('causal row starts enabled', await snap().isDisabled(), false)
  expectFlag('causal nothing in flight before the click', clientRunId('snapshot'), null)

  await snap().click()
  await page.waitForTimeout(1800)

  expectFlag('causal start POST returned a run id',
    typeof postedRunId === 'string' && postedRunId.length === 32, true)
  expectFlag('causal row busy after the click', await snap().isDisabled(), true)
  expectFlag('causal the run the client follows IS the one the POST returned',
    clientRunId('snapshot'), postedRunId)
  // The account is the dedupe key and is caller-supplied. The app filters on it
  // server-side; it must not come back out in the payload the browser reads.
  expectFlag('causal the account does not cross to the client',
    JSON.stringify(lastStatus?.jobs ?? {}).includes(ACCOUNTS.accounts[0].account), false)

  // Same navigation as the adopted frame, but over a run this click created.
  await page.locator('[data-testid="drive-crumb-back"]').first().click()
  await page.waitForTimeout(700)
  await page.locator('[data-testid="drive-section-backup"]').first().click()
  await page.waitForTimeout(1600)
  expectFlag('causal still busy on the fresh mount', await snap().isDisabled(), true)
  expectFlag('causal same run after the re-mount', clientRunId('snapshot'), postedRunId)
  expectFlag('causal sibling row untouched',
    await page.locator('[data-testid="backup-run-sessions"]').first().isDisabled(), false)
}

if (unmatchedPaths().length) console.log('unmatched /api paths:', unmatchedPaths().join(', '))
await browser.close()
server.close()
if (failures.length) {
  console.error('harness assertions failed (stale dist, or the UI changed):')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('done')
