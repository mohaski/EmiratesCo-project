// Provisional offcuts in the browser (PROVISIONAL_OFFCUTS_PLAN.md, phase 4). Test backend :8010 via Vite :5180, test DB.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const { execFileSync } = require('child_process');
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const SERVER = require('path').resolve(__dirname, '../../server');
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${PW}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
const body = p => p.locator('body').innerText();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Database steps (test DB only): back-date a window so it is idle, run one sweep.
const PY = `${SERVER}/.venv/bin/python`;
const TESTURL = execFileSync(PY, ['-c', "from sqlalchemy.engine import make_url\nfrom db.database import DATABASE_URL\nprint(make_url(DATABASE_URL).set(database='emiratesco_edit_test').render_as_string(hide_password=False))"], { cwd: SERVER, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop();
const py = (code) => execFileSync(PY, ['-c', `import logging; logging.disable(50)\n${code}`], { cwd: SERVER, env: { ...process.env, DATABASE_URL: TESTURL }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const backdate = (windowId) => py(`from sqlmodel import Session, text\nfrom db.database import engine\nwith Session(engine) as db:\n    assert db.exec(text('select current_database()')).one()[0] == 'emiratesco_edit_test'\n    db.exec(text("UPDATE sale_windows SET last_activity_at = LOCALTIMESTAMP - interval '16 minutes' WHERE window_id = ${Number(windowId)}"))\n    db.commit()`);
const sweep = () => py('from core.ordering.windowService import expire_idle_windows\nprint(expire_idle_windows())').trim();

let CEO, M, C2, PRODS;
const prod = n => PRODS.find(p => p.name === n);
const variantStock = async (name) => (await api(M, '/products/')).data.find(p => p.name === name).variants[0].stock_quantity;

async function newPage(browser, user, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.errs = []; p.dialogs = []; p.toasts = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', async d => { p.dialogs.push(d.message()); await d.accept(); });
  if (user) {
    await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(user); await p.locator('input').nth(1).fill(PW);
    await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login')); await p.waitForTimeout(900);
  }
  return p;
}
async function pickCustomer(p, name = 'QA Customer') {
  await p.getByPlaceholder('Search by name or phone...').fill(name.slice(0, 6)); await p.getByText(name).first().click(); await p.waitForTimeout(900);
}
async function openWidget(p) {
  await p.getByRole('button', { name: /QA Accessories/ }).click(); await p.waitForTimeout(200);
  await p.locator('.product-card').first().click(); await p.waitForTimeout(500);
}
// The widget's calculator is a stepper: down to 1, then up to n. Its "Total: KSH<n*100>" line
// says what quantity it holds.
async function setQty(p, n) {
  const minus = p.getByRole('button', { name: '-', exact: true }).last();
  const plus = p.getByRole('button', { name: '+', exact: true }).last();
  for (let i = 0; i < 12; i++) await minus.click();
  for (let i = 1; i < n; i++) await plus.click();
  await p.waitForTimeout(400);
}
const modalQty = async p => { const m = (await body(p)).replace(/,/g, '').match(/Total: KSH(\d+)/); return m ? Number(m[1]) / 100 : null; };
const addBtn = p => p.getByRole('button', { name: /\+ Add to Order|Saving…/ });
const myWindows = async (t) => (await api(t, '/windows/')).data;
const closeAll = async (t) => { for (const w of await myWindows(t)) await api(t, `/windows/${w.windowId}`, { method: 'DELETE' }); };
const widgetItem = (qty) => ({ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 1, unitPrice: 0, unitType: 'pcs', details: { lineItems: [{ type: 'accessory-full', qty, meta: {}, rate: 100 }] } });
const showsText = async (p, re) => re.test(await body(p));
const tracked = () => prod('QA Tracked Bar');
const cutItem = (feet, newBar = false) => ({ productId: tracked().productId, variantId: tracked().variants[0].variantId, quantity: 1,
  unitPrice: 0, unitType: 'pcs', details: { lineItems: [{ type: 'profile-cut', qty: 1, meta: { length: feet, unit: 'ft' }, rate: 100, ...(newBar ? { source_pref: 'new' } : {}) }] } });
const provisionalSetting = async () => (await api(CEO, '/windows/provisional-offcuts/settings')).data.enabled;
async function windowWithCut(t, feet) {
  const w = (await api(t, '/windows/', { method: 'POST', body: JSON.stringify({ deviceId: 'suite-provisional' }) })).data;
  return (await api(t, `/windows/${w.windowId}/cart`, { method: 'PUT', body: JSON.stringify({ version: w.version, items: [cutItem(feet, true)] }) })).data;
}

(async () => {
  CEO = await tok('qa_ceo'); M = await tok('qa_manager');
  PRODS = (await api(M, '/products/')).data;
  const CASH = await tok('qa_cashier');
  const ME = (await api(M, '/users/me')).data;
  check('sale windows on (CEO)', (await api(CEO, '/windows/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status === 200);
  check('provisional offcuts start off', (await provisionalSetting()) === false);
  const browser = await chromium.launch();

  console.log('1. The CEO switch on the Orders page');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Shared leftovers: Off/ }).click(); await p.waitForTimeout(1200);
    check('switched on from the button', (await provisionalSetting()) === true && await showsText(p, /Shared leftovers: On/));
    const w = await windowWithCut(CASH, 3);
    await p.getByRole('button', { name: /Shared leftovers: On/ }).click(); await p.waitForTimeout(1500);
    check('refused while a window is open, saying so', (await provisionalSetting()) === true && await showsText(p, /sale window\(s\) are open/),
      (await body(p)).match(/[^\n]*(window|refused)[^\n]*/gi)?.slice(0, 3).join(' | '));
    check('the button still says On', await showsText(p, /Shared leftovers: On/));
    await api(CASH, `/windows/${w.windowId}`, { method: 'DELETE' });
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  // A cashier's window cuts 3ft from a new 21ft bar: its 18ft leftover is provisional.
  const win = await windowWithCut(CASH, 3);
  check('setup: the window holds a 3ft cut', win.items && win.items.length === 1, JSON.stringify(win).slice(0, 120));

  console.log('2. Another till sees the 18ft, badged');
  {
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await p.getByRole('button', { name: /QA Profile/ }).click(); await p.waitForTimeout(300);
    await p.locator('.product-card', { hasText: 'QA Tracked Bar' }).first().click(); await p.waitForTimeout(600);
    await p.locator('text=Total feet needed').locator('xpath=ancestor::div[1]').locator('input').first().fill('5'); await p.waitForTimeout(700);
    await p.getByRole('button', { name: /Choose offcuts or a new bar/ }).click(); await p.waitForTimeout(1500);
    const t = await body(p);
    check('the picker lists the 18ft as provisional, naming the window and cashier', /18(\.00)?\s*ft[\s\S]{0,40}Provisional · Window 1 \(qa_cashier\)/.test(t),
      (t.match(/[^\n]*(18ft|Provisional)[^\n]*/g) || []).join(' | '));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(M);
  }

  console.log('3. Offcut Management shows it read-only');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/offcuts'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /QA Profile/ }).click().catch(() => {}); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'GENERAL' }).click().catch(() => {}); await p.waitForTimeout(900);
    const t = await body(p);
    check('the 18ft is listed with the provisional badge', /18(\.00)?\s*ft[\s\S]{0,80}Provisional · Window 1 \(qa_cashier\)/.test(t), (t.match(/[^\n]*(18ft|Provisional)[^\n]*/g) || []).join(' | '));
    check('...and locked: no Edit for it', /Locked until the sale closes/.test(t));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('4. Managers see it is only on paper');
  {
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/inventory'); await p.waitForTimeout(1500);
    check('the held-stock banner counts the provisional offcut', await showsText(p, /1 provisional offcut not cut yet/), (await body(p)).match(/[^\n]*held in[^\n]*/)?.[0]);
    await p.locator('[data-held-stock] button').first().click(); await p.waitForTimeout(300);
    check('...and says the bar is still whole', await showsText(p, /18 offcut - provisional, only on paper[\s\S]{0,60}Window 1 \(qa_cashier\)/));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('5. A sale that cuts from it: the worksheet says take the whole bar');
  const sale = (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ servedBy: ME.userId, status: 'confirmed', amountPaid: 0, items: [cutItem(4)] }) })).data;
  const openReview = async (p) => {
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    await p.getByPlaceholder('Search by order ID or customer...').fill(String(sale.orderNo)); await p.waitForTimeout(1200);
    await p.getByText(String(sale.orderNo), { exact: true }).first().click(); await p.waitForTimeout(1800);
  };
  {
    const p = await newPage(browser, 'qa_manager');
    await openReview(p);
    let t = await body(p);
    check('window open: "not cut yet ... take the whole 21ft bar"',
      /Not cut yet: this piece comes from a bar an open sale \(Window 1, qa_cashier\) hasn't paid for\.\s*The bar is still whole - take the whole 21ft bar/.test(t),
      (t.match(/[^\n]*(⚠|bar)[^\n]*/g) || []).slice(0, 3).join(' | '));
    await api(CASH, `/windows/${win.windowId}`, { method: 'DELETE' });
    await openReview(p);
    t = await body(p);
    check('window released: "closed before cutting ... take the whole 21ft bar"',
      /The sale that opened this bar was closed before cutting - the bar is still whole\.\s*Take the whole 21ft bar/.test(t),
      (t.match(/[^\n]*(⚠|bar)[^\n]*/g) || []).slice(0, 3).join(' | '));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await closeAll(CASH);
  check('switched back off (no window open)', (await api(CEO, '/windows/provisional-offcuts/settings', { method: 'PUT', body: JSON.stringify({ enabled: false }) })).status === 200);
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('Error:', e); process.exit(1); });
