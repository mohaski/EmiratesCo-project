// Group-5 checks (inventory & orders), browser + HTTP. Test backend :8010 via Vite :5180.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${PW}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
let CEO, M, ME, PRODS, CUST;
const prod = n => PRODS.find(p => p.name === n);
const variantOf = async n => (await api(M, '/products/')).data.find(p => p.name === n).variants[0];
const body = p => p.locator('body').innerText();

async function newPage(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.errs = []; p.dialogs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', async d => { p.dialogs.push(d.message()); await d.accept(); });
  await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(user); await p.locator('input').nth(1).fill(PW);
  await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login')); await p.waitForTimeout(700);
  return p;
}
async function openProfileProducts(p) {
  await p.goto(BASE + '/product-management'); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'QA Profile' }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'GENERAL' }).click(); await p.waitForTimeout(500);
}
const row = (p, name) => p.locator('tbody tr', { hasText: name });
async function sellCut(feet) {
  const v = prod('QA Tracked Bar').variants[0];
  const line = { type: 'profile-cut', label: `Custom Cut (${feet}ft)`, qty: 1, rate: 100, total: feet * 100, meta: { length: feet, unit: 'ft' } };
  const r = await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Tracked Bar').productId, variantId: v.variantId, quantity: 1, unitPrice: feet * 100, unitType: 'ft', details: { lineItems: [line], quantity: 1 }, totalPrice: feet * 100 }] }) });
  if (r.status !== 200) throw new Error('sellCut ' + JSON.stringify(r.data));
  return r.data.orderId;
}

(async () => {
  CEO = await tok('qa_ceo'); M = await tok('qa_manager'); ME = (await api(M, '/users/me')).data;
  PRODS = (await api(M, '/products/')).data; CUST = (await api(M, '/users/customers')).data.find(c => c.name === 'QA Customer');
  const browser = await chromium.launch();

  console.log('1. Variant editor');
  {
    const p = await newPage(browser, 'qa_ceo');
    await openProfileProducts(p);
    await row(p, 'QA Profile Bar').getByRole('button', { name: 'Manage Variants' }).click(); await p.waitForTimeout(600);
    await p.locator('button[title="Edit pricing"]').click(); await p.waitForTimeout(300);
    await p.locator('input[type=number]').first().fill('9999');
    await p.getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(400);
    await row(p, 'QA Tracked Bar').getByRole('button', { name: 'Manage Variants' }).click(); await p.waitForTimeout(600);
    check('next product opens with no edit left open (same "White - 21ft" label)', !(await p.getByRole('button', { name: 'Save Changes' }).count()));
    check('tracked bar price untouched', (await variantOf('QA Tracked Bar')).price === 2100);
    await p.locator('button[title="Edit pricing"]').click(); await p.waitForTimeout(300);
    const nums = p.locator('input[type=number]');
    await nums.first().fill('');
    await p.getByRole('button', { name: 'Save Changes' }).click(); await p.waitForTimeout(1200);
    check('clearing the price box keeps the price (was saved as 0)', (await variantOf('QA Tracked Bar')).price === 2100, (await variantOf('QA Tracked Bar')).price);
    const stockBefore = (await variantOf('QA Tracked Bar')).stock_quantity;
    await p.locator('button[title="Edit pricing"]').click(); await p.waitForTimeout(300);
    // The stock box is the one under its "Adjust Stock" label - not a guess by position.
    await p.locator('text=Adjust Stock').locator('xpath=..').locator('input[type=number]').fill('-999');
    await p.getByRole('button', { name: 'Save Changes' }).click(); await p.waitForTimeout(1200);
    const after = (await variantOf('QA Tracked Bar')).stock_quantity;
    check('removing more stock than exists is refused with the reason', p.dialogs.some(d => /Can't remove 999/.test(d)), p.dialogs.join(' | '));
    check('stock unchanged', after === stockBefore, `${stockBefore} -> ${after}`);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('2. Edit product: blank name refused, dialog stays open');
  {
    const p = await newPage(browser, 'qa_ceo');
    await openProfileProducts(p);
    await row(p, 'QA Plain Bead').locator('button[title="Edit"]').click(); await p.waitForTimeout(500);
    await p.getByPlaceholder('Enter product name...').fill('   ');
    await p.getByRole('button', { name: 'Save Changes' }).click(); await p.waitForTimeout(800);
    check('blank name warned', p.dialogs.some(d => /can't be blank/.test(d)), p.dialogs.join(' | '));
    check('dialog still open', await p.getByPlaceholder('Enter product name...').isVisible());
    check('name unchanged on the server', (await api(M, '/products/')).data.some(x => x.name === 'QA Plain Bead'));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('3. Attributes in use (HTTP)');
  {
    const classes = (await api(CEO, '/attributes/')).data;
    const color = classes.find(c => c.name === 'Color'), spare = classes.find(c => c.name === 'Unused Finish');
    const r1 = await api(CEO, `/attributes/${color.attributeClassId}`, { method: 'PUT', body: JSON.stringify({ name: 'Colour' }) });
    check('renaming Color (used by bars) refused with product names', r1.status === 409 && /QA Profile Bar|QA Tracked Bar/.test(r1.data.detail), `${r1.status} ${JSON.stringify(r1.data).slice(0, 120)}`);
    const white = color.values.find(v => v.value === 'White'), teal = color.values.find(v => v.value === 'Unused Teal');
    check('deleting value White (in use) refused', (await api(CEO, `/attributes/values/${white.attributeValueId}`, { method: 'DELETE' })).status === 409);
    check('deleting an unused value works', (await api(CEO, `/attributes/values/${teal.attributeValueId}`, { method: 'DELETE' })).status === 200);
    check('renaming an unused class works', (await api(CEO, `/attributes/${spare.attributeClassId}`, { method: 'PUT', body: JSON.stringify({ name: 'Unused Finish 2' }) })).status === 200);
  }

  console.log('4. Tools: editing a tool checked out meanwhile');
  {
    const tools = (await api(CEO, '/tools/')).data; const drill = tools.find(t => t.name === 'QA Drill');
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/tools/manage'); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /Catalog/i }).click().catch(() => {}); await p.waitForTimeout(800);
    const r = p.locator('tr', { hasText: 'QA Drill' });
    const loan = await api(M, '/tools/loans', { method: 'POST', body: JSON.stringify({ workerName: 'Worker A', toolIds: [drill.toolId] }) });
    check('drill checked out on another screen', loan.status === 200, loan.status);
    await r.getByRole('button', { name: 'Edit' }).click(); await p.waitForTimeout(300);
    await p.locator('tr').filter({ has: p.locator('input') }).locator('input').first().fill('QA Drill Pro');
    await p.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(1200);
    const t2 = (await api(CEO, '/tools/')).data.find(t => t.toolId === drill.toolId);
    check('name saved', t2.name === 'QA Drill Pro', t2.name);
    check('still "taken" — not freed by the edit', t2.status === 'taken', t2.status);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('5. Sales shows products with no sub-category / no colour');
  {
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(700);
    await p.getByPlaceholder('Search by name or phone...').fill('QA Cust'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: /QA Fittings/ }).click(); await p.waitForTimeout(700);
    check('QA Hinge (no sub-category) listed', /QA Hinge/.test(await body(p)));
    await p.getByRole('button', { name: /QA Profile/ }).click(); await p.waitForTimeout(700);
    const t = await body(p);
    check('QA Plain Bead (no colour) listed', /QA Plain Bead/.test(t));
    check('coloured White bars still listed under White', /QA Profile Bar/.test(t));
    await p.getByRole('button', { name: 'Brown' }).click(); await p.waitForTimeout(500);
    const tb = await body(p);
    check('White-only bars hidden under Brown', !/QA Profile Bar/.test(tb));
    check('colourless bead still shown under Brown', /QA Plain Bead/.test(tb));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('6. Offcut correction end to end (HTTP)');
  let cutOrder;
  {
    cutOrder = await sellCut(7);
    const o = (await api(M, `/orders/${cutOrder}`)).data;
    const item = o.items[0]; const ev = item.details.lineItems[0].offcut_sources[0];
    check('sale recorded a cutting event', !!ev, JSON.stringify(ev || {}).slice(0, 100));
    const req = { item_id: item.itemId, line_idx: 0, event_idx: 0, new_remainder_length: 13, replace_source: false, expected_event: ev };
    const r1 = await api(M, `/orders/${cutOrder}/correct-profile-offcut`, { method: 'PUT', body: JSON.stringify(req) });
    check('correction with the event as shown is accepted', r1.status === 200, `${r1.status} ${JSON.stringify(r1.data).slice(0, 140)}`);
    const r2 = await api(M, `/orders/${cutOrder}/correct-profile-offcut`, { method: 'PUT', body: JSON.stringify(req) });
    check('the same request again (stale event) is refused', r2.status === 409, `${r2.status} ${JSON.stringify(r2.data).slice(0, 120)}`);
  }

  console.log('7. Cutting queue follows order changes');
  {
    const qOrder = await sellCut(5);
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1000);
    await p.getByRole('button', { name: /Cutting Queue/ }).click(); await p.waitForTimeout(1200);
    check('new cut order in the queue', (await body(p)).includes(`${qOrder}`));
    const ceoT = CEO;
    await api(ceoT, '/settings/cancel-pin', { method: 'PUT', body: JSON.stringify({ pin: '4321', currentPassword: PW }) });
    const cr = await api(M, `/orders/${qOrder}/cancel`, { method: 'PUT', body: JSON.stringify({ pin: '4321' }) });
    check('order cancelled elsewhere', cr.status === 200, `${cr.status} ${JSON.stringify(cr.data).slice(0, 100)}`);
    await p.waitForTimeout(2500);
    const q = (await api(M, '/orders/cutting-queue')).data.map(x => x.orderId);
    check('queue screen dropped it without a reload', !q.includes(qOrder) && !(await p.locator('text=#' + qOrder).count()));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('8. Order Summary refreshes on another device\'s change; Edit loads fresh');
  {
    const r = await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) });
    const id = r.data.orderId;
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1000);
    await p.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await p.waitForTimeout(500);
    await p.getByText('QA Customer').first().click(); await p.waitForTimeout(1200);
    const full = (await api(M, `/orders/${id}`)).data;
    await api(M, `/orders/${id}/edit`, { method: 'PUT', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, VAT_status: false, orderVersion: full.version, items: [{ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 3, unitPrice: 100, unitType: 'pcs', details: { _sourceItemId: full.items[0].itemId }, totalPrice: 300 }] }) });
    await p.waitForTimeout(2000);
    check('summary shows the new total 300 without a reload', /KSH ?300\b/.test((await body(p)).replace(/,/g, '')));
    await p.getByRole('button', { name: /Edit Order/ }).click(); await p.waitForTimeout(1500);
    const cart = await p.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]'));
    check('Edit opens the current order (qty 3)', cart.length === 1 && Number(cart[0].qty) === 3, JSON.stringify(cart.map(c => c.qty)));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();

    console.log('9. Order History: Edit refuses to open a half-loaded order');
    const p2 = await newPage(browser, 'qa_manager');
    await p2.goto(BASE + '/orders'); await p2.waitForTimeout(1000);
    await p2.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await p2.waitForTimeout(500);
    await p2.route(new RegExp(`:8010/orders/${id}$`), rt => rt.fulfill({ status: 500, body: '{"detail":"boom"}', contentType: 'application/json' }));
    await p2.getByRole('button', { name: /Edit/ }).first().click(); await p2.waitForTimeout(1200);
    check('stays on Order History', p2.url().endsWith('/orders'), p2.url());
    check('explains it could not load', /Could not load this order to edit it/.test(await body(p2)));
    await p2.context().close();
  }

  console.log('10. Offcut Management: draft survives refreshes; delete fires once');
  {
    const p = await newPage(browser, 'qa_ceo');
    await p.goto(BASE + '/offcuts'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /QA Profile/ }).click().catch(() => {}); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'GENERAL' }).click().catch(() => {}); await p.waitForTimeout(800);
    const editBtn = p.getByRole('button', { name: /^Edit$/ }).first();
    if (await editBtn.count()) {
      await editBtn.click(); await p.waitForTimeout(300);
      const input = p.locator('input[type=number]').first();
      await input.fill('12.5');
      // a sale elsewhere -> products_updated -> this page reloads its rows
      await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] }) });
      await p.waitForTimeout(2000);
      check('typed value kept after a background refresh', (await input.inputValue()) === '12.5', await input.inputValue());
      await p.getByRole('button', { name: /Cancel/ }).first().click().catch(() => {});
      let posts = 0; p.on('request', rq => { if (rq.url().includes('/offcuts/bulk-delete')) posts++; });
      await p.getByRole('button', { name: /^Select all \d+/ }).click(); await p.waitForTimeout(300);
      await p.getByRole('button', { name: 'Delete selected' }).click(); await p.waitForTimeout(400);
      await p.getByRole('button', { name: /Delete permanently/ }).dblclick().catch(() => {});
      await p.waitForTimeout(1500);
      check('bulk delete sent once', posts === 1, `requests=${posts}`);
      const left = (await api(CEO, '/products/offcuts/all')).data.filter(o => o.quantity > 0).length;
      check('offcuts removed', left === 0, `left=${left}`);
      const boxes = null;
      void boxes;
    } else check('an offcut row to edit exists', false, 'no Edit button');
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const f = results.filter(x => !x).length;
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
