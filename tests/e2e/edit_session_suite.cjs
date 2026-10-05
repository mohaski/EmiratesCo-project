// Regression: editing order B after order A must charge and save against B, never A.
const { chromium } = require(require('path').join(__dirname, '../../client/node_modules/playwright'));
const BASE='http://localhost:5180', API='http://localhost:8010';
const results=[]; const check=(l,ok,x='')=>{results.push(ok);console.log(`  [${ok?'PASS':'FAIL'}] ${l}${x!==''?' — '+x:''}`);};
const tok = async u => (await (await fetch(API+'/users/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`username=${u}&password=Test1234!`})).json()).access_token;
const api = async (t,p,o={}) => { const r=await fetch(API+p,{...o,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'}}); const b=await r.text(); try{return {status:r.status,data:JSON.parse(b)};}catch{return {status:r.status,data:b};} };
let M, ME, P, IND, BIZ;
const mk = async (qty, paid, cust, vat=false) => (await api(M,'/orders/',{method:'POST',body:JSON.stringify({customerId:cust.customerId??cust.id,servedBy:ME.userId,amountPaid:paid,VAT_status:vat,paymentMethod:'cash',items:[{productId:P.productId,variantId:P.variants[0].variantId,quantity:qty,unitPrice:100,unitType:'pcs',details:{},totalPrice:qty*100}]})})).data.orderId;
const ord = async id => (await api(M,`/orders/${id}`)).data;
async function openSearch(page,id){ await page.goto(BASE+'/orders'); await page.waitForTimeout(1200); await page.getByPlaceholder('Search by order ID or customer...').fill(String(id)); await page.waitForTimeout(600); }
async function editFromList(page,id){ await openSearch(page,id); await page.getByRole('button',{name:/Edit/}).first().click(); await page.waitForTimeout(1500); }
async function addWidget(page){ await page.getByRole('button',{name:/QA Accessories/}).click().catch(()=>{}); await page.locator('.product-card').first().click(); await page.getByRole('button',{name:'+ Add to Order'}).click(); await page.waitForTimeout(400); }
async function toCheckout(page){ await page.getByRole('button',{name:/Confirm & Pay/}).click(); await page.waitForURL('**/checkout'); await page.waitForTimeout(500); }
const figures = async page => { const t=(await page.locator('body').innerText()).replace(/,/g,''); return { outstanding:(t.match(/Outstanding Balance\s*KSH (\d+)/)||[])[1]||'none', due:+((t.match(/Balance Due\s*KSH (\d+)/)||[])[1]||-1), state: await page.evaluate(()=>history.state?.usr?.orderData?.id) }; };
(async()=>{
  M=await tok('qa_manager'); ME=(await api(M,'/users/me')).data; P=(await api(M,'/products/')).data.find(p=>p.name==='QA Widget');
  const cs=(await api(M,'/users/customers')).data; IND=cs.find(c=>c.name==='QA Customer'); BIZ=cs.find(c=>c.name==='QA Business');
  const b=await chromium.launch();
  const login=async()=>{ const ctx=await b.newContext({viewport:{width:1400,height:900}}); const page=await ctx.newPage(); page.errs=[]; page.on('pageerror',e=>page.errs.push(e.message)); await page.goto(BASE+'/login');await page.locator('input').nth(0).fill('qa_manager');await page.locator('input').nth(1).fill('Test1234!');await page.locator('button[type=submit]').click();await page.waitForTimeout(1200); return page; };
  const seqs = {
    'A then B (no checkout)': async (page,A,B)=>{ await editFromList(page,A); await editFromList(page,B); },
    'A -> checkout -> Back -> B': async (page,A,B)=>{ await editFromList(page,A); await toCheckout(page); await page.getByText('BACK TO SALES').click(); await page.waitForTimeout(800); await editFromList(page,B); },
    'A -> browser back x2 -> B': async (page,A,B)=>{ await editFromList(page,A); await toCheckout(page); await page.goBack(); await page.waitForTimeout(500); await page.goBack(); await page.waitForTimeout(800); await editFromList(page,B); },
    'A -> reload -> B': async (page,A,B)=>{ await editFromList(page,A); await page.reload(); await page.waitForTimeout(1500); await editFromList(page,B); },
    'A -> summary B -> Edit Order': async (page,A,B)=>{ await editFromList(page,A); await openSearch(page,B); await page.getByText('QA Customer').first().click(); await page.waitForTimeout(1200); await page.getByRole('button',{name:/Edit Order/}).click(); await page.waitForTimeout(1500); },
    'A with VAT -> B without VAT': async (page,A,B)=>{ await editFromList(page,A); await editFromList(page,B); },
  };
  for (const [name, seq] of Object.entries(seqs)) {
    console.log(name);
    const vatA = name.includes('VAT');
    const A = await mk(20, 200, BIZ, vatA); const B = await mk(5, 0, IND);
    const aBefore = await ord(A);
    const page = await login();
    await seq(page, A, B);
    await addWidget(page); await toCheckout(page);
    const f = await figures(page);
    check('checkout targets order B', f.state === B, `state=${f.state} A=${A} B=${B}`);
    check('balance due is B\'s 600, not reduced by A\'s payment', f.due === 600, `due=${f.due} outstanding=${f.outstanding}`);
    await page.getByRole('button',{name:/cash/i}).click(); await page.getByRole('button',{name:/^Update Order/}).click();
    await page.waitForURL('**/checkout/receipt',{timeout:15000}).catch(()=>{});
    const bAfter = await ord(B), aAfter = await ord(A);
    check('B saved: 6 items worth 600, paid 600', bAfter.total===600 && bAfter.amountPaid===600, `${bAfter.total}/${bAfter.amountPaid}`);
    check('A untouched', aAfter.total===aBefore.total && aAfter.amountPaid===aBefore.amountPaid && aAfter.version===aBefore.version, `${aAfter.total}/${aAfter.amountPaid}`);
    check('no page errors', page.errs.length===0, page.errs.join(' | '));
    await page.context().close();
  }
  console.log('Resume: an edit in progress survives a reload');
  { const B = await mk(5, 0, IND); const page = await login(); await editFromList(page,B); await addWidget(page);
    await page.reload(); await page.waitForTimeout(1500);
    const cart = await page.evaluate(()=>JSON.parse(localStorage.getItem('emirates_pos_cart')||'[]').length);
    const es = await page.evaluate(()=>JSON.parse(localStorage.getItem('emirates_pos_edit_session')||'null'));
    check('cart keeps the added line after reload', cart===2, cart);
    check('session still for B', es && es.orderId===B, es && es.orderId);
    await toCheckout(page); const f = await figures(page);
    check('checkout after reload still targets B with due 600 (500 owed + 100 added)', f.state===B && f.due===600, JSON.stringify(f));
    await page.context().close(); }
  console.log('Stale session in storage is replaced when another order is opened');
  { const A = await mk(20, 200, BIZ); const B = await mk(5, 0, IND); const page = await login();
    await editFromList(page,A); const ctx = page.context(); // simulate "opened yesterday, left in storage"
    const page2 = await ctx.newPage(); page2.errs=[]; await editFromList(page2,B); await addWidget(page2); await toCheckout(page2);
    const f = await figures(page2); check('second tab edit targets B', f.state===B && f.due===600, JSON.stringify(f)); await ctx.close(); }
  console.log('Server refuses a cart from another order');
  { const A = await mk(2, 0, IND); const B = await mk(3, 0, IND);
    const bItems = (await ord(B)).items; const aBefore = await ord(A);
    const r = await api(M, `/orders/${A}/edit`, { method:'PUT', body: JSON.stringify({ customerId: IND.customerId??IND.id, servedBy: ME.userId, amountPaid: 0, VAT_status:false, items: bItems.map(i=>({productId:i.productId, variantId:i.variantId, quantity:i.quantity, unitPrice:i.unitPrice, unitType:i.unitType, details:{...(i.details||{}), _sourceItemId: i.itemId}})) }) });
    check('409 refusal', r.status===409, `${r.status} ${JSON.stringify(r.data).slice(0,140)}`);
    // By the order number people know it by, not its internal id.
    const bNo = (await ord(B)).orderNo ?? B;
    check('message names the other order', typeof r.data.detail==='string' && r.data.detail.includes('#'+bNo), r.data.detail);
    const aAfter = await ord(A); check('A unchanged', aAfter.total===aBefore.total && aAfter.items.length===aBefore.items.length);
    const plan = await api(M, `/orders/${A}/reversal-plan`, { method:'POST', body: JSON.stringify({ items: bItems.map(i=>({productId:i.productId, variantId:i.variantId, quantity:i.quantity, unitPrice:i.unitPrice, unitType:i.unitType, details:{_sourceItemId:i.itemId}})) }) });
    check('reversal-plan preview refuses too', plan.status===409, plan.status);
    const own = (await ord(A)).items;
    const ok = await api(M, `/orders/${A}/edit`, { method:'PUT', body: JSON.stringify({ customerId: IND.customerId??IND.id, servedBy: ME.userId, amountPaid: 0, VAT_status:false, items: own.map(i=>({productId:i.productId, variantId:i.variantId, quantity:i.quantity+1, unitPrice:i.unitPrice, unitType:i.unitType, details:{...(i.details||{}), _sourceItemId:i.itemId}})) }) });
    check('its own items are accepted', ok.status===200, `${ok.status} ${JSON.stringify(ok.data).slice(0,120)}`); }
  await b.close();
  const f=results.filter(x=>!x).length; console.log(`\n${results.length-f}/${results.length} passed`); process.exit(f?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
