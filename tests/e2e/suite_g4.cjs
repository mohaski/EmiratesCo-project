// Group-4 checks: checkout duplicates/double submit, cart sync, Dynamic qty, profile & glass
// validation, the "no changes" guard. Test backend :8010 via Vite :5180.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${PW}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
let M, ME, PRODS, CUST;
const prod = name => PRODS.find(p => p.name === name);
const orders = async () => (await api(M, '/orders/')).data;
const stockOf = async (name, i = 0) => (await api(M, '/products/')).data.find(p => p.name === name).variants[i].stock_quantity;
const body = p => p.locator('body').innerText();

async function newPage(browser, user = 'qa_cashier') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(user); await p.locator('input').nth(1).fill(PW);
  await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login')); await p.waitForTimeout(700);
  return p;
}
async function startSale(p) {
  await p.goto(BASE + '/sales'); await p.waitForTimeout(700);
  await p.getByPlaceholder('Search by name or phone...').fill('QA Cust'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(300);
}
async function openProduct(p, cat) { await p.getByRole('button', { name: new RegExp(cat) }).click(); await p.waitForTimeout(400); await p.locator('.product-card').first().click(); await p.waitForTimeout(900); }
const addBtn = p => p.getByRole('button', { name: '+ Add to Order' });
const modalNums = p => p.locator('input[type=number]');
async function addWidget(p, n = 1) { await openProduct(p, 'QA Accessories'); for (let i = 1; i < n; i++) await p.getByRole('button', { name: '+', exact: true }).last().click(); await addBtn(p).click(); await p.waitForTimeout(300); }
const confirm = p => p.getByRole('button', { name: /^(Confirm|Update Order)/ });

(async () => {
  M = await tok('qa_manager'); ME = (await api(M, '/users/me')).data; PRODS = (await api(M, '/products/')).data;
  CUST = (await api(M, '/users/customers')).data.find(c => c.name === 'QA Customer');
  const browser = await chromium.launch();

  console.log('1. Dynamic item quantity is charged and deducted in full');
  {
    const p = await newPage(browser); await startSale(p);
    const before = await stockOf('QA Widget');
    await addWidget(p, 3);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.getByRole('button', { name: /cash/i }).click(); await confirm(p).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = (await orders())[0];
    check('server total 300 for 3 × 100', o.total === 300, o.total);
    check('3 units left stock', before - (await stockOf('QA Widget')) === 3, `${before} -> ${await stockOf('QA Widget')}`);
    check('paid in full', o.paymentStatus === 'Paid', o.paymentStatus);

    console.log('2. Back from the receipt can not create a duplicate sale');
    const n = (await orders()).length;
    await p.goBack(); await p.waitForTimeout(1500);
    const t = await body(p);
    const filled = /Confirm Payment/.test(t) && !/Cart is Empty/.test(t);
    check('Back does not land on a filled checkout', !filled, p.url());
    const btn = confirm(p);
    if (await btn.count()) { await btn.click().catch(() => {}); await p.waitForTimeout(1500); }
    check('no second order created', (await orders()).length === n, `${n} -> ${(await orders()).length}`);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('3. Removing an item at checkout removes it from the cart');
  {
    const p = await newPage(browser); await startSale(p);
    await addWidget(p, 1); await addWidget(p, 2);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.getByRole('button', { name: '×' }).first().click(); await p.waitForTimeout(300);
    await p.getByText('BACK TO SALES').click(); await p.waitForTimeout(800);
    const cart = await p.evaluate(() => JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]'));
    check('cart now holds 1 line', cart.length === 1, cart.length);
    await p.evaluate(() => localStorage.removeItem('emirates_pos_cart'));
    await p.context().close();
  }

  console.log('4. Double click on Confirm creates one sale');
  {
    const p = await newPage(browser); await startSale(p); await addWidget(p, 1);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.route(/:8010\/orders\/$/, async r => { if (r.request().method() === 'POST') await new Promise(res => setTimeout(res, 1500)); return r.continue(); });
    const n = (await orders()).length;
    await p.getByRole('button', { name: /cash/i }).click();
    await confirm(p).dblclick().catch(() => {}); await confirm(p).click({ timeout: 500 }).catch(() => {});
    await p.waitForTimeout(4000);
    check('exactly one new order', (await orders()).length === n + 1, `${n} -> ${(await orders()).length}`);
    await p.context().close();
  }

  console.log('5. Edit: double click saves once; unchanged edit is blocked');
  {
    const id = (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ customerId: CUST.customerId, servedBy: ME.userId, amountPaid: 0, items: [{ productId: prod('QA Widget').productId, variantId: prod('QA Widget').variants[0].variantId, quantity: 2, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 200 }] }) })).data.orderId;
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1000);
    await p.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await p.waitForTimeout(500);
    await p.getByRole('button', { name: /Edit/ }).first().click(); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Confirm & Pay/ }).click(); await p.waitForURL('**/checkout'); await p.waitForTimeout(1200);
    let t = await body(p);
    check('unchanged edit: "No changes detected"', /No changes detected/.test(t));
    check('unchanged edit: confirm disabled', await confirm(p).isDisabled());
    await p.locator('input[type=number][placeholder="0"]').first().fill('10'); await p.waitForTimeout(300);
    check('a discount alone counts as a change', !/No changes detected/.test(await body(p)));
    await p.locator('input[type=number][placeholder="0"]').first().fill(''); await p.waitForTimeout(300);
    await p.getByText('BACK TO SALES').click(); await p.waitForTimeout(800);
    await addWidget(p, 1);
    await p.getByRole('button', { name: /Confirm & Pay/ }).click(); await p.waitForURL('**/checkout');
    await p.route(/\/reversal-plan/, async r => { await new Promise(res => setTimeout(res, 1200)); return r.continue(); });
    await p.getByRole('button', { name: /cash/i }).click();
    const before = (await api(M, `/orders/${id}`)).data;
    await confirm(p).dblclick().catch(() => {});
    await p.waitForTimeout(5000);
    const after = (await api(M, `/orders/${id}`)).data;
    const pays = (await api(M, `/financials/payments/order/${id}`)).data;
    check('saved once: total 300, one payment of 300 (order was unpaid)', after.total === 300 && pays.length === 1 && pays[0].amount === 300, `${before.total}->${after.total} pays=${JSON.stringify(pays.map(x => x.amount))}`);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('6. Profile calculator');
  {
    const p = await newPage(browser); await startSale(p);
    await openProduct(p, 'QA Profile');
    const [full, feet] = [modalNums(p).nth(0), modalNums(p).nth(1)];
    await full.fill('-1'); await p.waitForTimeout(200);
    check('negative full length becomes empty/0', ['', '0'].includes(await full.inputValue()), await full.inputValue());
    await full.fill('2.5'); await p.waitForTimeout(200);
    check('decimal full length rounded down to whole bars', await full.inputValue() === '2', await full.inputValue());
    await full.fill('');
    await feet.fill('-3'); await p.waitForTimeout(200);
    check('negative feet becomes empty/0', ['', '0'].includes(await feet.inputValue()), await feet.inputValue());
    await feet.fill('20'); await p.waitForTimeout(500);
    let t = await body(p);
    check('20ft on a 19.5ft bar refused', /Feet cannot exceed 19\.5\b/.test(t), (t.match(/Feet cannot[^\n]*/) || [''])[0]);
    check('Add disabled while invalid', await addBtn(p).isDisabled());
    await feet.fill('19.5'); await p.waitForTimeout(1500);
    t = await body(p);
    check('19.5ft (exactly the bar) allowed', !/Feet cannot exceed/.test(t));
    await feet.fill('7.5'); await full.fill('1'); await p.waitForTimeout(1500);
    await addBtn(p).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.waitForTimeout(800);
    const label = (await confirm(p).innerText()).replace(/,/g, '');
    const shown = +((label.match(/KSH\s*(\d+)/) || [])[1]);
    await p.getByRole('button', { name: /cash/i }).click(); await confirm(p).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = (await orders())[0];
    check('price shown equals price charged (1950 + 7.5×100 = 2700)', shown === 2700 && o.total === 2700, `shown ${shown} (${label}), server ${o.total}`);
    check('order fully paid', o.paymentStatus === 'Paid', o.paymentStatus);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('7. Glass calculator');
  {
    const p = await newPage(browser); await startSale(p);
    await openProduct(p, 'QA Glass');
    await p.getByRole('button', { name: '4mm' }).click(); await p.waitForTimeout(500);
    const L = p.getByPlaceholder(/^L \(/), W = p.getByPlaceholder(/^W \(/), Q = p.getByPlaceholder('Qty');
    await L.fill('0'); await W.fill('500'); await Q.fill('1'); await p.waitForTimeout(300);
    check('zero length refused', /must be greater than 0/.test(await body(p)));
    await L.fill('-100'); await p.waitForTimeout(300);
    check('negative length refused', /must be greater than 0/.test(await body(p)));
    await L.fill('1500'); await Q.fill('1.5'); await p.waitForTimeout(300);
    check('fractional quantity refused', /whole number of pieces/.test(await body(p)));
    await Q.fill('-2'); await p.waitForTimeout(300);
    check('negative quantity refused', /whole number of pieces/.test(await body(p)));
    await Q.fill('2'); await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(1500);
    check('valid piece added, nothing flagged', !/doesn't fit/.test(await body(p)));
    await p.getByRole('button', { name: '6mm' }).click(); await p.waitForTimeout(1200);
    const t = await body(p);
    check('switching to the smaller 6mm sheet flags the 1500mm piece', /doesn't fit the 1200×1000mm sheet/.test(t), (t.match(/⚠[^\n]*/) || [''])[0]);
    check('cannot add to order while a piece is invalid', await addBtn(p).isDisabled());
    await p.getByRole('button', { name: '4mm' }).click(); await p.waitForTimeout(1500);
    check('back on 4mm the piece is fine again', !/doesn't fit/.test(await body(p)));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('8. Converting a quote from Order History leaves the sales cart alone');
  {
    const ceoTok = await tok('qa_cashier');
    const inv = await api(ceoTok, '/invoices/', { method: 'POST', body: JSON.stringify({ customer: { id: CUST.customerId, name: 'QA Customer', phone: '0722222222', type: 'registered' }, items: [{ id: prod('QA Widget').productId, productId: prod('QA Widget').productId, name: 'QA Widget', category: 'hardware', totalPrice: 100, qty: 1, price: 100, details: { variantId: prod('QA Widget').variants[0].variantId } }, { id: prod('QA Widget').productId, productId: prod('QA Widget').productId, name: 'QA Widget', category: 'hardware', totalPrice: 200, qty: 2, price: 100, details: { variantId: prod('QA Widget').variants[0].variantId } }], subtotal: 300, vat_amount: 0, total: 300, discount: 0, vat_enabled: false }) });
    check('quote created', inv.status === 200, `${inv.status} ${JSON.stringify(inv.data).slice(0, 100)}`);
    const p = await newPage(browser); await startSale(p); await addWidget(p, 1);
    const cartBefore = await p.evaluate(() => localStorage.getItem('emirates_pos_cart'));
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1000);
    await p.getByRole('button', { name: /Quotations/ }).click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /Convert/ }).first().click(); await p.waitForTimeout(1200);
    if (p.url().endsWith('/checkout')) {
      await p.getByRole('button', { name: '×' }).first().click(); await p.waitForTimeout(300);
      check('removing a quote line at checkout works', (await body(p)).includes('1 item'));
      check('the separate sales cart is untouched', (await p.evaluate(() => localStorage.getItem('emirates_pos_cart'))) === cartBefore);
    } else check('convert opened checkout', false, p.url());
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const f = results.filter(x => !x).length;
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
