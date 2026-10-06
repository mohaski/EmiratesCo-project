// Browser regression suite for the group-1 fixes. Runs against the test backend
// (port 8010, emiratesco_edit_test) through Vite on 5180.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180';
const API = 'http://localhost:8010';
const PW = 'Test1234!';

const results = [];
const check = (label, ok, extra = '') => { results.push({ label, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`); };

async function apiToken(username) {
  const r = await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${username}&password=${encodeURIComponent(PW)}` });
  return (await r.json()).access_token;
}
async function api(token, path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await r.text();
  try { return { status: r.status, data: JSON.parse(body) }; } catch { return { status: r.status, data: body }; }
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  return page;
}
async function login(page, username) {
  await page.goto(BASE + '/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(PW);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
}
async function pickCustomer(page) {
  await page.getByPlaceholder('Search by name or phone...').fill('QA Cust');
  await page.getByText('QA Customer').first().click();
  await page.waitForTimeout(500);
}
async function addWidgetAndCheckout(page) {
  await page.getByRole('button', { name: /QA Accessories/ }).click();
  await page.locator('.product-card').first().click();
  await page.getByRole('button', { name: '+ Add to Order' }).click();
  await page.getByRole('button', { name: /^Checkout KSH/ }).click();
  await page.waitForURL('**/checkout');
}
const bodyText = (page) => page.locator('body').innerText();
// The receipt number as a whole number on the page (orders are numbered 1000 above their
// internal id, so a substring of the id - 37 inside #1037 - proves nothing).
const showsNo = (txt, no) => no != null && new RegExp(`(^|[^0-9])${no}([^0-9]|$)`).test(txt);

(async () => {
  const browser = await chromium.launch();
  const mgr = await apiToken('qa_manager');

  // ── 1. Full-payment sale (cashier) ─────────────────────────────────────────
  console.log('1. Cashier sale, paid in full');
  {
    const page = await newPage(browser);
    await login(page, 'qa_cashier');
    await pickCustomer(page);
    await addWidgetAndCheckout(page);
    await page.getByRole('button', { name: /cash/i }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    check('reaches receipt page', page.url().endsWith('/checkout/receipt'), page.url());
    const orders = (await api(mgr, '/orders/')).data;
    const o = orders[0];
    check('order stored as Paid', o && o.paymentStatus === 'Paid', o && `${o.paymentStatus} bal=${o.balance}`);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));

    // ── 2. Order History shows it immediately (refresh after sale) ──────────
    console.log('2. Order History reflects the new sale');
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1500);
    const txt = await bodyText(page);
    check('new order listed', showsNo(txt, o.orderNo), `order no. ${o.orderNo}`);
    await page.context().close();
  }

  // ── 3. Partial payment sale ────────────────────────────────────────────────
  console.log('3. Cashier sale, partial payment 40 of 100');
  {
    const page = await newPage(browser);
    await login(page, 'qa_cashier');
    await pickCustomer(page);
    await addWidgetAndCheckout(page);
    await page.getByRole('button', { name: 'Pay Partial / Later' }).click();
    await page.getByPlaceholder('Enter amount...').fill('40');
    await page.getByRole('button', { name: /cash/i }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = (await api(mgr, '/orders/')).data[0];
    check('order stored as Partial with balance 60', o && o.paymentStatus === 'Partial' && Math.abs(o.balance - 60) < 0.5, o && `${o.paymentStatus} bal=${o.balance}`);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // ── 4. Refresh failure keeps the list; dropped-refresh fix ────────────────
  console.log('4. Order list survives a failed background refresh');
  {
    const page = await newPage(browser);
    await login(page, 'qa_manager');
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1500);
    const before = (await api(mgr, '/orders/')).data.map(o => o.orderNo);
    const shownBefore = before.filter(async () => true).length;
    let failNext = true; let blocked = 0;
    await page.route(/:8010\/orders\/(\?.*)?$/, route => {
      if (failNext && route.request().method() === 'GET') { blocked++; return route.fulfill({ status: 500, body: '{"detail":"boom"}', contentType: 'application/json' }); }
      return route.continue();
    });
    // Another till makes a sale -> server broadcasts orders_updated -> this page refetches (and fails).
    const cashierTok = await apiToken('qa_cashier');
    const ids = { variant: null };
    const prods = (await api(cashierTok, '/products/')).data;
    const prod = prods.find(p => p.name === 'QA Widget');
    ids.variant = prod.variants[0].variantId || prod.variants[0].variant_id || prod.variants[0].id;
    const me = (await api(cashierTok, '/users/me')).data;
    await api(cashierTok, '/orders/', { method: 'POST', body: JSON.stringify({ servedBy: me.userId, amountPaid: 100, paymentMethod: 'cash', items: [{ productId: prod.productId, variantId: ids.variant, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) });
    await page.waitForTimeout(2500);
    let txt = await bodyText(page);
    check('a background refresh actually ran (and was failed)', blocked > 0, `blocked=${blocked}`);
    const missing = before.filter(no => !showsNo(txt, no));
    check('existing orders still shown after failed refresh', missing.length === 0, `missing ${missing.join(',')}`);
    check('error banner shown', /failed to load/i.test(txt));
    check('not blanked to "No orders"', !/no orders found/i.test(txt));
    // Recovery: next event succeeds and brings in the new order.
    failNext = false;
    await api(cashierTok, '/orders/', { method: 'POST', body: JSON.stringify({ servedBy: me.userId, amountPaid: 100, paymentMethod: 'cash', items: [{ productId: prod.productId, variantId: ids.variant, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) });
    await page.waitForTimeout(2500);
    const latest = (await api(mgr, '/orders/')).data.slice(0, 2).map(o => o.orderNo);
    txt = await bodyText(page);
    check('recovers and shows both new orders', latest.every(no => showsNo(txt, no)), latest.join(','));
    check('error banner cleared', !/failed to load/i.test(txt));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    void shownBefore;
    await page.context().close();
  }

  // ── 5. Route guard ─────────────────────────────────────────────────────────
  console.log('5. Route guard (trailing slash / case / unknown)');
  {
    const page = await newPage(browser);
    await login(page, 'qa_cashier');
    for (const path of ['/users/', '/USERS', '/offcuts/', '/activity/', '/Product-Management']) {
      await page.goto(BASE + path); await page.waitForTimeout(1200);
      const p = new URL(page.url()).pathname;
      // '/' itself forwards a cashier on to '/sales'.
      check(`cashier ${path} blocked`, p === '/' || p === '/sales', p);
    }
    for (const path of ['/orders', '/orders/', '/sales/']) {
      await page.goto(BASE + path); await page.waitForTimeout(1200);
      const p = new URL(page.url()).pathname;
      check(`cashier ${path} still allowed`, p.replace(/\/$/, '') === path.replace(/\/$/, ''), p);
    }
    await page.goto(BASE + '/select-role'); await page.waitForTimeout(1200);
    const t = await bodyText(page);
    check('/select-role no longer offers role switching', !/CEO \/ Admin/i.test(t) && !/select.*role/i.test(t));
    check('no page errors (cashier)', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();

    const ceo = await newPage(browser);
    await login(ceo, 'qa_ceo');
    for (const path of ['/users', '/users/', '/activity', '/offcuts']) {
      await ceo.goto(BASE + path); await ceo.waitForTimeout(1200);
      const p = new URL(ceo.url()).pathname;
      check(`ceo ${path} allowed`, p.replace(/\/$/, '') === path.replace(/\/$/, ''), p);
    }
    check('no page errors (ceo)', ceo.errors.length === 0, ceo.errors.join(' | '));
    await ceo.context().close();
  }

  // ── 6. 422 validation list renders as text (used to white-screen) ─────────
  console.log('6. Register user with an email the backend rejects (422 list)');
  {
    const page = await newPage(browser);
    await login(page, 'qa_admin');
    await page.goto(BASE + '/users'); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /register|add user|new user/i }).first().click();
    await page.waitForTimeout(500);
    const modal = page.locator('form').last();
    const inputs = modal.locator('input');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      const type = await el.getAttribute('type'); const name = (await el.getAttribute('name')) || '';
      if (type === 'email') await el.fill('john@shop');
      else if (type === 'tel' || /phone/i.test(name)) await el.fill('0733333333');
      else if (type === 'password') await el.fill('Secret123');
      else await el.fill('qa_reg_' + i);
    }
    await modal.locator('button[type=submit]').click();
    await page.waitForTimeout(1500);
    const txt = await bodyText(page);
    check('app still rendered (sidebar present)', /Sign Out/.test(txt));
    check('validation message shown as text', /email/i.test(txt) && !/\[object Object\]/.test(txt));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // ── 7. Structured 409 detail renders (PaymentModal, toast) ────────────────
  console.log('7. Collect-debt payment rejected with a structured 409 detail');
  {
    const page = await newPage(browser);
    await login(page, 'qa_cashier');
    await page.route(/:8010\/financials\/payments$/, route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: { message: 'Payment conflicts with a newer change.', reasons: ['Reload the order.'] } }) });
      return route.continue();
    });
    await page.goto(BASE + '/collect-payments'); await page.waitForTimeout(2000);
    const collectBtn = page.getByRole('button', { name: '💰 Collect Debt' }).first();
    if (await collectBtn.count()) {
      await collectBtn.click(); await page.waitForTimeout(600);
      await page.locator('input[type=number]').first().fill('10');
      await page.getByRole('button', { name: /CASH/i }).first().click().catch(() => {});
      await page.getByRole('button', { name: /^Record/ }).click();
      await page.waitForTimeout(1500);
      const txt = await bodyText(page);
      check('message + reason shown', txt.includes('Payment conflicts with a newer change.') && txt.includes('Reload the order.'));
      check('no "[object Object]" anywhere', !txt.includes('[object Object]'));
      check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    } else {
      check('collect-debt list has an order to collect', false, 'no collect button found');
    }
    await page.context().close();
  }

  // ── 8. Cancel with wrong PIN shows the server's message ───────────────────
  console.log('8. Cancel order with a wrong PIN');
  {
    const ceoTok = await apiToken('qa_ceo');
    const pinRes = await api(ceoTok, '/settings/cancel-pin', { method: 'PUT', body: JSON.stringify({ pin: '4321', currentPassword: PW }) });
    const pinRes2 = pinRes.status < 300 ? pinRes : await api(ceoTok, '/settings/cancel-pin', { method: 'POST', body: JSON.stringify({ pin: '4321', currentPassword: PW }) });
    check('cancel PIN configured', pinRes2.status < 300, `status ${pinRes2.status}`);
    const page = await newPage(browser);
    await login(page, 'qa_manager');
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /cancel/i }).first().click(); await page.waitForTimeout(600);
    const cancelForm = page.locator('form').last();
    await cancelForm.getByRole('button', { name: /cash/i }).first().click().catch(() => {});
    await page.locator('input[type=password], input[inputmode=numeric]').first().fill('0000');
    await cancelForm.getByRole('button', { name: 'Cancel Order' }).click();
    await page.waitForTimeout(1500);
    const txt = await bodyText(page);
    check('wrong-PIN message shown', txt.includes('Incorrect PIN.'));
    const still = (await api(mgr, '/orders/')).data.find(o => o.status !== 'cancelled');
    check('order not cancelled', !!still);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // ── 9. Stale lazy chunk -> boundary reloads once, then explains ───────────
  console.log('9. Missing page chunk is caught by the error boundary');
  {
    const page = await newPage(browser);
    await login(page, 'qa_cashier');
    await page.goto(BASE + '/sales'); await page.waitForTimeout(1200);
    await pickCustomer(page);
    await page.getByRole('button', { name: /QA Accessories/ }).click();
    await page.locator('.product-card').first().click();
    await page.getByRole('button', { name: '+ Add to Order' }).click();
    await page.waitForTimeout(500);
    await page.route(/\/src\/pages\/OrdersPage\.jsx/, route => route.abort());
    let reloads = 0; page.on('load', () => reloads++);
    await page.getByText('Order History').click();
    await page.waitForTimeout(4000);
    const txt = await bodyText(page);
    check('boundary message shown', /new version of the app|Something went wrong/i.test(txt), txt.slice(0, 120).replace(/\n/g, ' '));
    check('sidebar still rendered (not white screen)', /Sign Out/.test(txt));
    check('auto-reload happened at most once', reloads <= 1, `reloads=${reloads}`);
    await page.unroute(/\/src\/pages\/OrdersPage\.jsx/);
    await page.getByText('Sales POS').click(); await page.waitForTimeout(1500);
    const txt2 = await bodyText(page);
    check('navigating away recovers', !/new version of the app|Something went wrong/i.test(txt2));
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]'));
    check('cart survived', cart.length === 1 && cart[0].name === 'QA Widget', JSON.stringify(cart.map(c => c.name)));
    await page.context().close();
  }

  // ── 10. Logout then login as another user: lists belong to the new session ─
  console.log('10. Logout / login as another role');
  {
    const page = await newPage(browser);
    await login(page, 'qa_manager');
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1200);
    await page.getByText('Sign Out').click(); await page.waitForTimeout(800);
    check('back on login', page.url().includes('/login'));
    await login(page, 'qa_ceo');
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1500);
    const txt = await bodyText(page);
    const latest = (await api(mgr, '/orders/')).data[0].orderNo;
    check('orders loaded for new session', showsNo(txt, latest), `order no. ${latest}`);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:', failed.map(f => f.label)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
