// Browser checks for the group-3 security changes (test backend :8010 via Vite :5180).
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE = 'http://localhost:5180', API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
const tok = async (u, p = PW) => (await (await fetch(`${API}/users/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${encodeURIComponent(p)}` })).json()).access_token;
const api = async (t, p, o = {}) => { const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }); const b = await r.text(); try { return { status: r.status, data: JSON.parse(b) }; } catch { return { status: r.status, data: b }; } };
const uniq = () => Math.random().toString(36).slice(2, 8);
const body = p => p.locator('body').innerText();

async function page(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  return p;
}
async function fillLogin(p, u, pw) {
  await p.goto(BASE + '/login'); await p.locator('input').nth(0).fill(u); await p.locator('input').nth(1).fill(pw);
  await p.locator('button[type=submit]').click(); await p.waitForTimeout(1200);
}

(async () => {
  const ceo = await tok('qa_ceo');
  const browser = await chromium.launch();

  console.log('1. Sign-in messages');
  {
    const p = await page(browser);
    await fillLogin(p, 'qa_manager', 'wrong-pass');
    let t = await body(p);
    check('wrong password: inline "Incorrect username or password."', t.includes('Incorrect username or password.'));
    check('no "session expired" toast', !/session has expired/i.test(t));
    check('no "Connection error"', !/Connection error/i.test(t));
    const u = 'qa_lock_' + uniq();
    await api(ceo, '/users/register', { method: 'POST', body: JSON.stringify({ firstName: 'L', secondName: 'K', username: u, role: 'cashier', email: `${u}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'), password: 'Temp1234' }) });
    for (let i = 0; i < 6; i++) await fillLogin(p, u, 'bad' + i);
    t = await body(p);
    check('after repeated failures the wait is shown', /Too many incorrect sign-in attempts/.test(t), (t.match(/Too many[^\n]*/) || [''])[0]);
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('2. New account: forced password change with the temporary password');
  {
    const u = 'qa_new_' + uniq();
    await api(ceo, '/users/register', { method: 'POST', body: JSON.stringify({ firstName: 'New', secondName: 'Cashier', username: u, role: 'cashier', email: `${u}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'), password: 'Temp1234' }) });
    const p = await page(browser);
    await fillLogin(p, u, 'Temp1234'); await p.waitForTimeout(1500);
    check('sent to /change-password', p.url().endsWith('/change-password'), p.url());
    let t = await body(p);
    check('asks for the Temporary Password', /Temporary Password/i.test(t));
    check('no refusal toasts behind the screen', !/permission|session has expired|PASSWORD_CHANGE_REQUIRED/i.test(t));
    const pw = p.locator('input[type=password]');
    await pw.nth(0).fill('wrongtemp'); await pw.nth(1).fill('NewPass1'); await pw.nth(2).fill('NewPass1');
    await p.locator('button[type=submit]').click(); await p.waitForTimeout(1200);
    check('wrong temporary password rejected inline', /temporary password is incorrect/i.test(await body(p)));
    await pw.nth(0).fill('Temp1234');
    await p.locator('button[type=submit]').click(); await p.waitForTimeout(3000);
    check('lands on the app afterwards', !p.url().endsWith('/change-password'), p.url());
    await p.goto(BASE + '/sales'); await p.waitForTimeout(1500);
    t = await body(p);
    check('data loads after the change (sales screen works)', /Select Customer|QA Accessories/.test(t));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('3. Register User: Admin/CEO roles only offered to the CEO');
  for (const [who, expectPriv] of [['qa_admin', false], ['qa_ceo', true]]) {
    const p = await page(browser);
    await fillLogin(p, who, PW);
    await p.goto(BASE + '/users'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Register User/ }).click(); await p.waitForTimeout(500);
    const opts = await p.locator('select[name=role] option').allInnerTexts();
    check(`${who}: role options ${opts.join('/')}`, expectPriv ? (opts.includes('Admin') && opts.includes('CEO')) : (!opts.includes('Admin') && !opts.includes('CEO') && opts.includes('Cashier')));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('4. Changing the cancel PIN asks for the account password');
  {
    const p = await page(browser);
    await fillLogin(p, 'qa_ceo', PW);
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Set Cancel PIN/ }).click(); await p.waitForTimeout(800);
    const pwField = p.getByPlaceholder('Required to change the PIN');
    check('password field shown when a PIN exists', await pwField.isVisible());
    const pins = p.locator('input[inputmode=numeric]');
    await pins.nth(0).fill('4321'); await pins.nth(1).fill('4321');
    await pwField.fill('wrong'); await p.getByRole('button', { name: 'Save PIN' }).click(); await p.waitForTimeout(1000);
    check('wrong password refused with a message', /account password to change the PIN/.test(await body(p)));
    await pwField.fill(PW); await p.getByRole('button', { name: 'Save PIN' }).click(); await p.waitForTimeout(1000);
    check('right password accepted', /Cancel PIN updated/.test(await body(p)));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('5. Product Management still works for the CEO and admin');
  for (const who of ['qa_ceo', 'qa_admin']) {
    const p = await page(browser);
    await fillLogin(p, who, PW);
    await p.goto(BASE + '/product-management'); await p.waitForTimeout(2000);
    const t = await body(p);
    check(`${who}: products listed`, /QA Widget/.test(t) || /QA Accessories/.test(t));
    check(`${who}: no permission toasts`, !/do not have permission/i.test(t));
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  console.log('6. Deactivating a signed-in cashier takes effect at once');
  {
    const u = 'qa_deact_' + uniq();
    await api(ceo, '/users/register', { method: 'POST', body: JSON.stringify({ firstName: 'D', secondName: 'A', username: u, role: 'cashier', email: `${u}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'), password: 'Temp1234' }) });
    const t0 = await tok(u, 'Temp1234'); const id = (await api(t0, '/users/me')).data.userId;
    await api(t0, `/users/${id}/change-password`, { method: 'POST', body: JSON.stringify({ currentPassword: 'Temp1234', newPassword: PW, confirmNewPassword: PW }) });
    const p = await page(browser);
    await fillLogin(p, u, PW);
    await p.goto(BASE + '/orders'); await p.waitForTimeout(1200);
    await api(ceo, `/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    await p.reload(); await p.waitForTimeout(2000);
    check('deactivated cashier is signed out', p.url().includes('/login'), p.url());
    check('no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.context().close();
  }

  await browser.close();
  const f = results.filter(x => !x).length;
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
