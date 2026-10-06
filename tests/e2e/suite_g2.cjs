// Browser regression suite for the group-2 money fixes (test backend :8010 via Vite :5180).
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';

const results = [];
const check = (label, ok, extra = '') => { results.push({ label, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${extra !== '' ? ' — ' + extra : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${encodeURIComponent(PW)}` })).json()).access_token;
async function api(t, p, o = {}) { const r = await fetch(API + p, { ...o, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } }

let M, ME, PROD, VAR, CUST_IND, CUST_BIZ;
async function setup() {
  M = await tok('qa_manager'); ME = (await api(M, '/users/me')).data;
  const prods = (await api(M, '/products/')).data; PROD = prods.find(p => p.name === 'QA Widget'); VAR = PROD.variants[0].variantId;
  const custs = (await api(M, '/users/customers')).data;
  CUST_IND = custs.find(c => c.name === 'QA Customer'); CUST_BIZ = custs.find(c => c.name === 'QA Business');
  const ceo = await tok('qa_ceo');
  await api(ceo, '/settings/cancel-pin', { method: 'PUT', body: JSON.stringify({ pin: '4321', currentPassword: PW }) });
}
const custId = c => c.customerId ?? c.id;
async function makeOrder({ qty = 1, paid = 0, discount = 0, vat = false, customer = CUST_IND, method = 'cash', details = null } = {}) {
  const r = await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: customer ? custId(customer) : null, customerName: customer ? null : 'Walk-in', servedBy: ME.userId, amountPaid: paid, discount, VAT_status: vat, paymentMethod: method, paymentDetails: details, items: [{ productId: PROD.productId, variantId: VAR, quantity: qty, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: qty * 100 }] }) });
  if (r.status !== 200) throw new Error('makeOrder failed ' + JSON.stringify(r.data));
  return r.data.orderId;
}
const getOrder = async id => (await api(M, `/orders/${id}`)).data;
const payments = async id => (await api(M, `/financials/payments/order/${id}`)).data;

async function newPage(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(BASE + '/login');
  await page.locator('input').nth(0).fill(user); await page.locator('input').nth(1).fill(PW);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForTimeout(700);
  return page;
}
const body = page => page.locator('body').innerText();
async function startSale(page, customerName = 'QA Customer') {
  await page.goto(BASE + '/sales'); await page.waitForTimeout(800);
  await page.getByPlaceholder('Search by name or phone...').fill(customerName.slice(0, 6));
  await page.getByText(customerName).first().click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /QA Accessories/ }).click();
  await page.locator('.product-card').first().click();
  await page.getByRole('button', { name: '+ Add to Order' }).click();
  await page.getByRole('button', { name: /^Checkout KSH/ }).click();
  await page.waitForURL('**/checkout');
}
const confirmBtn = page => page.getByRole('button', { name: /^(Confirm|Update Order)/ });
async function openOrderCard(page, id) {
  await page.goto(BASE + '/orders'); await page.waitForTimeout(1200);
  await page.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await page.waitForTimeout(600);
}
const latestOrderId = async () => (await api(M, '/orders/')).data[0].orderId;

(async () => {
  await setup();
  const browser = await chromium.launch();

  console.log('1. Checkout: partial amount is bounded');
  {
    const page = await newPage(browser, 'qa_cashier');
    await startSale(page);
    await page.getByRole('button', { name: 'Pay Partial / Later' }).click();
    const amt = page.getByPlaceholder('Enter amount...');
    await amt.fill('50000'); await page.getByRole('button', { name: /cash/i }).click(); await page.waitForTimeout(300);
    let t = await body(page);
    check('over-due warning shown', /More than the amount due/.test(t));
    check('confirm disabled when over due', await confirmBtn(page).isDisabled());
    await amt.fill('40'); await page.waitForTimeout(300);
    check('confirm enabled at 40', !(await confirmBtn(page).isDisabled()));
    await confirmBtn(page).click(); await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = await getOrder(await latestOrderId());
    check('stored 40 paid, 60 due', o.amountPaid === 40 && o.balance === 60 && o.paymentStatus === 'Partial', `${o.amountPaid}/${o.balance}/${o.paymentStatus}`);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('2. Checkout: split cash must be whole and non-negative');
  {
    const page = await newPage(browser, 'qa_cashier');
    await startSale(page);
    await page.getByRole('button', { name: /split/i }).click();
    const cash = page.locator('input[type=number]').filter({ hasNot: page.locator('[readonly]') });
    const cashInput = page.locator('input[type=number]:not([readonly])').last();
    for (const bad of ['-100', '30.5']) {
      await cashInput.fill(bad); await page.waitForTimeout(250);
      check(`cash ${bad} blocked`, await confirmBtn(page).isDisabled());
      check(`cash ${bad} warned`, /whole, positive amount/.test(await body(page)));
    }
    void cash;
    await cashInput.fill('30'); await page.waitForTimeout(250);
    check('cash 30 allowed', !(await confirmBtn(page).isDisabled()));
    await confirmBtn(page).click(); await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const id = await latestOrderId(); const pays = await payments(id);
    const d = pays[0]?.paymentDetails;
    check('split stored 30 / 70', d && d.cash === 30 && d.mpesa === 70, JSON.stringify(d));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('3. Checkout: discount allowed together with a partial payment');
  {
    const page = await newPage(browser, 'qa_cashier');
    await startSale(page);
    await page.getByRole('button', { name: 'Pay Partial / Later' }).click();
    const disc = page.locator('input[type=number][placeholder="0"]').first();
    check('discount box visible in partial mode', await disc.isVisible());
    await disc.fill('10');
    await page.getByPlaceholder('Enter amount...').fill('40');
    await page.getByRole('button', { name: /cash/i }).click(); await page.waitForTimeout(300);
    await confirmBtn(page).click(); await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = await getOrder(await latestOrderId());
    check('total 90, paid 40, due 50, discount 10', o.total === 90 && o.amountPaid === 40 && o.balance === 50 && o.discount === 10, `${o.total}/${o.amountPaid}/${o.balance}/${o.discount}`);
    await disc.isVisible().catch(() => {});
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('4. Edit keeps the discount; only the change is charged');
  {
    const id = await makeOrder({ qty: 5, paid: 450, discount: 50 });
    const page = await newPage(browser, 'qa_manager');
    await openOrderCard(page, id);
    await page.getByRole('button', { name: /Edit/ }).first().click(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /QA Accessories/ }).click().catch(() => {});
    await page.locator('.product-card').first().click(); await page.getByRole('button', { name: '+ Add to Order' }).click();
    await page.getByRole('button', { name: /Confirm & Pay/ }).click(); await page.waitForURL('**/checkout');
    const disc = await page.locator('input[type=number][placeholder="0"]').first().inputValue();
    check('discount prefilled with 50', disc === '50', disc);
    check('balance due shows 100', /Balance Due\s*KSH\s*100\b/.test((await body(page)).replace(/,/g, '')));
    await page.getByRole('button', { name: /cash/i }).click();
    await confirmBtn(page).click(); await page.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = await getOrder(id); const pays = await payments(id);
    check('order 550 with discount 50, fully paid', o.total === 550 && o.discount === 50 && o.amountPaid === 550 && o.balance === 0, `${o.total}/${o.discount}/${o.amountPaid}/${o.balance}`);
    check('one extra payment of 100', pays.length === 2 && pays.some(p => p.amount === 100), JSON.stringify(pays.map(p => p.amount)));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('5. Edit on stale figures is refused with a readable message');
  {
    const id = await makeOrder({ qty: 1, paid: 40 });
    const page = await newPage(browser, 'qa_manager');
    await openOrderCard(page, id);
    await page.getByRole('button', { name: /Edit/ }).first().click(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /QA Accessories/ }).click().catch(() => {});
    await page.locator('.product-card').first().click(); await page.getByRole('button', { name: '+ Add to Order' }).click();
    await page.getByRole('button', { name: /Confirm & Pay/ }).click(); await page.waitForURL('**/checkout');
    // another till collects the debt while this screen is open
    const cashierTok = await tok('qa_cashier');
    const pr = await api(cashierTok, '/financials/payments', { method: 'POST', body: JSON.stringify({ orderId: id, amount: 60, paymentMethod: 'cash' }) });
    check('debt collected elsewhere', pr.status === 200, pr.status);
    const before = await getOrder(id);
    await page.getByRole('button', { name: /cash/i }).click();
    await confirmBtn(page).click(); await page.waitForTimeout(2000);
    const t = await body(page);
    check('stays on checkout', page.url().endsWith('/checkout'));
    check('refusal explains to reopen', /changed since it was opened/.test(t) && /Reopen/.test(t));
    check('no [object Object]', !t.includes('[object Object]'));
    const after = await getOrder(id);
    check('order unchanged', after.total === before.total && after.amountPaid === before.amountPaid && after.items.length === before.items.length, `${after.total}/${after.amountPaid}`);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('6. Cancel: refund amount is fresh and split refund stored negative');
  {
    const id = await makeOrder({ qty: 1, paid: 40 });
    const page = await newPage(browser, 'qa_manager');
    await openOrderCard(page, id);
    const cashierTok = await tok('qa_cashier');
    await api(cashierTok, '/financials/payments', { method: 'POST', body: JSON.stringify({ orderId: id, amount: 30, paymentMethod: 'cash' }) });
    // the list row on screen may still say 40 — the modal must show 70
    await page.getByRole('button', { name: /Cancel/ }).first().click(); await page.waitForTimeout(1200);
    // In the cancel modal itself, as an amount: 70 (40 + the 30 paid meanwhile), not the stale 40.
    const modal = await page.locator('form').last().innerText();
    check('modal shows the current paid amount (70)', /(^|[^0-9.,])70(\.00)?([^0-9]|$)/.test(modal) && !/(^|[^0-9.,])40(\.00)?([^0-9]|$)/.test(modal),
          (modal.match(/[^\n]*(refund|paid)[^\n]*/gi) || []).join(' | '));
    let t = await body(page);
    const form = page.locator('form').last();
    await form.getByRole('button', { name: /split/i }).click();
    await form.locator('input[type=number]').first().fill('-5'); await page.waitForTimeout(200);
    await page.locator('input[type=password]').fill('4321');
    check('negative refund cash blocks cancel', await form.getByRole('button', { name: 'Cancel Order' }).isDisabled());
    await form.locator('input[type=number]').first().fill('20'); await page.waitForTimeout(200);
    await form.getByRole('button', { name: 'Cancel Order' }).click(); await page.waitForTimeout(2000);
    const o = await getOrder(id); const pays = await payments(id);
    const refund = pays.find(p => p.amount < 0);
    check('order cancelled', o.status === 'cancelled', o.status);
    check('refund of 70', refund && refund.amount === -70, refund && refund.amount);
    check('split refund stored negative', refund && refund.paymentDetails && refund.paymentDetails.cash === -20 && refund.paymentDetails.mpesa === -50, refund && JSON.stringify(refund.paymentDetails));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('7. Cancel opened before a payment elsewhere is refused, then works on reopen');
  {
    const id = await makeOrder({ qty: 1, paid: 40 });
    const page = await newPage(browser, 'qa_manager');
    await openOrderCard(page, id);
    await page.getByRole('button', { name: /Cancel/ }).first().click(); await page.waitForTimeout(1200);
    const cashierTok = await tok('qa_cashier');
    await api(cashierTok, '/financials/payments', { method: 'POST', body: JSON.stringify({ orderId: id, amount: 25, paymentMethod: 'cash' }) });
    const form = page.locator('form').last();
    await form.getByRole('button', { name: /cash/i }).first().click();
    await page.locator('input[type=password]').fill('4321');
    await form.getByRole('button', { name: 'Cancel Order' }).click(); await page.waitForTimeout(1500);
    let t = await body(page);
    check('refused with the new paid amount', /now been paid KSH 65/.test(t), (t.match(/[^\n]*paid KSH[^\n]*/) || [''])[0]);
    check('order still active', (await getOrder(id)).status !== 'cancelled');
    await form.getByRole('button', { name: /Keep Order/ }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Cancel/ }).first().click(); await page.waitForTimeout(1200);
    const form2 = page.locator('form').last();
    await form2.getByRole('button', { name: /cash/i }).first().click();
    await page.locator('input[type=password]').fill('4321');
    await form2.getByRole('button', { name: 'Cancel Order' }).click(); await page.waitForTimeout(1500);
    const pays = await payments(id);
    check('reopened cancel refunds 65', (await getOrder(id)).status === 'cancelled' && pays.some(p => p.amount === -65), JSON.stringify(pays.map(p => p.amount)));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('8. Collect debt: split cash must be whole and non-negative');
  {
    const id = await makeOrder({ qty: 1, paid: 0 });
    const page = await newPage(browser, 'qa_cashier');
    await page.goto(BASE + '/collect-payments'); await page.waitForTimeout(1500);
    await page.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await page.waitForTimeout(500);
    await page.getByRole('button', { name: '💰 Collect Debt' }).first().click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Split/ }).click();
    const cashInput = page.locator('input[type=number]:not([readonly])').last();
    await cashInput.fill('-10'); await page.waitForTimeout(200);
    const rec = page.getByRole('button', { name: /^Record/ });
    check('negative cash blocks recording', await rec.isDisabled());
    check('warning shown', /whole, positive amount/.test(await body(page)));
    await cashInput.fill('40'); await page.waitForTimeout(200);
    await rec.click(); await page.waitForTimeout(1500);
    const pays = await payments(id);
    check('debt split stored 40/60', pays[0] && pays[0].paymentDetails && pays[0].paymentDetails.cash === 40 && pays[0].paymentDetails.mpesa === 60, pays[0] && JSON.stringify(pays[0].paymentDetails));
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('9. Order summary: Subtotal - Discount + VAT = Total');
  {
    const id = await makeOrder({ qty: 5, paid: 0, discount: 50, vat: true }); // net 450, VAT 72, total 522
    const page = await newPage(browser, 'qa_manager');
    await openOrderCard(page, id);
    await page.getByText('QA Customer').first().click(); await page.waitForTimeout(1500);
    const t = (await body(page)).replace(/,/g, '');
    const sub = +(t.match(/Subtotal\s*KSH (\d+)/) || [])[1], dis = +(t.match(/Discount\s*- KSH (\d+)/) || [])[1], vat = +(t.match(/VAT\s*KSH (\d+)/) || [])[1];
    check('subtotal 500, discount 50, VAT 72', sub === 500 && dis === 50 && vat === 72, `${sub}/${dis}/${vat}`);
    check('rows add up to the order total 522', sub - dis + vat === 522);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('10. Debt detail: refunds counted once and shown as positive amounts');
  {
    const id = await makeOrder({ qty: 3, paid: 300 });
    const editBody = (qty, paid, method = 'cash', details = null) => JSON.stringify({ customerId: custId(CUST_IND), servedBy: ME.userId, amountPaid: paid, VAT_status: false, discount: 0, paymentMethod: method, paymentDetails: details, items: [{ productId: PROD.productId, variantId: VAR, quantity: qty, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: qty * 100 }] });
    const e1 = await api(M, `/orders/${id}/edit`, { method: 'PUT', body: editBody(1, -200, 'split', { cash: 80, mpesa: 120 }) });
    const e2 = await api(M, `/orders/${id}/edit`, { method: 'PUT', body: editBody(2, 0) });
    check('setup edits accepted', e1.status === 200 && e2.status === 200, `${e1.status} ${JSON.stringify(e1.data).slice(0, 80)} / ${e2.status}`);
    const o = await getOrder(id);
    check('order owes 100 after paying 300 and getting 200 back', o.amountPaid === 100 && o.balance === 100, `${o.amountPaid}/${o.balance}`);
    const page = await newPage(browser, 'qa_manager');
    await page.goto(BASE + '/debt-management'); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Dues Follow-Up/ }).click(); await page.waitForTimeout(1200);
    // Listed by its order number (what people see), not the internal id.
    const label = o.orderNo ?? id;
    await page.getByText('#' + label, { exact: true }).first().click().catch(async () => { await page.locator('tr', { hasText: '#' + label }).first().click(); });
    await page.waitForTimeout(1500);
    const t = (await body(page)).replace(/,/g, '');
    check('on the debt detail page', page.url().includes('/debt-management/order'), page.url());
    const paidLine = (t.match(/Total Paid[^\n]*\n?[^\n]*/) || [''])[0].replace(/\n/g, ' ');
    check('Total Paid is 100 (300 paid - 200 refunded)', /Total Paid\s*KSH 100\b/.test(t), paidLine);
    check('refund shown as "- KSH 200"', /- KSH 200\b/.test(t) && !/KSH -200/.test(t));
    check('split refund breakdown shown', /Cash KSH 80 \+ M-Pesa KSH 120/.test(t), (t.match(/Split[^\n]*/) || [''])[0]);
    check('no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  console.log('11. Link ("Add To") VAT default follows the customer type');
  {
    for (const [cust, want] of [[CUST_IND, false], [CUST_BIZ, true]]) {
      const id = await makeOrder({ qty: 1, paid: 100, customer: cust });
      const page = await newPage(browser, 'qa_manager');
      await openOrderCard(page, id);
      await page.getByRole('button', { name: /Add To/ }).first().click(); await page.waitForTimeout(1500);
      await page.getByRole('button', { name: /QA Accessories/ }).click().catch(() => {});
      await page.locator('.product-card').first().click(); await page.getByRole('button', { name: '+ Add to Order' }).click();
      await page.waitForTimeout(400);
      const label = (await page.getByRole('button', { name: /Checkout KSH|Confirm/ }).first().innerText()).replace(/\s+/g, ' ');
      check(`${cust.name}: VAT ${want ? 'on' : 'off'} by default`, want ? /116/.test(label) : /KSH ?100\b/.test(label), label);
      check('no page errors', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:', failed.map(f => f.label)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
