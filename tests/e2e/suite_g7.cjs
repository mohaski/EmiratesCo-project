// Group-7 checks (remaining audit items). Test backend :8010 via Vite :5180.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${PW}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
let CEO, M, ME, PRODS, CUST, BIZ;
const prod = n => PRODS.find(p => p.name === n);
const body = p => p.locator('body').innerText();
const PRINT_COUNTER = () => { window.__prints = 0; window.print = () => { window.__prints += 1; }; };

async function newPage(browser, user, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (!ctxIn) await ctx.addInitScript(PRINT_COUNTER);
  const p = await ctx.newPage(); p.errs = []; p.dialogs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', async d => { p.dialogs.push(d.message()); await d.accept(); });
  if (user) {
    await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(user); await p.locator('input').nth(1).fill(PW);
    await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login')); await p.waitForTimeout(700);
  }
  return p;
}
async function pickCustomer(p, name = 'QA Customer') {
  await p.getByPlaceholder('Search by name or phone...').fill(name.slice(0, 6)); await p.getByText(name).first().click(); await p.waitForTimeout(300);
}
async function addWidget(p) {
  await p.getByRole('button', { name: /QA Accessories/ }).click(); await p.locator('.product-card').first().click();
  await p.getByRole('button', { name: '+ Add to Order' }).click(); await p.waitForTimeout(400);
}
const mkOrder = async (cust = CUST) => (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: cust.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) })).data.orderId;

(async () => {
  CEO = await tok('qa_ceo'); M = await tok('qa_manager'); ME = (await api(M, '/users/me')).data;
  PRODS = (await api(M, '/products/')).data;
  const custs = (await api(M, '/users/customers')).data; CUST = custs.find(c => c.name === 'QA Customer'); BIZ = custs.find(c => c.name === 'QA Business');
  const browser = await chromium.launch();

  console.log('1. Coming back to Sales keeps the customer (and VAT) of a cart in progress');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(700); await pickCustomer(p); await addWidget(p);
    await p.goto(BASE + '/orders'); await p.waitForTimeout(800);
    await p.getByText('Sales POS').click(); await p.waitForTimeout(1200);
    const t = await body(p);
    check('customer still selected (no "Select Customer" overlay)', !/Select Customer/.test(t) && /QA Customer/.test(t));
    const label = (await p.getByRole('button', { name: /^Checkout KSH/ }).innerText()).replace(/\s+/g, ' ').replace(/,/g, '');
    check('VAT still off for an individual: Checkout KSH100', /KSH ?100\b/.test(label), label);
    await p.evaluate(() => { localStorage.removeItem('emirates_pos_cart'); localStorage.removeItem('emirates_pos_customer'); });
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('2. Forgot password is honest');
  {
    const p = await newPage(browser);
    await p.goto(BASE + '/forgot-password'); await p.waitForTimeout(600);
    const t = await body(p);
    check('explains the admin reset', /administrator or the CEO/.test(t) && /User Management/.test(t));
    check('no fake "send link" form', !(await p.locator('input[type=email]').count()) && !/Send Reset Link/.test(t));
    await p.goto(BASE + '/reset-password'); await p.waitForTimeout(600);
    check('old reset link lands on the explanation', p.url().endsWith('/forgot-password'), p.url());
    await p.context().close();
  }

  console.log('3. Negative stock/price refused when creating a product (HTTP)');
  {
    const cats = (await api(CEO, '/products/categories')).data;
    const mk = v => api(CEO, '/products/', { method: 'POST', body: JSON.stringify({ name: 'G7 Neg ' + Math.random(), category_id: cats[0].categoryId, variants: [v] }) });
    check('negative stock -> 422', (await mk({ attributes: {}, stock_quantity: -5, price: 10 })).status === 422);
    check('negative price -> 422', (await mk({ attributes: {}, stock_quantity: 1, price: -10 })).status === 422);
    check('valid product still created', (await mk({ attributes: {}, stock_quantity: 1, price: 10 })).status === 200);
  }

  console.log('4. Add Attribute can be finished after stopping part-way');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/product-management'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'QA Profile' }).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'GENERAL' }).click(); await p.waitForTimeout(500);
    await p.locator('tbody tr', { hasText: 'QA Plain Bead' }).getByRole('button', { name: 'Manage Variants' }).click(); await p.waitForTimeout(600);
    const openPanel = async () => {
      await p.getByRole('button', { name: '+ Add Attribute' }).click(); await p.waitForTimeout(400);
      await p.locator('select').last().selectOption({ label: 'Color' }); await p.waitForTimeout(500);
      const selects = p.locator('select'); const n = await selects.count();
      if (n > 1) { await selects.nth(n - 1).selectOption({ index: 1 }).catch(() => {}); }
      const txt = p.locator('input[type=text]').last(); if (await txt.count()) await txt.fill('White').catch(() => {});
    };
    let failOnce = true;
    await p.route(/:8010\/products\/variants\/\d+$/, r => { if (failOnce && r.request().method() === 'PUT') { failOnce = false; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }); } return r.continue(); });
    await openPanel();
    await p.getByRole('button', { name: 'Save Attribute' }).click(); await p.waitForTimeout(1500);
    check('stopping part-way says how far it got and how to finish', p.dialogs.some(d => /Stopped after 0 of 1/.test(d) && /again to finish/.test(d)), p.dialogs.join(' | '));
    await p.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    await p.waitForTimeout(500);
    await openPanel();
    await p.getByRole('button', { name: 'Save Attribute' }).click(); await p.waitForTimeout(1800);
    check('second attempt offers to fill in the missing variant', p.dialogs.some(d => /already on this product. Fill it in for the 1 variant/.test(d)), p.dialogs.slice(-1)[0]);
    const bead = (await api(CEO, '/products/')).data.find(x => x.name === 'QA Plain Bead');
    check('the variant now has the attribute', !!bead.variants[0].attributes.Color, JSON.stringify(bead.variants[0].attributes));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('5. Open pack: Mark Finished asks first and can be undone');
  {
    const seal = prod('QA Sealant');
    await api(M, `/open-containers/products/${seal.productId}`, { method: 'POST', body: JSON.stringify({ variant_id: seal.variants[0].variantId }) });
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/inventory'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /Open Stock/ }).click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'Mark Finished' }).first().click(); await p.waitForTimeout(1200);
    check('asked to confirm', p.dialogs.some(d => /Mark this open pack/.test(d)), p.dialogs.join(' | '));
    let open = (await api(M, '/open-containers/')).data.filter(c => c.status === 'open' || !c.closed_at);
    check('pack finished', open.length === 0, open.length);
    await p.getByRole('button', { name: 'Undo' }).click(); await p.waitForTimeout(1200);
    open = (await api(M, '/open-containers/')).data.filter(c => c.status === 'open' || !c.closed_at);
    check('Undo reopened it', open.length === 1, open.length);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('6. Tool checkout drops a tool taken on another screen');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/tools'); await p.waitForTimeout(1200);
    const tools = (await api(CEO, '/tools/')).data.filter(t => t.status === 'available');
    for (const t of tools.slice(0, 2)) await p.getByText(t.name, { exact: true }).first().click().catch(() => {});
    await p.waitForTimeout(300);
    await api(M, '/tools/loans', { method: 'POST', body: JSON.stringify({ workerName: 'Elsewhere', toolIds: [tools[0].toolId] }) });
    await p.waitForTimeout(2000);
    const t = await body(p);
    check('notice that a selected tool was taken elsewhere', /were just checked out on another screen/.test(t));
    check('selection shows 1 tool left', /selected \(1\)/i.test(t), (t.match(/selected \(\d+\)/i) || [''])[0]);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('7. Quotation save failure is said on the page');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/invoice'); await p.waitForTimeout(800); await pickCustomer(p);
    await p.getByRole('button', { name: /QA Accessories/ }).click(); await p.locator('.product-card').first().click();
    await p.getByRole('button', { name: '+ Add to Invoice' }).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Review Invoice/ }).click(); await p.waitForTimeout(1200);
    await p.route(/:8010\/invoices\/$/, r => r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"database down"}' }) : r.continue());
    const save = p.getByRole('button', { name: /Save as Draft/ });
    if (await save.count()) {
      await save.click(); await p.waitForTimeout(1200);
      check('"Not saved" shown next to the button', /Not saved/.test(await body(p)));
      check('still on the quotation page', p.url().includes('/invoice/review'), p.url());
    } else check('reached the quotation review page', false, p.url());
    await p.evaluate(() => localStorage.removeItem('emirates_pos_cart'));
    await p.context().close();
  }

  console.log('8. Reprint starts with the order\'s departments ticked');
  {
    const v = prod('QA Profile Bar').variants[0];
    const id = (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Profile Bar').productId, variantId: v.variantId, quantity: 1, unitPrice: 1950, unitType: 'ft', details: { lineItems: [{ type: 'profile-full', label: 'Full Length', qty: 1, rate: 1950, total: 1950, meta: { length: '19.5ft' } }], quantity: 1 }, totalPrice: 1950 }] }) })).data.orderId;
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1000);
    await p.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await p.waitForTimeout(600);
    await p.getByText('QA Customer').first().click(); await p.waitForTimeout(1500);
    // The Print Receipt button only enables when at least one department is ticked.
    const printBtn = p.getByRole('button', { name: /Print Receipt/ });
    check('departments ticked: Print Receipt enabled straight away', (await printBtn.count()) > 0 && await printBtn.isEnabled());
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('9. A customer registered at checkout is searchable straight away');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(700);
    const name = 'QA New ' + Math.random().toString(36).slice(2, 6);
    await p.getByPlaceholder('Full Name').fill(name); await p.getByPlaceholder('Phone Number').fill('07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'));
    await p.getByRole('button', { name: /Register & Start/ }).click(); await p.waitForTimeout(1000);
    await p.getByRole('button', { name: new RegExp(name.split(' ')[2]) }).first().click().catch(() => {}); // open "change customer"
    await p.waitForTimeout(500);
    if (await p.getByPlaceholder('Search by name or phone...').count()) {
      await p.getByPlaceholder('Search by name or phone...').fill(name);
      check('new customer found in search', (await p.getByText(name).count()) > 0);
    } else check('opened customer picker again', false);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('10. Activity log knows the three missing types');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/activity'); await p.waitForTimeout(1200);
    const opts = await p.locator('select option').allInnerTexts();
    check('filter offers Cut confirmed / Change undone / Stock mode changed', ['Cut confirmed', 'Change undone', 'Stock mode changed'].every(l => opts.some(o => o.includes(l))) || ['cutting_report', 'order_undo', 'product_update'].every(l => opts.some(o => o.includes(l))), opts.slice(-4).join(' / '));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('11. Stock Control');
  {
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/inventory'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'QA Fittings' }).click(); await p.waitForTimeout(600);
    let t = await body(p);
    check('product with no variants shows no invented stock', /QA Bare Item/.test(t) && !/\b50\b/.test((t.split('QA Bare Item')[1] || '').slice(0, 80)));
    await p.getByPlaceholder('Search by name or item code...').fill('QA Bare'); await p.waitForTimeout(400);
    await p.getByText('+ Restock').first().click(); await p.waitForTimeout(500);
    check('restocking a product with no variants explains why not', p.dialogs.some(d => /has no variants yet/.test(d)), p.dialogs.join(' | '));
    await p.getByPlaceholder('Search by name or item code...').fill('QA Hinge'); await p.waitForTimeout(400);
    await p.getByText('+ Restock').first().click(); await p.waitForTimeout(500);
    const qty = p.locator('input[type=number]').last();
    await qty.fill('2.5'); await p.getByRole('button', { name: /Confirm Restock/ }).click(); await p.waitForTimeout(500);
    check('fraction refused with a message', p.dialogs.some(d => /whole number/.test(d)), p.dialogs.join(' | '));
    await qty.fill('3'); await p.getByRole('button', { name: /Confirm Restock/ }).click(); await p.waitForTimeout(600);
    const saved = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('emirates_pos_stock_cart_')).map(k => JSON.parse(localStorage.getItem(k)).length));
    check('session line saved', saved.length === 1 && saved[0] === 1, JSON.stringify(saved));
    await p.reload(); await p.waitForTimeout(1500);
    t = await body(p);
    check('line restored after a reload, with a notice', /1 line\(s\) restored from your last visit/.test(t) && /Finalize Session \(1\)/.test(t));
    await p.getByText('Sign Out').click(); await p.waitForTimeout(600);
    const left = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('emirates_pos_stock_cart_')).length);
    check('Sign Out clears it', left === 0, left);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('12. Order History finds older orders by customer name');
  {
    const old = await mkOrder(BIZ);
    for (let i = 0; i < 101; i++) await mkOrder();
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    await p.getByPlaceholder('Search by order ID or customer...').fill('QA Busi'); await p.waitForTimeout(1800);
    check(`order #${old} for QA Business (beyond the newest 100) found by name`, (await body(p)).includes(String(old)));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('13. Two tabs share one cart');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const a = await newPage(browser, 'qa_cashier', ctx);
    const b = await newPage(browser, null, ctx);
    await a.goto(BASE + '/sales'); await a.waitForTimeout(700); await pickCustomer(a);
    await b.goto(BASE + '/sales'); await b.waitForTimeout(1200);
    await addWidget(a); await a.waitForTimeout(800);
    const lb = (await b.getByRole('button', { name: /^Checkout KSH/ }).innerText().catch(() => '')).replace(/\s+/g, ' ').replace(/,/g, '');
    check('other tab shows the item without a reload', /KSH ?100\b/.test(lb), lb);
    await addWidget(b); await b.waitForTimeout(800);
    const len = await a.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]').length);
    check('adding in the other tab keeps both items (no overwrite)', len === 2, len);
    await a.evaluate(() => localStorage.removeItem('emirates_pos_cart'));
    await ctx.close();
  }

  console.log('14. New user gets a random temporary password, shown once');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/users'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /Register User/ }).click(); await p.waitForTimeout(400);
    const form = p.locator('form').last(); const inputs = form.locator('input'); const n = await inputs.count(); const tag = Math.random().toString(36).slice(2, 7);
    for (let i = 0; i < n; i++) { const el = inputs.nth(i); const type = await el.getAttribute('type'); const nm = (await el.getAttribute('name')) || '';
      if (type === 'email') await el.fill(`g7${tag}@qa-emiratesco.com`); else if (type === 'tel' || /phone/i.test(nm)) await el.fill('07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0')); else await el.fill(nm === 'username' ? `g7_${tag}` : 'G7'); }
    await form.locator('button[type=submit]').click(); await p.waitForTimeout(1500);
    const t = await body(p); const temp = (t.match(/Temporary password: (\w+)/) || [])[1];
    check('temporary password shown, not "1234"', !!temp && temp !== '1234', temp);
    const r = await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=g7_${tag}&password=${temp}` });
    check('it works for the first sign-in', r.status === 200, r.status);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('15. A timed-out failover push is followed to its result');
  {
    const p = await newPage(browser, 'qa_manager');
    let pushedAt = null;
    await p.route(/:8010\/failover\/status/, async r => {
      const resp = await r.fetch(); const j = await resp.json();
      j.peer_reachable = true; j.operation_in_progress = false;
      if (pushedAt && Date.now() - pushedAt > 4000) j.last_push = { direction: 'push', timestamp: new Date().toISOString(), success: true, detail: 'Restored on peer', peer: 'peer' };
      r.fulfill({ response: resp, json: j });
    });
    await p.route(/:8010\/failover\/push/, async r => { pushedAt = Date.now(); r.fulfill({ status: 504, contentType: 'application/json', body: '{"detail":"Gateway Timeout"}' }); });
    await p.goto(BASE + '/failover'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Fail over to/ }).click(); await p.waitForTimeout(1500);
    check('says the push may still be running', /may still be running/.test(await body(p)));
    await p.waitForTimeout(9000);
    const t = await body(p);
    check('then reports it finished', /The push finished/.test(t) && !/may still be running/.test(t));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const f = results.filter(x => !x).length;
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
