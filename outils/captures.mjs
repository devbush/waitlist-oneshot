import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.ROOT || process.cwd()
const LIST = { title: 'Pomelo', description: "L'app qui range tes factures toute seule. Inscris-toi pour être prévenu à l'ouverture." }
const EMAILS = ['lea.martin', 'hugo.bernard', 'ines.dubois', 'tom.leroy', 'chloe.moreau', 'adam.petit'].map((n) => `${n}@example.com`)
const ACCOUNT = { email: 'nicolas@example.com', password: 'correct-horse-9' }

const RUNS = {
  1: { style: 'api', dash0: (t) => `/admin/${t}`, lists: '/app', dash: (s) => `/app/lists/${s}`, sub: (s) => `/api/w/${s}/subscribe` },
  2: { style: 'form', lists: '/lists', dash: (s) => `/lists/${s}`, sub: (s) => `/w/${s}`, billing: '/billing' },
  3: { style: 'api', dash0: (t) => `/d/${t}`, lists: '/app', dash: (s) => `/app/lists/${s}`, sub: (s) => `/api/w/${s}/subscribe`, billing: '/app/billing' },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitUp(base) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/'); return } catch { await sleep(200) }
  }
  throw new Error('server did not start: ' + base)
}

async function shootStep(browser, run, step) {
  const cfg = RUNS[run]
  const port = 4400 + run * 10 + step
  const base = `http://127.0.0.1:${port}`
  const cwd = `${ROOT}/audit/run-${run}/step-${step}`
  const out = `${ROOT}/${process.env.OUT || 'shots'}/run-${run}/step-${step}`
  const dataDir = `${ROOT}/shots/_data/run-${run}-step-${step}`
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dataDir, 'waitlist.db') }
  if (step >= 2) Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_ID: 'price_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_API_BASE: 'http://127.0.0.1:9' })
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd, env, stdio: 'ignore' })
  const log = []
  try {
    await waitUp(base)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.SCALE || 2), locale: 'fr-FR' })
    const page = await ctx.newPage()
    let n = 0
    const shot = async (name, url) => {
      if (url) await page.goto(base + url, { waitUntil: 'networkidle' })
      await sleep(600)
      const file = `${String(++n).padStart(2, '0')}-${name}.png`
      await page.screenshot({ path: path.join(out, file), fullPage: true })
      log.push(`${file} <- ${page.url().replace(base, '')}`)
    }
    const req = ctx.request
    let slug, dash

    await shot('accueil', '/')
    if (cfg.style === 'api') {
      if (step >= 1) {
        await shot('creer-un-compte', '/signup')
        const s = await req.post(base + '/api/auth/signup', { data: ACCOUNT })
        if (!s.ok()) throw new Error('signup ' + s.status() + ' ' + (await s.text()))
      }
      const r = await req.post(base + '/api/lists', { data: LIST })
      if (!r.ok()) throw new Error('create list ' + r.status() + ' ' + (await r.text()))
      const j = await r.json()
      slug = j.slug ?? j.list?.slug
      dash = step === 0 ? cfg.dash0(j.adminToken ?? j.token) : cfg.dash(slug)
    } else {
      const opts = { maxRedirects: 0 }
      if (step >= 1) {
        await shot('creer-un-compte', '/signup')
        const s = await req.post(base + '/signup', { form: ACCOUNT, ...opts })
        if (s.status() >= 400) throw new Error('signup ' + s.status())
      }
      const r = await req.post(base + (step === 0 ? '/create' : '/lists'), { form: LIST, ...opts })
      const loc = r.headers().location
      if (!loc) throw new Error('create list ' + r.status() + ' ' + (await r.text()).slice(0, 200))
      dash = loc.split('?')[0]
      const html = await (await req.get(base + dash)).text()
      slug = html.match(/\/w\/([a-z0-9-]+)/)?.[1]
    }
    if (!slug) throw new Error('no slug')

    for (const email of EMAILS) {
      const r = await req.post(base + cfg.sub(slug), { data: { email } })
      if (r.status() >= 400) log.push(`seed ${email}: ${r.status()}`)
    }

    await shot('page-publique', `/w/${slug}`)
    await page.locator('input[type=email]:visible').first().fill('camille.roux@example.com')
    await page.locator('input[type=email]:visible').first().press('Enter')
    await sleep(1500)
    await shot('page-publique-apres-inscription')
    if (step >= 1) await shot('mes-listes', cfg.lists)
    await shot('dashboard', dash)
    if (step >= 2 && cfg.billing) await shot('abonnement', cfg.billing)
    await ctx.close()
  } finally {
    server.kill()
  }
  return log
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const only = process.argv[2]
for (const run of [1, 2, 3]) {
  for (const step of [0, 1, 2, 4]) {
    if (only && only !== `${run}-${step}`) continue
    try {
      const log = await shootStep(browser, run, step)
      console.log(`run-${run} step-${step}: ${log.length} lignes\n  ` + log.join('\n  '))
    } catch (err) {
      console.log(`run-${run} step-${step}: ECHEC ${err.message}`)
    }
  }
}
await browser.close()
