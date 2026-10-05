// Group-3 security checks over HTTP against the test backend (:8010, emiratesco_edit_test).
const { execSync } = require('child_process');
const API = 'http://localhost:8010', PW = 'Test1234!';
const results = [];
const check = (l, ok, x = '') => { results.push({ l, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${l}${x !== '' ? ' — ' + x : ''}`); };
async function raw(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + path, { method, headers, body: payload });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const login = async (u, p = PW) => raw('/users/token', { method: 'POST', form: { username: u, password: p } });
const tok = async (u, p = PW) => (await login(u, p)).data.access_token;
const me = async t => (await raw('/users/me', { token: t })).data;
const uniq = () => Math.random().toString(36).slice(2, 8);
async function newUser(ceoTok, role, extra = {}) {
  const u = 'qa_' + role + '_' + uniq();
  const r = await raw('/users/register', { method: 'POST', token: ceoTok, body: { firstName: 'QA', secondName: role, username: u, role, email: `${u}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0'), password: 'Temp1234', ...extra } });
  if (r.status !== 200) throw new Error('register failed ' + JSON.stringify(r.data));
  return u;
}
async function idOf(t, username) { const all = (await raw('/users/', { token: t })).data; return all.find(x => x.username === username).userId; }
async function activate(ceoTok, username) {
  // registration makes a temp password; give the user a usable session by doing the forced change
  const t = await tok(username, 'Temp1234');
  const id = (await me(t)).userId;
  const r = await raw(`/users/${id}/change-password`, { method: 'POST', token: t, body: { currentPassword: 'Temp1234', newPassword: PW, confirmNewPassword: PW } });
  if (r.status !== 200) throw new Error('activate failed ' + JSON.stringify(r.data));
  return { id, token: await tok(username) };
}

(async () => {
  const ceo = await tok('qa_ceo'), admin = await tok('qa_admin'), mgr = await tok('qa_manager'), cash = await tok('qa_cashier');
  const prods = (await raw('/products/', { token: cash })).data;
  const P = prods.find(p => p.name === 'QA Widget'); const V = P.variants[0].variantId;

  console.log('1. Catalogue endpoints follow the role list');
  for (const [name, t] of [['cashier', cash], ['manager', mgr]]) {
    check(`${name} can list products`, (await raw('/products/', { token: t })).status === 200);
    check(`${name} can list categories`, (await raw('/products/categories', { token: t })).status === 200);
    check(`${name} can list attributes`, (await raw('/attributes/', { token: t })).status === 200);
    check(`${name} can read offcuts for a product (sales calculators)`, (await raw(`/products/${P.productId}/offcuts`, { token: t })).status === 200);
    const feas = await raw(`/products/${P.productId}/cut-feasibility`, { method: 'POST', token: t, body: { variantId: V, lineItems: [] } });
    check(`${name} cut-feasibility not refused by role`, feas.status !== 403 && feas.status !== 401, feas.status);
    const r1 = await raw(`/products/variants/${V}`, { method: 'PUT', token: t, body: { price: 1 } });
    check(`${name} cannot change a price (403, not 500)`, r1.status === 403, r1.status);
    check(`${name} cannot create a product`, (await raw('/products/', { method: 'POST', token: t, body: { name: 'X', category: 'x', variants: [] } })).status === 403);
    check(`${name} cannot delete a product`, (await raw(`/products/${P.productId}`, { method: 'DELETE', token: t })).status === 403);
    check(`${name} cannot create an attribute`, (await raw('/attributes/', { method: 'POST', token: t, body: { name: 'Hack', type: 'custom' } })).status === 403);
    check(`${name} cannot set stock directly`, (await raw(`/products/${P.productId}/stock`, { method: 'PUT', token: t, body: { stock: 999 } })).status === 403);
  }
  check('restock history: manager allowed', (await raw('/products/restock-history', { token: mgr })).status === 200);
  check('restock history: cashier refused', (await raw('/products/restock-history', { token: cash })).status === 403);
  for (const [name, t] of [['ceo', ceo], ['admin', admin]]) {
    const r = await raw(`/products/variants/${V}`, { method: 'PUT', token: t, body: { price: 100 } });
    check(`${name} can change a price`, r.status === 200, r.status);
    const a = await raw('/attributes/', { method: 'POST', token: t, body: { name: 'QA Attr ' + uniq(), type: 'custom' } });
    check(`${name} can create an attribute`, a.status === 200, `${a.status} ${JSON.stringify(a.data).slice(0, 80)}`);
    if (a.status === 200) check(`${name} can delete it`, (await raw(`/attributes/${a.data.attributeClassId}`, { method: 'DELETE', token: t })).status === 200);
  }
  for (const p of ['/products/', '/attributes/', '/users/customers', '/orders/customer/1', '/products/categories'])
    check(`${p} needs sign-in`, (await raw(p)).status === 401);

  console.log('2. Account management');
  const reg = (t, role) => raw('/users/register', { method: 'POST', token: t, body: { firstName: 'A', secondName: 'B', username: 'qa_x_' + uniq(), role, email: `x${uniq()}@qa-emiratesco.com`, phoneNumber: '07' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0') } });
  check('admin cannot create a CEO', (await reg(admin, 'ceo')).status === 403);
  check('admin cannot create an admin', (await reg(admin, 'admin')).status === 403);
  check('admin can create a cashier', (await reg(admin, 'cashier')).status === 200);
  check('unknown role refused (422)', (await reg(ceo, 'superuser')).status === 422);
  check('ceo can create an admin', (await reg(ceo, 'admin')).status === 200);
  const ceoId = (await me(ceo)).userId, adminId = (await me(admin)).userId, cashId = (await me(cash)).userId;
  check('admin cannot reset the CEO password', (await raw(`/users/${ceoId}/admin-reset-password`, { method: 'POST', token: admin, body: { newPassword: 'hacked1' } })).status === 403);
  check('admin cannot deactivate the CEO', (await raw(`/users/${ceoId}/status`, { method: 'PUT', token: admin, body: { isActive: false } })).status === 403);
  check('admin cannot delete the CEO', (await raw(`/users/${ceoId}`, { method: 'DELETE', token: admin })).status === 403);
  check('ceo cannot deactivate self', (await raw(`/users/${ceoId}/status`, { method: 'PUT', token: ceo, body: { isActive: false } })).status === 400);
  check('ceo cannot delete self', (await raw(`/users/${ceoId}`, { method: 'DELETE', token: ceo })).status === 400);
  check('ceo cannot admin-reset own password', (await raw(`/users/${ceoId}/admin-reset-password`, { method: 'POST', token: ceo, body: { newPassword: 'abcdef' } })).status === 400);
  check('ceo can still sign in (not locked out)', !!(await tok('qa_ceo')));
  check('cashier reads own record', (await raw(`/users/${cashId}`, { token: cash })).status === 200);
  check('cashier cannot read another user', (await raw(`/users/${adminId}`, { token: cash })).status === 403);
  check('manager can read another user', (await raw(`/users/${cashId}`, { token: mgr })).status === 200);

  console.log('3. Changes take effect on the next request (no waiting for the token to expire)');
  {
    const u = await newUser(ceo, 'cashier'); const { id, token } = await activate(ceo, u);
    check('fresh cashier works', (await raw('/orders/', { token })).status === 200);
    await raw(`/users/${id}/status`, { method: 'PUT', token: ceo, body: { isActive: false } });
    check('deactivated → existing token refused (401)', (await raw('/orders/', { token })).status === 401);
    await raw(`/users/${id}/status`, { method: 'PUT', token: ceo, body: { isActive: true } });
    check('reactivated → works again', (await raw('/orders/', { token })).status === 200);
    check('as cashier: user list refused', (await raw('/users/', { token })).status === 403);
    await raw(`/users/${id}/role`, { method: 'PUT', token: ceo, body: { role: 'manager' } });
    check('promoted to manager → same token gets manager rights', (await raw('/users/', { token })).status === 200);
    await raw(`/users/${id}/role`, { method: 'PUT', token: ceo, body: { role: 'cashier' } });
    check('demoted → manager rights gone at once', (await raw('/users/', { token })).status === 403);
    check('/users/me reports the database role', (await me(token)).role === 'cashier');
  }

  console.log('4. Temporary password: only the change screen works until it is replaced');
  {
    const u = await newUser(ceo, 'cashier'); const { id, token } = await activate(ceo, u);
    await raw(`/users/${id}/admin-reset-password`, { method: 'POST', token: ceo, body: { newPassword: 'Reset123' } });
    const r = await raw('/orders/', { token });
    check('existing token blocked with PASSWORD_CHANGE_REQUIRED', r.status === 403 && r.data.detail === 'PASSWORD_CHANGE_REQUIRED', `${r.status} ${JSON.stringify(r.data)}`);
    check('/users/me still works', (await raw('/users/me', { token })).status === 200);
    check('own record still works', (await raw(`/users/${id}`, { token })).status === 200);
    check('reading someone else blocked', (await raw(`/users/${cashId}`, { token })).status === 403);
    check('change without temporary password refused (422)', (await raw(`/users/${id}/change-password`, { method: 'POST', token, body: { newPassword: 'NewPass1', confirmNewPassword: 'NewPass1' } })).status === 422);
    check('wrong temporary password refused (400)', (await raw(`/users/${id}/change-password`, { method: 'POST', token, body: { currentPassword: 'nope', newPassword: 'NewPass1', confirmNewPassword: 'NewPass1' } })).status === 400);
    check('too-short new password refused (422)', (await raw(`/users/${id}/change-password`, { method: 'POST', token, body: { currentPassword: 'Reset123', newPassword: 'abc', confirmNewPassword: 'abc' } })).status === 422);
    const ok = await raw(`/users/${id}/change-password`, { method: 'POST', token, body: { currentPassword: 'Reset123', newPassword: 'NewPass1', confirmNewPassword: 'NewPass1' } });
    check('correct temporary password accepted', ok.status === 200, ok.status);
    check('same token now works everywhere', (await raw('/orders/', { token })).status === 200);
    check('forced-change endpoint closed once done (400)', (await raw(`/users/${id}/change-password`, { method: 'POST', token, body: { currentPassword: 'NewPass1', newPassword: 'Other123', confirmNewPassword: 'Other123' } })).status === 400);
    check('normal change: mismatched confirmation refused', (await raw(`/users/${id}/password-reset`, { method: 'POST', token, body: { currentPassword: 'NewPass1', newPassword: 'Other123', confirmNewPassword: 'Other999' } })).status === 400);
    check('normal change with current password works', (await raw(`/users/${id}/password-reset`, { method: 'POST', token, body: { currentPassword: 'NewPass1', newPassword: 'Other123', confirmNewPassword: 'Other123' } })).status === 200);
  }

  console.log('5. Sign-in');
  {
    const a = await login('qa_nobody_' + uniq(), 'x'), b = await login('qa_manager', 'wrong-password');
    check('unknown user and wrong password give the same message', a.status === 401 && b.status === 401 && a.data.detail === b.data.detail, a.data.detail);
    const u = await newUser(ceo, 'cashier'); await activate(ceo, u);
    for (let i = 0; i < 5; i++) await login(u, 'bad');
    const sixth = await login(u, PW);
    check('6th attempt after 5 wrong ones is slowed down (429), even with the right password', sixth.status === 429, `${sixth.status} ${JSON.stringify(sixth.data)}`);
    check('other staff on the same machine unaffected', (await login('qa_manager')).status === 200);
    const v = await newUser(ceo, 'cashier'); const { id } = await activate(ceo, v);
    await raw(`/users/${id}/status`, { method: 'PUT', token: ceo, body: { isActive: false } });
    const d = await login(v, PW);
    check('deactivated account told so (with the right password)', d.status === 401 && /deactivated/.test(d.data.detail), d.data.detail);
    const dw = await login(v, 'wrong');
    check('deactivated account with a wrong password gets the generic message', dw.status === 401 && !/deactivated/.test(dw.data.detail));
  }

  console.log('6. Cancel PIN');
  {
    const st = await raw('/settings/cancel-pin/status', { token: ceo });
    if (!st.data.configured) check('first PIN set without a password', (await raw('/settings/cancel-pin', { method: 'PUT', token: ceo, body: { pin: '4321' } })).status === 200);
    check('changing the PIN without password refused', (await raw('/settings/cancel-pin', { method: 'PUT', token: ceo, body: { pin: '1111' } })).status === 403);
    check('changing the PIN with a wrong password refused', (await raw('/settings/cancel-pin', { method: 'PUT', token: ceo, body: { pin: '1111', currentPassword: 'nope' } })).status === 403);
    check('changing the PIN with the password works', (await raw('/settings/cancel-pin', { method: 'PUT', token: ceo, body: { pin: '4321', currentPassword: PW } })).status === 200);
    const me1 = await me(mgr);
    const mk = async () => (await raw('/orders/', { method: 'POST', token: mgr, body: { customerId: null, customerName: 'PIN test', servedBy: me1.userId, amountPaid: 0, items: [{ productId: P.productId, variantId: V, quantity: 1, unitPrice: 100, unitType: 'pcs', details: {}, totalPrice: 100 }] } })).data.orderId;
    const o = await mk();
    const m2 = await newUser(ceo, 'manager'); const { token: mgr2 } = await activate(ceo, m2);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await raw(`/orders/${o}/cancel`, { method: 'PUT', token: mgr2, body: { pin: '0000' } })).status);
    check('5 wrong PINs → 403, then 429', statuses.slice(0, 5).every(s => s === 403) && statuses[5] === 429, statuses.join(','));
    check('blocked manager cannot cancel even with the right PIN yet', (await raw(`/orders/${o}/cancel`, { method: 'PUT', token: mgr2, body: { pin: '4321' } })).status === 429);
    const other = await raw(`/orders/${o}/cancel`, { method: 'PUT', token: mgr, body: { pin: '4321' } });
    check('another manager is not blocked', other.status === 200, `${other.status} ${JSON.stringify(other.data).slice(0, 80)}`);
  }

  console.log('7. CEO recovery from the server');
  {
    const out = execSync('.venv/bin/python reset_user_password.py qa_ceo --db emiratesco_edit_test 2>/dev/null', { cwd: require('path').resolve(__dirname, '../../server') }).toString();
    const temp = (out.match(/: (\w{10})\s/) || [])[1];
    check('script prints a temporary password', !!temp, out.trim().split('\n')[0]);
    const t = await tok('qa_ceo', temp);
    check('CEO signs in with it', !!t);
    check('and must change it first', (await me(t)).mustChangePassword === true);
    const id = (await me(t)).userId;
    check('forced change back to the usual password', (await raw(`/users/${id}/change-password`, { method: 'POST', token: t, body: { currentPassword: temp, newPassword: PW, confirmNewPassword: PW } })).status === 200);
  }

  const f = results.filter(r => !r.ok);
  console.log(`\n${results.length - f.length}/${results.length} passed`);
  if (f.length) { console.log('FAILED:', f.map(x => x.l)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
