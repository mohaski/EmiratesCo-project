// Sale windows in the browser (plan T19-T28 + T4). Test backend :8010 via Vite :5180, test DB.
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

(async () => {
  CEO = await tok('qa_ceo'); M = await tok('qa_manager'); C2 = await tok('qa_admin');
  PRODS = (await api(M, '/products/')).data;
  const CASH = await tok('qa_cashier');
  // Windows on, and 10 widgets in stock for the stock checks.
  check('windows switched on (CEO)', (await api(CEO, '/windows/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status === 200);
  const wv = prod('QA Widget').variants[0];
  await api(CEO, `/products/variants/${wv.variantId}`, { method: 'PUT', body: JSON.stringify({ stock_change: 10 - (await variantStock('QA Widget')) }) });
  check('10 widgets in stock to start', await variantStock('QA Widget') === 10, await variantStock('QA Widget'));
  const browser = await chromium.launch();

  console.log('1. A window line counts its own held stock (T19)');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 8); await p.waitForTimeout(400);
    await addBtn(p).click(); await p.waitForTimeout(1500);
    check('8 widgets held: stock now 2', await variantStock('QA Widget') === 2, await variantStock('QA Widget'));
    // An idle till sends no cart saves (a feedback loop once saved the same cart non-stop).
    let idleSaves = 0; const countSaves = r => { if (r.method() === 'PUT' && r.url().includes('/cart')) idleSaves += 1; };
    p.on('request', countSaves); await p.waitForTimeout(4000); p.off('request', countSaves);
    check('idle for 4s: no cart saves', idleSaves === 0, idleSaves);
    check('a window tab is shown', /Window 1/.test(await body(p)));
    await p.getByRole('button', { name: 'Edit', exact: true }).first().click(); await p.waitForTimeout(700);   // reopen the line
    await setQty(p, 9); await p.waitForTimeout(500);
    const t = await body(p);
    check('reopening the line: 9 allowed (its own 8 + 2 on the shelf)', !/Only \d+ items available/.test(t), (t.match(/Only \d+[^\n]*/) || [''])[0]);
    await addBtn(p).click(); await p.waitForTimeout(1500);
    check('saved: 9 held, 1 left', await variantStock('QA Widget') === 1, await variantStock('QA Widget'));
    await openWidget(p); await setQty(p, 2); await p.waitForTimeout(500);
    check('a NEW line sees only the 1 left', /Only 1 items available/.test(await body(p)), (await body(p)).match(/Only \d+[^\n]*/)?.[0]);
    await p.keyboard.press('Escape'); await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(CASH);
    check('closing the window gives all 10 back', await variantStock('QA Widget') === 10, await variantStock('QA Widget'));
  }

  console.log('2. A refused save keeps the modal open with what was typed (T20)');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 6); await p.waitForTimeout(600);
    // Another till takes 7 of the 10 between the check and the save.
    const other = (await api(M, '/windows/', { method: 'POST', body: JSON.stringify({}) })).data;
    const r = await api(M, `/windows/${other.windowId}/cart`, { method: 'PUT', body: JSON.stringify({ version: other.version, items: [widgetItem(7)] }) });
    check('another till holds 7', r.status === 200, r.status);
    await addBtn(p).click(); await p.waitForTimeout(1500);
    const t = await body(p);
    check('modal still open', /\+ Add to Order/.test(t));
    check('the 6 entered is still there', await modalQty(p) === 6, await modalQty(p));
    check('the reason is shown', /Insufficient/i.test(t));
    check('nothing was held for the refused add', await variantStock('QA Widget') === 3, await variantStock('QA Widget'));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(M); await closeAll(CASH);
  }

  console.log('3. A window that idles out: stock back, the till says so, no sale without a customer (T21)');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await addBtn(p).click(); await p.waitForTimeout(1500);
    const w = (await myWindows(CASH))[0];
    backdate(w.windowId);
    // The server's own sweeper (every 30s) expires it and tells every till.
    let gone = false;
    for (let i = 0; i < 25 && !gone; i++) { await sleep(2000); gone = (await myWindows(CASH)).length === 0; }
    check('the server sweeper expires it within 50s', gone);
    await p.waitForTimeout(2500);
    check('stock back to 10', await variantStock('QA Widget') === 10, await variantStock('QA Widget'));
    const t = await body(p);
    // The cart itself, not the whole page (the product grid behind the prompt lists QA Widget).
    check('the till shows the cart empty, asks for a customer again and says why', /No items added/.test(t) && /Select Customer/.test(t) && /idle for more than 15 minutes/.test(t), t.slice(-400).replace(/\n/g, ' | '));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(CASH);
  }

  console.log('4. Editing a saved order alongside windows (T22) - as a manager (only managers edit orders)');
  {
    const ord = (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ servedBy: (await api(M, '/users/me')).data.userId, status: 'confirmed', amountPaid: 0, items: [widgetItem(1)] }) })).data;
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 2); await addBtn(p).click(); await p.waitForTimeout(1500);
    const before = (await myWindows(M)).length;
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1200);
    await p.getByPlaceholder(/Search/).first().fill(String(ord.orderNo)); await p.waitForTimeout(1000);
    await p.getByRole('button', { name: /Edit/ }).first().click(); await p.waitForTimeout(1500);
    let t = await body(p);
    check('edit banner names the ORDER NUMBER', new RegExp(`Edit: #${ord.orderNo}\\b`, 'i').test(t), (t.match(/Edit: #\S+/i) || [''])[0]);
    check('window tabs hidden while editing', !/Window 1/.test(t));
    await p.reload(); await p.waitForTimeout(1800);
    t = await body(p);
    check('after a reload: still the edit', new RegExp(`Edit: #${ord.orderNo}\\b`, 'i').test(t));
    check('...and no extra window was opened', (await myWindows(M)).length === before, (await myWindows(M)).length);
    await p.getByRole('button', { name: /Discard/ }).click(); await p.waitForTimeout(1500);
    t = await body(p);
    check('discarding the edit returns to the window, unchanged', /Window 1/.test(t) && /QA Widget/.test(t));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(M);
  }

  console.log('5. A cart from before windows is moved into a window, not lost (T23)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await newPage(browser, 'qa_cashier', ctx);
    const start = await variantStock('QA Widget');
    await p.evaluate((wv) => {
      localStorage.setItem('emirates_pos_cart', JSON.stringify([{ id: wv.productId, productId: wv.productId, name: 'QA Widget', totalPrice: 300, qty: 1, unit: 'pcs', price: 300, variantId: wv.variantId, details: { lineItems: [{ type: 'accessory-full', qty: 3, meta: {}, rate: 100 }] } }]));
      localStorage.setItem('emirates_pos_customer', 'null');
    }, { productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId });
    await p.goto(BASE + '/sales'); await p.waitForTimeout(2500);
    const ws = await myWindows(CASH);
    check('a window now holds the old cart', ws.length === 1 && ws[0].items.length === 1, JSON.stringify(ws.map(w => w.items.length)));
    check('its 3 widgets are held', await variantStock('QA Widget') === start - 3, `${start} -> ${await variantStock('QA Widget')}`);
    check('the local copy is cleared', await p.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]').length) === 0);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await ctx.close();
    await closeAll(CASH);
  }

  console.log('6. Same cashier, two tabs (T24)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const a = await newPage(browser, 'qa_cashier', ctx);
    const b = await ctx.newPage(); b.errs = []; b.on('pageerror', e => b.errs.push(e.message)); b.on('dialog', d => d.accept());
    await a.goto(BASE + '/sales'); await b.goto(BASE + '/sales'); await a.waitForTimeout(1200);
    await pickCustomer(a); await openWidget(a); await addBtn(a).click(); await a.waitForTimeout(2500);
    check('tab B sees tab A\'s item', /QA Widget/.test(await body(b)));
    await openWidget(b); await setQty(b, 2); await addBtn(b).click(); await b.waitForTimeout(2500);
    const ws = await myWindows(CASH);
    check('both lines end up in the one window', ws.length === 1 && ws[0].items.length === 2, JSON.stringify(ws.map(w => w.items.length)));
    check('no page errors in either tab', a.errs.length + b.errs.length === 0, [...a.errs, ...b.errs].join(' | '));
    await ctx.close();
    await closeAll(CASH);
  }

  console.log('7. Sign Out releases the cashier\'s windows; the next person sees none (T25)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await newPage(browser, 'qa_cashier', ctx);
    const start = await variantStock('QA Widget');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 4); await addBtn(p).click(); await p.waitForTimeout(1500);
    check('4 held', await variantStock('QA Widget') === start - 4, `${start} -> ${await variantStock('QA Widget')}`);
    await p.getByText(/Sign Out|Logout/i).first().click(); await p.waitForTimeout(2000);
    check('signed out: the window is closed', (await myWindows(CASH)).length === 0);
    check('...and its 4 are back', await variantStock('QA Widget') === start, `${start} -> ${await variantStock('QA Widget')}`);
    const q = await newPage(browser, 'qa_manager', ctx);
    await q.goto(BASE + '/sales'); await q.waitForTimeout(1200);
    check('the next person on this till has no windows', !/Window 1/.test(await body(q)) && (await myWindows(M)).length === 0);
    check('no page errors', p.errs.length + q.errs.length === 0, [...p.errs, ...q.errs].join(' | '));
    await ctx.close();
  }

  console.log('8. After a network drop the till catches up with windows changed elsewhere (T26)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await newPage(browser, 'qa_cashier', ctx);
    await p.goto(BASE + '/sales'); await p.waitForTimeout(1200);
    await ctx.setOffline(true); await p.waitForTimeout(1500);
    const w = (await api(CASH, '/windows/', { method: 'POST', body: JSON.stringify({ label: 'From the phone' }) })).data;
    await ctx.setOffline(false); await p.waitForTimeout(9000);
    check('the window opened elsewhere appears', /From the phone/.test(await body(p)));
    await api(CASH, `/windows/${w.windowId}`, { method: 'DELETE' });
    await ctx.close();
  }

  console.log('9. Typing survives other tills\' saves; one product refetch per burst (T27)');
  {
    const p = await newPage(browser, 'qa_cashier');
    let fetches = 0;
    p.on('request', r => { if (/\/products\/(\?|$)/.test(r.url()) && r.method() === 'GET') fetches += 1; });
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 3); fetches = 0;
    const other = (await api(M, '/windows/', { method: 'POST', body: JSON.stringify({}) })).data;
    let ver = other.version;
    for (let i = 1; i <= 6; i++) { const r = await api(M, `/windows/${other.windowId}/cart`, { method: 'PUT', body: JSON.stringify({ version: ver, items: [widgetItem(i % 3 + 1)] }) }); ver = r.data.version; }
    await p.waitForTimeout(2000);
    check('the 3 entered is still in the calculator', await modalQty(p) === 3, await modalQty(p));
    check(`6 saves elsewhere -> at most 2 product refetches (got ${fetches})`, fetches <= 2);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await closeAll(M); await closeAll(CASH);
  }

  console.log('10. Checkout from a window: total shown = total charged; order number everywhere (T4, T28)');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p, 'QA Business');
    await openWidget(p); await setQty(p, 3); await addBtn(p).click(); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.waitForTimeout(800);
    await p.locator('input[placeholder="0"]').first().fill('25');   // DISCOUNT (KSH)
    await p.waitForTimeout(500);
    const shown = (await body(p)).replace(/,/g, '').match(/Confirm Payment · KSH\s*([\d.]+)/i);
    await p.getByRole('button', { name: /cash/i }).first().click();
    await p.getByRole('button', { name: /^Confirm/ }).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const orders = (await api(M, '/orders/')).data;
    const o = orders[0];
    check('reached the receipt', p.url().endsWith('/checkout/receipt'), p.url());
    check('total on screen = total charged', shown && Math.abs(parseFloat(shown[1]) - o.total) < 0.01, `${shown && shown[1]} vs ${o.total}`);
    check('order number differs from internal id (seed +1000)', o.orderNo && o.orderNo !== o.orderId, `${o.orderId}/${o.orderNo}`);
    check('the discount was charged: 300 - 25, + VAT', Math.abs(o.total - 319) < 0.01, o.total);
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1200);
    let t = await body(p);
    check('order card shows the order number', t.includes(String(o.orderNo)));
    await p.getByPlaceholder(/Search/).first().fill(`${o.orderNo}`); await p.waitForTimeout(1200);
    t = await body(p);
    check('searching the order number finds it', t.includes(String(o.orderNo)) && /QA Business/.test(t));
    await p.getByText(String(o.orderNo)).first().click(); await p.waitForTimeout(1500);
    t = await body(p);
    check('order summary names it by its ORDER NUMBER', new RegExp(`Order #?${o.orderNo}\\b`, 'i').test(t) && !new RegExp(`Order #?${o.orderId}\\b`, 'i').test(t), (t.match(/Order #?\d+/gi) || []).slice(0, 3).join(','));
    check('no window left open after the sale', (await myWindows(CASH)).length === 0);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('11. Managers see held stock; the CEO switch turns windows off and returns stock');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900); await pickCustomer(p);
    await openWidget(p); await setQty(p, 2); await addBtn(p).click(); await p.waitForTimeout(1500);
    const before = await variantStock('QA Widget');
    const m = await newPage(browser, 'qa_manager');
    await m.goto(BASE + '/inventory'); await m.waitForTimeout(1500);
    check('Stock Control shows the held items', /held in 1 open sale/.test(await body(m)), (await body(m)).match(/\d+ items? held[^\n]*/)?.[0]);
    const c = await newPage(browser, 'qa_ceo');
    await c.goto(BASE + '/orders'); await c.waitForTimeout(1200);
    await c.getByRole('button', { name: /Sale windows: On/ }).click(); await c.waitForTimeout(2000);
    check('switched off: the open window is closed', (await myWindows(CASH)).length === 0);
    check('...and its stock is back', await variantStock('QA Widget') === before + 2, `${before} -> ${await variantStock('QA Widget')}`);
    await p.waitForTimeout(3000); await p.reload(); await p.waitForTimeout(1500);
    check('the till falls back to the plain cart (no window tabs)', !/Window 1/.test(await body(p)));
    check('no page errors', p.errs.length + m.errs.length + c.errs.length === 0, [...p.errs, ...m.errs, ...c.errs].join(' | '));
    await p.context().close(); await m.context().close(); await c.context().close();
  }

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('Error:', e); process.exit(1); });
