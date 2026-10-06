// Profile offcut picker: several same-size offcuts (one pooled row, quantity > 1) can be seen
// and used together. Test backend :8010 via Vite :5180, test DB, QA seed.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async u => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${PW}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
const body = p => p.locator('body').innerText();

let M, CEO, BAR;
const offcutsOf = async (len) => (await api(M, `/products/${BAR.productId}/offcuts`)).data.filter(o => Math.abs(o.length - len) < 0.01);
const unitsOf = async (len) => (await offcutsOf(len)).reduce((n, o) => n + o.quantity, 0);

async function newPage(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(user); await p.locator('input').nth(1).fill(PW);
  await p.locator('button[type=submit]').click(); await p.waitForFunction(() => !location.pathname.startsWith('/login')); await p.waitForTimeout(900);
  return p;
}
async function startCut(p, feet) {
  await p.getByRole('button', { name: /QA Profile/ }).click(); await p.waitForTimeout(300);
  await p.locator('.product-card', { hasText: 'QA Tracked Bar' }).first().click(); await p.waitForTimeout(600);
  await p.locator('text=Total feet needed').locator('xpath=ancestor::div[1]').locator('input').first().fill(String(feet));
  await p.waitForTimeout(700);
}
const openPicker = p => p.getByRole('button', { name: /Choose offcuts or a new bar/ }).click().then(() => p.waitForTimeout(1200));

(async () => {
  M = await tok('qa_manager'); CEO = await tok('qa_ceo');
  BAR = (await api(M, '/products/')).data.find(p => p.name === 'QA Tracked Bar');
  const vid = BAR.variants[0].variantId;
  const browser = await chromium.launch();

  console.log('1. Three same-size offcuts: shown as such, and all three usable (windows off)');
  {
    const r = await api(M, `/products/${BAR.productId}/offcuts/bulk`, { method: 'POST', body: JSON.stringify([{ variant_id: vid, length: 6, quantity: 3 }]) });
    check('3 x 6ft offcuts in one pooled row', r.status === 200 && await unitsOf(6) === 3 && (await offcutsOf(6)).length === 1, `${r.status} ${await unitsOf(6)}`);
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(800);
    await p.getByPlaceholder('Search by name or phone...').fill('QA Cus'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(600);
    await startCut(p, 15); await openPicker(p);
    let t = await body(p);
    check('the row says there are 3 pieces of this size', /6\.00 ft\s*3 pieces this size/.test(t), (t.match(/6\.00 ft[^\n]*\n?[^\n]*/) || [''])[0]);
    await p.getByText('3 pieces this size').click(); await p.waitForTimeout(300);
    check('ticking it offers a pieces stepper starting at 1 of 3', (await p.getByTestId('pieces-used').innerText()) === '1' && /of 3/.test(await body(p)));
    await p.getByRole('button', { name: 'One piece more' }).click(); await p.getByRole('button', { name: 'One piece more' }).click(); await p.waitForTimeout(300);
    check('now 3 pieces, each with its own length', (await p.getByTestId('pieces-used').innerText()) === '3'
      && (await p.getByLabel('Piece 1 length used').inputValue()) === '6' && (await p.getByLabel('Piece 2 length used').inputValue()) === '6'
      && (await p.getByLabel('Piece 3 length used').inputValue()) === '3');
    check('cannot take a 4th piece (+ disabled)', await p.getByRole('button', { name: 'One piece more' }).isDisabled());
    t = await body(p);
    check('fully covered by the three pieces', /Fully covered by offcuts/.test(t));
    await p.getByRole('button', { name: 'Use These Offcuts' }).click(); await p.waitForTimeout(600);
    check('calculator shows the three picks', /6\.0ft \+ 6\.0ft \+ 3\.0ft ✓/.test(await body(p)), (await body(p)).match(/\d\.\dft \+[^\n]*/)?.[0]);
    // Reopening restores all three (not collapsed to one).
    await p.getByRole('button', { name: 'Edit', exact: true }).first().click(); await p.waitForTimeout(1200);
    check('reopening the picker restores 3 pieces', (await p.getByTestId('pieces-used').innerText()) === '3');
    await p.getByRole('button', { name: 'Use These Offcuts' }).click(); await p.waitForTimeout(500);
    await p.getByRole('button', { name: /\+ Add to Order/ }).click(); await p.waitForTimeout(800);
    // A second line in the same cart can't pick the pieces the first line already claimed.
    await startCut(p, 4); await openPicker(p);
    check('a second cart line no longer offers the claimed 6ft pieces', !/6\.00 ft/.test(await body(p)));
    await p.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(300);
    await p.keyboard.press('Escape'); await p.locator('button:has-text("✕")').first().click().catch(() => {}); await p.waitForTimeout(300);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.getByRole('button', { name: /cash/i }).first().click(); await p.getByRole('button', { name: /^Confirm/ }).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = (await api(M, '/orders/')).data[0];
    const full = (await api(M, `/orders/${o.orderId}`)).data;
    const cut = full.items.map(i => i.details?.lineItems?.[0]).find(l => l?.type === 'profile-cut');
    const srcs = (cut?.offcut_sources || []).filter(s => s.source === 'offcut');
    check('the sale cut from three 6ft pieces', srcs.length === 3 && srcs.every(s => Math.abs(s.offcut_length - 6) < 0.01), JSON.stringify(srcs.map(s => s.offcut_length)));
    check('...three different pieces', new Set(srcs.map(s => s.source_piece_id)).size === 3);
    check('all three 6ft offcuts are used', await unitsOf(6) === 0, await unitsOf(6));
    check('the 3ft left over is back in the pool', await unitsOf(3) === 1, await unitsOf(3));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('2. Same with sale windows on: held at once, kept when the line is reopened');
  {
    await api(CEO, '/windows/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    await api(M, `/products/${BAR.productId}/offcuts/bulk`, { method: 'POST', body: JSON.stringify([{ variant_id: vid, length: 8, quantity: 2 }]) });
    check('2 x 8ft offcuts', await unitsOf(8) === 2, await unitsOf(8));
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(900);
    await p.getByPlaceholder('Search by name or phone...').fill('QA Cus'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(900);
    await startCut(p, 16); await openPicker(p);
    await p.getByText('2 pieces this size').click(); await p.getByRole('button', { name: 'One piece more' }).click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Use These Offcuts' }).click(); await p.waitForTimeout(500);
    await p.getByRole('button', { name: /\+ Add to Order/ }).click(); await p.waitForTimeout(2000);
    check('the window holds both 8ft pieces', await unitsOf(8) === 0, await unitsOf(8));
    await p.getByRole('button', { name: 'Edit', exact: true }).first().click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'Edit', exact: true }).last().click().catch(() => {}); await p.waitForTimeout(1200);
    const reopened = await p.getByTestId('pieces-used').innerText().catch(() => null);
    check('reopening the line in the window still shows 2 of its pieces', reopened === '2', reopened);
    await p.getByRole('button', { name: 'Use These Offcuts' }).click().catch(() => {}); await p.waitForTimeout(400);
    await p.getByRole('button', { name: /\+ Add to Order/ }).click().catch(() => {}); await p.waitForTimeout(2000);
    check('still held after saving the line again', await unitsOf(8) === 0, await unitsOf(8));
    const C = await tok('qa_cashier');
    for (const w of (await api(C, '/windows/')).data) await api(C, `/windows/${w.windowId}`, { method: 'DELETE' });
    check('closing the window gives both 8ft pieces back', await unitsOf(8) === 2, await unitsOf(8));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
    await api(CEO, '/windows/settings', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
  }

  console.log('3. Some offcuts picked + "rest from a new bar": offcuts stay usable, remainder from a fresh bar');
  {
    await api(M, `/products/${BAR.productId}/offcuts/bulk`, { method: 'POST', body: JSON.stringify([{ variant_id: vid, length: 5, quantity: 1 }, { variant_id: vid, length: 9, quantity: 1 }]) });
    const barsBefore = (await api(M, '/products/')).data.find(p => p.name === 'QA Tracked Bar').variants[0].stock_quantity;
    const p = await newPage(browser, 'qa_cashier');
    await p.goto(BASE + '/sales'); await p.waitForTimeout(800);
    await p.getByPlaceholder('Search by name or phone...').fill('QA Cus'); await p.getByText('QA Customer').first().click(); await p.waitForTimeout(600);
    await startCut(p, 9); await openPicker(p);
    await p.getByTestId('new-bar-option').click(); await p.waitForTimeout(300);
    check('offcuts are still clickable with the new-bar option ticked', /5\.00 ft/.test(await body(p)));
    await p.locator('text=5.00 ft').first().click(); await p.waitForTimeout(300);
    let t = await body(p);
    check('the total says the rest comes from a new bar', /5\.00 ft from 1 offcut piece[\s\S]*4\.00 ft auto-filled[\s\S]*\(from a new bar\)/.test(t), (t.match(/5\.00 ft from[^\n]*/) || [''])[0]);
    check('button reads "Use Offcuts + New Bar"', await p.getByRole('button', { name: 'Use Offcuts + New Bar' }).isEnabled());
    await p.getByRole('button', { name: 'Use Offcuts + New Bar' }).click(); await p.waitForTimeout(600);
    check('calculator shows "5.0ft + rest from a new bar"', /5\.0ft \+ rest from a new bar/.test(await body(p)), (await body(p)).match(/\d\.\dft \+[^\n]*/)?.[0]);
    await p.getByRole('button', { name: /\+ Add to Order/ }).click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^Checkout KSH/ }).click(); await p.waitForURL('**/checkout');
    await p.getByRole('button', { name: /cash/i }).first().click(); await p.getByRole('button', { name: /^Confirm/ }).click();
    await p.waitForURL('**/checkout/receipt', { timeout: 15000 }).catch(() => {});
    const o = (await api(M, '/orders/')).data[0];
    const cut = (await api(M, `/orders/${o.orderId}`)).data.items.map(i => i.details?.lineItems?.[0]).find(l => l?.type === 'profile-cut');
    const srcs = (cut?.offcut_sources || []).map(s => `${s.source}:${s.length_used}`);
    check('sold as 5ft from the offcut + 4ft from a new bar', JSON.stringify(srcs) === JSON.stringify(['offcut:5', 'full_bar:4']), JSON.stringify(srcs));
    check('the 9ft offcut that would have fitted is untouched', await unitsOf(9) === 1, await unitsOf(9));
    const barsAfter = (await api(M, '/products/')).data.find(p => p.name === 'QA Tracked Bar').variants[0].stock_quantity;
    check('one new bar taken', barsAfter === barsBefore - 1, `${barsBefore} -> ${barsAfter}`);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('4. Cancelling an order with cuts: every line must be answered before continuing');
  {
    const ME = (await api(M, '/users/me')).data;
    const ord = (await api(M, '/orders/', { method: 'POST', body: JSON.stringify({ servedBy: ME.userId, status: 'confirmed', amountPaid: 0,
      items: [{ productId: BAR.productId, variantId: vid, quantity: 1, unitPrice: 0, unitType: 'ft', details: { lineItems: [{ type: 'profile-cut', qty: 1, meta: { length: 3 }, rate: 100 }] } }] }) })).data;
    check('an order with a cut line', !!ord.orderNo, JSON.stringify(ord).slice(0, 120));
    const p = await newPage(browser, 'qa_manager');
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1200);
    await p.getByPlaceholder(/Search/).first().fill(String(ord.orderNo)); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /Cancel/ }).first().click(); await p.waitForTimeout(1500);
    const modal = p.getByTestId('resolve-cuts-modal');
    check('the cut confirmation opens', await modal.isVisible());
    check('Confirm is blocked until answered', await p.getByTestId('confirm-cuts').isDisabled());
    check('it says every line must be answered', await p.getByTestId('answers-required').isVisible());
    check('nothing is pre-selected ("1 to answer")', /1 to answer/i.test(await modal.innerText()), (await modal.innerText()).match(/\d+ to answer/i)?.[0]);
    await modal.getByRole('button', { name: /Needs check/ }).first().click().catch(() => {}); await p.waitForTimeout(300);
    check('"Needs check" is not an answer: still blocked', await p.getByTestId('confirm-cuts').isDisabled());
    await modal.getByRole('button', { name: /Not cut/ }).first().click(); await p.waitForTimeout(300);
    check('answering "Not cut" unblocks Confirm', await p.getByTestId('confirm-cuts').isEnabled());
    await p.getByTestId('confirm-cuts').click(); await p.waitForTimeout(1000);
    check('it moves on to the PIN / refund step', await p.getByRole('button', { name: 'Cancel Order' }).count() > 0);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('Error:', e); process.exit(1); });
