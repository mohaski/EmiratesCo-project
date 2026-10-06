// Group-6 checks (sessions, WebSocket, refresh races, printing, lists, timezones).
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async (u, p = PW) => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${encodeURIComponent(p)}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
const uniq = () => Math.random().toString(36).slice(2, 7);
let CEO, M, ME, WIDGET, CUST;
const body = p => p.locator('body').innerText();
// The receipt number as a whole number on the page (orders are numbered 1000 above their
// internal id, so a substring of the id - 37 inside #1037 - proves nothing).
const showsNo = (txt, no) => no != null && new RegExp(`(^|[^0-9])${no}([^0-9]|$)`).test(txt);
const cartLen = p => p.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]').length);

// Tracks every WebSocket the page opens, so tests can count/close them.
const WS_TRACKER = () => {
  const Orig = window.WebSocket; window.__sockets = [];
  window.WebSocket = function (...a) { const s = new Orig(...a); window.__sockets.push(s); return s; };
  window.WebSocket.prototype = Orig.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
};
const PRINT_COUNTER = () => { window.__prints = 0; window.print = () => { window.__prints += 1; }; };

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}) });
  await ctx.addInitScript(WS_TRACKER); await ctx.addInitScript(PRINT_COUNTER);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  return p;
}
async function login(p, u, pw = PW) {
  await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(u); await p.locator('input').nth(1).fill(pw);
  await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 }); await p.waitForTimeout(800);
}
async function addWidget(p) {
  await p.goto(BASE + '/sales'); await p.waitForTimeout(700);
  await p.getByPlaceholder('Search by name or phone...').fill('QA Cust'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /QA Accessories/ }).click(); await p.locator('.product-card').first().click();
  await p.getByRole('button', { name: '+ Add to Order' }).click(); await p.waitForTimeout(400);
}
async function newCashier() {
  const u = 'qa_s6_' + uniq();
  await api(CEO, '/users/register', { method: 'POST', body: JSON.stringify({ firstName: 'S', secondName: 'Six', username: u, role: 'cashier', email: `${u}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'), password: 'Temp1234' }) });
  const t = await tok(u, 'Temp1234'); const id = (await api(t, '/users/me')).data.userId;
  await api(t, `/users/${id}/change-password`, { method: 'POST', body: JSON.stringify({ currentPassword: 'Temp1234', newPassword: PW, confirmNewPassword: PW }) });
  return { u, id };
}
const sale = async () => (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: WIDGET.productId, variantId: WIDGET.variants[0].variantId, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) })).data.orderId;

(async () => {
  CEO = await tok('qa_ceo'); M = await tok('qa_manager'); ME = (await api(M, '/users/me')).data;
  WIDGET = (await api(M, '/products/')).data.find(p => p.name === 'QA Widget');
  CUST = (await api(M, '/users/customers')).data.find(c => c.name === 'QA Customer');
  const browser = await chromium.launch();

  console.log('1. Session ends mid-shift: cart kept for the same person, not for the next one');
  {
    const a = await newCashier(), b = await newCashier();
    const p = await newPage(browser);
    await login(p, a.u); await addWidget(p);
    check('cart has the item', (await cartLen(p)) === 1);
    await api(CEO, `/users/${a.id}/status`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    await p.goto(BASE + '/orders'); await p.waitForTimeout(2000);
    check('sent to the login screen', p.url().includes('/login'), p.url());
    let t = await body(p);
    check('one "session has ended" message (not a pile of them)', (t.match(/session has ended/g) || []).length === 1, (t.match(/session has ended/g) || []).length);
    check('cart kept', (await cartLen(p)) === 1);
    await api(CEO, `/users/${a.id}/status`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
    await login(p, a.u); await p.goto(BASE + '/sales'); await p.waitForTimeout(800);
    check('same person signs back in: cart still there', (await cartLen(p)) === 1);
    await p.getByText('Sign Out').click(); await p.waitForTimeout(600);
    check('Sign Out clears the cart', (await cartLen(p)) === 0);
    await login(p, a.u); await addWidget(p);
    await api(CEO, `/users/${a.id}/status`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    await p.goto(BASE + '/orders'); await p.waitForTimeout(2000);
    await login(p, b.u); await p.goto(BASE + '/sales'); await p.waitForTimeout(800);
    check('a different person signing in gets an empty cart', (await cartLen(p)) === 0);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('2. Server unreachable on reload: no sign-out, retry screen, cart kept');
  {
    const p = await newPage(browser);
    await login(p, 'qa_cashier'); await addWidget(p);
    await p.route(/:8010\//, r => r.abort());
    await p.reload(); await p.waitForTimeout(2500);
    let t = await body(p);
    check('"Can\'t reach the server" screen', /Can't reach the server/.test(t));
    check('not on the login screen', !p.url().includes('/login'));
    check('token kept', !!(await p.evaluate(() => localStorage.getItem('token'))));
    check('cart kept', (await cartLen(p)) === 1);
    await p.unroute(/:8010\//);
    await p.getByRole('button', { name: 'Retry now' }).click(); await p.waitForTimeout(2000);
    t = await body(p);
    check('back in the app once the server answers', /Sign Out/.test(t) && !/Can't reach the server/.test(t));
    await p.evaluate(() => localStorage.removeItem('emirates_pos_cart'));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('3. WebSocket: one socket while signed in, none after signing out');
  {
    const p = await newPage(browser);
    await login(p, 'qa_manager'); await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    // Only the app's socket — Vite's own dev-server socket is on the page too.
    const open = () => p.evaluate(() => window.__sockets.filter(s => s.url.includes(':8010/ws') && s.readyState === 1).length);
    check('exactly one open socket', (await open()) === 1, await open());
    await p.getByText('Sign Out').click(); await p.waitForTimeout(1500);
    check('closed after Sign Out', (await open()) === 0, await open());
    let reqs = 0; p.on('request', r => { if (r.url().includes(':8010/orders')) reqs++; });
    await sale(); await p.waitForTimeout(1500);
    check('a sale elsewhere triggers no requests on the login screen', reqs === 0, reqs);

    console.log('4. Reconnect: events missed while disconnected are caught up');
    await login(p, 'qa_manager'); await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__sockets.forEach(s => { if (s.url.includes(':8010/ws') && s.readyState === 1) s.close(); }));
    const missed = await sale(); // broadcast while this screen is disconnected
    await p.waitForTimeout(7000);
    const missedNo = (await api(M, `/orders/${missed}`)).data.orderNo;
    check('order made while disconnected appears after the reconnect', showsNo(await body(p), missedNo), `order no. ${missedNo}`);
    check('still exactly one open socket', (await open()) === 1, await open());
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('5. CEO dashboard: a slow answer for the old period can\'t land under the new one');
  {
    const p = await newPage(browser);
    await login(p, 'qa_ceo'); await p.waitForTimeout(1500);
    await p.route(/\/financials\/summary\?period=day/, async r => {
      await new Promise(res => setTimeout(res, 2500));
      const resp = await r.fetch(); const j = await resp.json(); j.total = 987654; r.fulfill({ response: resp, json: j });
    });
    await p.getByRole('button', { name: 'Year' }).click(); await p.waitForTimeout(200);
    await p.getByRole('button', { name: 'Day' }).click(); await p.waitForTimeout(150);
    await p.getByRole('button', { name: 'Month' }).click(); await p.waitForTimeout(4000);
    check('month view never shows the late "day" figure', !(await body(p)).replace(/,/g, '').includes('987654'));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('6. Receipt: auto-prints once per sale, not again on reload');
  {
    const p = await newPage(browser);
    await login(p, 'qa_cashier');
    // A profile bar: it has a department slip to print (the plain widget's category has none).
    await p.goto(BASE + '/sales'); await p.waitForTimeout(700);
    await p.getByPlaceholder('Search by name or phone...').fill('QA Cust'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: /QA Profile/ }).click(); await p.waitForTimeout(400);
    await p.locator('.product-card', { hasText: 'QA Profile Bar' }).click(); await p.waitForTimeout(800);
    await p.locator('input[type=number]').first().fill('1'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: '+ Add to Order' }).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.getByRole('button', { name: /cash/i }).click(); await p.getByRole('button', { name: /^Confirm/ }).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 });
    // No QZ Tray on this machine: the browser fallback runs once QZ's connection attempt gives up.
    await p.waitForFunction(() => window.__prints > 0, null, { timeout: 30000 }).catch(() => {});
    const first = await p.evaluate(() => window.__prints);
    await p.reload(); await p.waitForTimeout(15000);
    const after = await p.evaluate(() => window.__prints);
    check('printed on arrival (browser fallback, no QZ Tray here)', first === 1, first);
    check('no reprint after a reload', after === 0, `prints after reload: ${after}`);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('7. Order History finds an order older than the loaded list');
  {
    const oldest = await sale();
    for (let i = 0; i < 102; i++) await sale();
    const p = await newPage(browser);
    await login(p, 'qa_manager'); await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    // Searched the way a person does: by the receipt number, not the internal id.
    const oldestNo = (await api(M, `/orders/${oldest}`)).data.orderNo;
    await p.getByPlaceholder('Search by order ID or customer...').fill(String(oldestNo)); await p.waitForTimeout(1500);
    const t = await body(p);
    check('order beyond the first 100 found by its number', !/No orders found/.test(t) && showsNo(t, oldestNo), `order no. ${oldestNo}`);
    check('it can be opened for editing', (await p.getByRole('button', { name: /Edit/ }).count()) > 0);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('8. Times are right on a device not set to Nairobi time');
  {
    const id = await sale();
    const o = (await api(M, `/orders/${id}`)).data; // naive Nairobi wall-clock time
    const nairobi = o.created_at.slice(11, 16);
    const [h, m] = nairobi.split(':').map(Number);
    const utcHHMM = `${String((h - 3 + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    for (const [tz, want] of [['Africa/Nairobi', nairobi], ['UTC', utcHHMM]]) {
      const p = await newPage(browser, { timezoneId: tz });
      await login(p, 'qa_manager'); await p.goto(BASE + '/orders'); await p.waitForTimeout(1200);
      await p.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await p.waitForTimeout(800);
      const t = await body(p);
      check(`${tz}: order time shown as ${want}`, t.includes(want), (t.match(/\d{1,2} \w{3},? \d{2}:\d{2}/) || [''])[0]);
      check(`${tz}: no page errors`, p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }
  }

  console.log('9. Drafts survive background refreshes');
  {
    const p = await newPage(browser);
    await login(p, 'qa_ceo');
    await p.goto(BASE + '/product-management'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'QA Profile' }).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'GENERAL' }).click(); await p.waitForTimeout(500);
    await p.locator('tbody tr', { hasText: 'QA Plain Bead' }).locator('button[title="Edit"]').click(); await p.waitForTimeout(500);
    const name = p.getByPlaceholder('Enter product name...');
    await name.fill('QA Plain Bead (typing)');
    await sale(); await p.waitForTimeout(2000); // products_updated -> list refetch
    check('product name being typed survives a refresh', (await name.inputValue()) === 'QA Plain Bead (typing)', await name.inputValue());
    await p.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    await p.goto(BASE + '/tools/manage'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /Catalog/i }).click().catch(() => {}); await p.waitForTimeout(800);
    await p.locator('tr', { hasText: 'QA Grinder' }).getByRole('button', { name: 'Edit' }).click(); await p.waitForTimeout(300);
    const input = p.locator('tr').filter({ has: p.locator('input') }).locator('input').first();
    await input.fill('QA Grinder (typing)');
    const tools = (await api(CEO, '/tools/')).data; const drill = tools.find(t => t.status === 'available' && t.name !== 'QA Grinder');
    if (drill) await api(M, '/tools/loans', { method: 'POST', body: JSON.stringify({ workerName: 'W', toolIds: [drill.toolId] }) });
    await p.waitForTimeout(2000);
    check('tool name being typed survives a catalogue refresh', (await input.inputValue().catch(() => '')) === 'QA Grinder (typing)');
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const f = results.filter(x => !x).length;
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
