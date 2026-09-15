/* =========================================================
   FINANCIAL OS — app.js
   Modules: CONFIG · STATE · UTILS · AUTH · DB · CONTEXT ·
            RENDER · CRUD · FORECAST · ANALYTICS · UI
========================================================= */

/* ========== CONFIG ========== */
const SUPABASE_URL = 'https://rwamqiewyslvjaezvauo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Qze8yU3XxqI9cHaO9I1YCw_xsa7uEwu';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ========== STATE ========== */
const state = {
  user: null,
  contextOwnerId: null,        // null = tous les comptes
  owners: [], storages: [], categories: [],
  transactions: [], loans: [], repayments: [], recurring: [],
  charts: {},
  filters: { quickRange: 'month', from: null, to: null, type: '', status: '', search: '' }
};

/* ========== UTILS ========== */
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Number(n||0))+' Ar';
const esc = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10); };
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const openModal  = html => { $('modalContent').innerHTML = html; show('modal'); };
const closeModal = () => hide('modal');
const nullify = v => (v === '' || v == null) ? null : v;

/* ========== AUTH ========== */
async function init(){
  const { data:{ session } } = await sb.auth.getSession();
  if(session){ state.user = session.user; enterApp(); }
  else { show('authView'); hide('appView'); }
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  const btn = e.target.querySelector('button');
  btn.textContent = 'Signing in…'; btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('email').value, password: $('password').value
  });
  btn.textContent = 'Enter Financial OS'; btn.disabled = false;
  if(error){ $('loginError').textContent = error.message; return; }
  state.user = data.user; enterApp();
});

$('logoutBtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function enterApp(){
  hide('authView'); show('appView');
  if(state.user) $('currentEmail').value = state.user.email || '';
  await loadAll();
}

/* ========== SETTINGS ========== */
$('settingsBtn').onclick = () => navigate('settings');

$('emailForm').onsubmit = async e => {
  e.preventDefault();
  $('emailMsg').textContent = 'Updating…';
  const { error } = await sb.auth.updateUser({ email: $('newEmail').value });
  $('emailMsg').textContent = error ? error.message : 'Check your inbox to confirm.';
};

$('pwdForm').onsubmit = async e => {
  e.preventDefault();
  const p = $('newPwd').value, c = $('confirmPwd').value;
  if(p !== c){ $('pwdMsg').textContent = 'Passwords do not match.'; return; }
  $('pwdMsg').textContent = 'Updating…';
  const { error } = await sb.auth.updateUser({ password: p });
  $('pwdMsg').textContent = error ? error.message : 'Password updated ✓';
};

/* ========== NAVIGATION ========== */
document.querySelectorAll('.nav').forEach(b => b.onclick = () => navigate(b.dataset.page));
document.querySelectorAll('[data-page-link]').forEach(b => b.onclick = () => navigate(b.dataset.pageLink));

function navigate(page){
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  $(page).classList.remove('hidden');
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  if(page === 'transactions') renderTransactions();
  if(page === 'forecast')     renderForecast();
  if(page === 'analytics')    renderAnalytics();
  if(page === 'calendar')     renderCalendar();
  if(page === 'settings' && state.user) $('currentEmail').value = state.user.email || '';
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ========== DB LOAD ========== */
async function loadAll(){
  const uid = state.user.id;
  const [o,s,c,t,l,rp,r] = await Promise.all([
    sb.from('owners').select('*').eq('user_id',uid).order('name'),
    sb.from('storages').select('*').eq('user_id',uid).order('name'),
    sb.from('categories').select('*').eq('user_id',uid).order('name'),
    sb.from('transactions').select('*').eq('user_id',uid).order('transaction_date',{ascending:false}).limit(2000),
    sb.from('loans').select('*').eq('user_id',uid).order('loan_date',{ascending:false}),
    sb.from('loan_repayments').select('*').eq('user_id',uid).order('repayment_date',{ascending:false}),
    sb.from('recurring_rules').select('*').eq('user_id',uid).order('start_date')
  ]);
  state.owners       = o.data || [];
  state.storages     = s.data || [];
  state.categories   = c.data || [];
  state.transactions = t.data || [];
  state.loans        = l.data || [];
  state.repayments   = rp.data || [];
  state.recurring    = r.data || [];

  buildContextSelect();
  renderAll();
}

/* ========== CONTEXT (filtre global par owner) ========== */
function buildContextSelect(){
  const sel = $('contextSelect');
  const current = state.contextOwnerId;
  sel.innerHTML = `<option value="">All accounts</option>` +
    state.owners.filter(o => o.is_active).map(o =>
      `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  sel.value = current || '';
}

$('contextSelect').onchange = e => {
  state.contextOwnerId = e.target.value || null;
  const owner = state.owners.find(o => o.id === state.contextOwnerId);
  $('contextLabel').textContent = owner ? owner.name : 'All accounts';
  renderAll();
};

/* ========== FILTRES CONTEXTUELS ========== */
function inContext(tx){
  if(!state.contextOwnerId) return true;
  return tx.owner_id === state.contextOwnerId || tx.counterparty_owner_id === state.contextOwnerId;
}
function contextStorages(){
  if(!state.contextOwnerId) return state.storages;
  return state.storages; // on garde tous les storages, le filtre owner suffit
}

/* ========== CALCULS ========== */
function txSigned(t){
  if(t.status === 'cancelled') return 0;
  if(t.transaction_type === 'expense') return -Number(t.amount);
  if(t.transaction_type === 'income')  return  Number(t.amount);
  return 0;
}
function storageBalance(id){
  return state.transactions.reduce((sum,t) => {
    if(t.status === 'cancelled') return sum;
    if(t.destination_storage_id === id) sum += Number(t.amount);
    if(t.source_storage_id === id)      sum -= Number(t.amount);
    return sum;
  },0);
}
function ownerNetWorth(ownerId){
  return state.transactions.reduce((sum,t) => {
    if(t.status === 'cancelled') return sum;
    if(t.owner_id !== ownerId) return sum;
    return sum + txSigned(t);
  },0);
}
const fmtDate = d => new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
const catName     = id => state.categories.find(c => c.id === id)?.name || 'Uncategorized';
const ownerName   = id => state.owners.find(o => o.id === id)?.name || '—';
const storageName = id => state.storages.find(s => s.id === id)?.name || '—';

/* ========== RENDER ALL ========== */
function renderAll(){
  renderDashboard();
  renderOwners();
  renderStorages();
  renderCategories();
  renderRecurring();
  renderLoans();
  if(!$('transactions').classList.contains('hidden')) renderTransactions();
  if(!$('forecast').classList.contains('hidden'))     renderForecast();
  if(!$('analytics').classList.contains('hidden'))    renderAnalytics();
  if(!$('calendar').classList.contains('hidden'))     renderCalendar();
}

/* ========== DASHBOARD ========== */
function renderDashboard(){
  const txs = state.transactions.filter(inContext);
  const completed = txs.filter(t => t.status === 'completed');
  const liquidity = state.storages.reduce((s,x) => s + storageBalance(x.id), 0);
  const income  = completed.filter(t => t.transaction_type==='income'  && t.transaction_date >= monthStart())
                           .reduce((s,t) => s + Number(t.amount), 0);
  const expense = completed.filter(t => t.transaction_type==='expense' && t.transaction_date >= monthStart())
                           .reduce((s,t) => s + Number(t.amount), 0);

  const receivables = state.loans
    .filter(l => ['active','partially_paid','overdue'].includes(l.status))
    .filter(l => !state.contextOwnerId || l.lender_owner_id === state.contextOwnerId)
    .reduce((s,l) => s + Number(l.principal_amount) - Number(l.repaid_amount), 0);

  const debts = state.loans
    .filter(l => ['active','partially_paid','overdue'].includes(l.status))
    .filter(l => !state.contextOwnerId || l.borrower_owner_id === state.contextOwnerId)
    .reduce((s,l) => s + Number(l.principal_amount) - Number(l.repaid_amount), 0);

  $('liquidity').textContent   = money(liquidity);
  $('receivables').textContent = money(receivables);
  $('debts').textContent       = money(debts);
  $('netWorth').textContent    = money(liquidity + receivables - debts);
  $('monthIncome').textContent = '+' + money(income);
  $('monthExpense').textContent= '−' + money(expense);
  $('cashFlow').textContent    = money(income - expense);
  $('savingsRate').textContent = income ? (((income-expense)/income*100).toFixed(1)+'%') : '—';

  $('quickTransactions').innerHTML = completed.slice(0,8).map(movementHTML).join('')
    || emptyHTML('No movements yet', 'Start by recording your first financial movement.');

  renderAlerts();
  renderCharts();
}

function movementHTML(t){
  const isIn = t.transaction_type === 'income';
  const sign = isIn ? '+' : (t.transaction_type === 'expense' ? '−' : '→');
  return `<div class="movement">
    <span class="date">${fmtDate(t.transaction_date)}</span>
    <div>
      <div class="reason">${esc(t.reason)}</div>
      <div class="meta">${esc(catName(t.category_id))} · ${esc(ownerName(t.owner_id))}</div>
    </div>
    <span class="badge">${esc(t.transaction_type)}</span>
    <span class="amount ${isIn?'in':t.transaction_type==='expense'?'out':''}">${sign}${money(t.amount)}</span>
  </div>`;
}

const emptyHTML = (title, sub) => `<div class="empty"><h4>${esc(title)}</h4><p>${esc(sub)}</p></div>`;

/* ========== ALERTS ========== */
function renderAlerts(){
  const alerts = [];
  const current = state.storages.reduce((s,x) => s + storageBalance(x.id), 0);
  const projections = [7,30,90].map(d => ({ d, v: projectedBalance(d) }));
  projections.forEach(p => {
    if(p.v < 0) alerts.push({ type:'warn', icon:'⚠', text:`Projected balance negative in ${p.d} days (${money(p.v)}).` });
  });

  const upcoming = state.transactions
    .filter(t => t.status === 'planned' && inContext(t))
    .filter(t => { const d = new Date(t.transaction_date); const now = new Date();
      return d >= now && d <= new Date(now.getTime() + 14*86400000); })
    .sort((a,b) => a.transaction_date.localeCompare(b.transaction_date))
    .slice(0,3);
  upcoming.forEach(t => alerts.push({
    type: 'warn', icon:'🗓',
    text:`${t.transaction_type === 'income' ? 'Incoming' : 'Upcoming'}: ${esc(t.reason)} — ${money(t.amount)} on ${fmtDate(t.transaction_date)}.`
  }));

  const overdue = state.loans.filter(l => l.status !== 'paid' && l.status !== 'cancelled'
    && l.due_date && l.due_date < today());
  overdue.forEach(l => alerts.push({ type:'warn', icon:'⏰',
    text:`Loan overdue: ${esc(ownerName(l.borrower_owner_id))} owes ${money(Number(l.principal_amount)-Number(l.repaid_amount))} since ${fmtDate(l.due_date)}.` }));

  const income = state.transactions.filter(t => t.status==='completed' && inContext(t)
    && t.transaction_type==='income' && t.transaction_date >= monthStart())
    .reduce((s,t) => s + Number(t.amount), 0);
  const expense = state.transactions.filter(t => t.status==='completed' && inContext(t)
    && t.transaction_type==='expense' && t.transaction_date >= monthStart())
    .reduce((s,t) => s + Number(t.amount), 0);
  if(income - expense > 0) alerts.push({ type:'ok', icon:'✓', text:`Positive cash flow this month: ${money(income-expense)}.` });
  if(alerts.length === 0) alerts.push({ type:'ok', icon:'✓', text:'All clear. No alerts.' });

  $('alertsList').innerHTML = alerts.slice(0,6).map(a =>
    `<div class="alert ${a.type}"><span class="icon">${a.icon}</span><span>${a.text}</span></div>`).join('');
}

/* ========== CHARTS ========== */
const CHART_COLORS = ['#a8846a','#c9a689','#8a6a52','#7fb069','#c25e5e','#6b8cae','#b08ca6','#d4b896'];

function chart(id, type, data, options = {}){
  if(state.charts[id]) state.charts[id].destroy();
  if(!$(id)) return;
  state.charts[id] = new Chart($(id), {
    type, data,
    options: {
      responsive:true, maintainAspectRatio:true,
      animation:{ duration:800, easing:'easeOutQuart' },
      plugins:{ legend:{ labels:{ color:'#8a8a8a', font:{ size:11, family:'Inter' }, boxWidth:10, boxHeight:10, padding:14 } } },
      scales: type === 'doughnut' ? {} : {
        x:{ ticks:{ color:'#5f5f5f', font:{ size:10 } }, grid:{ color:'#1a1a1a' } },
        y:{ ticks:{ color:'#5f5f5f', font:{ size:10 } }, grid:{ color:'#1a1a1a' } }
      },
      ...options
    }
  });
}

function renderCharts(){
  const txs = state.transactions.filter(inContext);
  const labels = [], vals = [];
  for(let i=5;i>=0;i--){
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const key = d.toISOString().slice(0,7);
    labels.push(key);
    vals.push(txs.filter(t => t.status==='completed' && t.transaction_date.startsWith(key))
      .reduce((s,t) => s + txSigned(t), 0));
  }
  chart('cashChart','line',{
    labels,
    datasets:[{
      label:'Net monthly flow', data:vals,
      borderColor:'#a8846a', backgroundColor:'rgba(168,132,106,.1)',
      borderWidth:2, tension:.35, fill:true, pointBackgroundColor:'#a8846a', pointRadius:3
    }]
  });

  const cats = state.categories.map(c => ({
    name:c.name,
    total: txs.filter(t => t.status==='completed' && t.transaction_type==='expense' && t.category_id===c.id)
      .reduce((s,t) => s + Number(t.amount), 0)
  })).filter(x => x.total);
  chart('categoryChart','doughnut',{
    labels: cats.map(x => x.name),
    datasets:[{ data: cats.map(x => x.total), backgroundColor: CHART_COLORS, borderColor:'#141414', borderWidth:2 }]
  });
}

/* ========== TRANSACTIONS ========== */
['searchTx','typeFilter','statusFilter','fromDate','toDate'].forEach(id =>
  $(id).addEventListener('input', () => {
    state.filters.search = $('searchTx').value;
    state.filters.type = $('typeFilter').value;
    state.filters.status = $('statusFilter').value;
    state.filters.from = $('fromDate').value;
    state.filters.to = $('toDate').value;
    renderTransactions();
  }));

document.querySelectorAll('#quickFilters .chip').forEach(chip => chip.onclick = () => {
  document.querySelectorAll('#quickFilters .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.filters.quickRange = chip.dataset.range;
  applyQuickRange();
  renderTransactions();
});

function applyQuickRange(){
  const now = new Date();
  const f = state.filters;
  let from = null, to = null;
  if(f.quickRange === 'today'){ from = to = today(); }
  else if(f.quickRange === 'week'){
    const d = new Date(now); d.setDate(d.getDate() - d.getDay());
    from = d.toISOString().slice(0,10); to = today();
  } else if(f.quickRange === 'month'){ from = monthStart(); to = today(); }
  else if(f.quickRange === 'prev-month'){
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    from = d.toISOString().slice(0,10); to = e.toISOString().slice(0,10);
  } else if(f.quickRange === 'year'){ from = new Date(now.getFullYear(),0,1).toISOString().slice(0,10); to = today(); }
  $('fromDate').value = from || ''; $('toDate').value = to || '';
  f.from = from; f.to = to;
}

function renderTransactions(){
  let list = state.transactions.filter(inContext);
  const f = state.filters;
  const q = (f.search || '').toLowerCase();
  list = list.filter(t =>
    (!q || `${t.reason} ${catName(t.category_id)} ${ownerName(t.owner_id)}`.toLowerCase().includes(q)) &&
    (!f.type || t.transaction_type === f.type) &&
    (!f.status || t.status === f.status) &&
    (!f.from || t.transaction_date >= f.from) &&
    (!f.to || t.transaction_date <= f.to)
  );
  $('transactionsTable').innerHTML = list.length === 0
    ? emptyHTML('No transactions', 'Try changing the filters or add a new movement.')
    : `<div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Date</th><th>Type</th><th>Category</th><th>Reason</th>
        <th>Owner</th><th>Source</th><th>Destination</th><th>Amount</th>
      </tr></thead><tbody>${list.map(t => `<tr>
        <td>${fmtDate(t.transaction_date)}</td>
        <td>${esc(t.transaction_type)}</td>
        <td>${esc(catName(t.category_id))}</td>
        <td>${esc(t.reason)}</td>
        <td>${esc(ownerName(t.owner_id))}</td>
        <td>${esc(storageName(t.source_storage_id))}</td>
        <td>${esc(storageName(t.destination_storage_id))}</td>
        <td>${t.transaction_type==='expense'?'−':t.transaction_type==='income'?'+':'→'}${money(t.amount)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

$('newTxBtn').onclick = () => transactionModal();
$('newTxBtn2').onclick = () => transactionModal();
$('newPlannedBtn').onclick = () => transactionModal({ status:'planned' });

function transactionModal(defaults = {}){
  openModal(`<h3>${defaults.status === 'planned' ? 'Planned transaction' : 'New transaction'}</h3>
    <form id="txForm" class="form-grid">
      <label>Type<select name="transaction_type">
        <option value="expense">Expense</option><option value="income">Income</option>
        <option value="transfer">Transfer</option><option value="gift">Gift</option><option value="loan">Loan</option>
      </select></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label>
      <label>Owner<select name="owner_id">${state.owners.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
      <label>Counterparty<select name="counterparty_owner_id"><option value="">None</option>${state.owners.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
      <label>Category<select name="category_id"><option value="">None</option>${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>Date<input name="transaction_date" type="date" value="${today()}"></label>
      <label>Source storage<select name="source_storage_id"><option value="">None</option>${state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>Destination storage<select name="destination_storage_id"><option value="">None</option>${state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>Reason<input name="reason" required></label>
      <label>Status<select name="status">
        <option value="completed" ${defaults.status!=='planned'?'selected':''}>Completed</option>
        <option value="planned" ${defaults.status==='planned'?'selected':''}>Planned</option>
      </select></label>
      <label class="full-row">Description<textarea name="description"></textarea></label>
      <button class="primary full-row" type="submit">Save</button>
    </form>`);
  $('txForm').onsubmit = async e => {
    e.preventDefault();
    const row = Object.fromEntries(new FormData(e.target));
    row.user_id = state.user.id;
    row.amount = Number(row.amount);
    ['owner_id','counterparty_owner_id','category_id','source_storage_id','destination_storage_id'].forEach(k => row[k] = nullify(row[k]));
    const { error } = await sb.from('transactions').insert(row);
    if(error){ alert(error.message); return; }
    closeModal(); await loadAll();
  };
}

/* ========== OWNERS ========== */
$('addOwnerBtn').onclick = () => modalSimple('New owner',
  `<label>Name<input name="name" required></label>
   <label>Type<select name="owner_type"><option value="individual">Individual</option><option value="company">Company</option><option value="other">Other</option></select></label>
   <label class="full-row">Description<input name="description"></label>`, 'owners');

function renderOwners(){
  const grid = $('ownersGrid');
  const list = state.owners;
  if(!list.length){ grid.innerHTML = emptyHTML('No owners yet','Create your first owner to start tracking money.'); return; }
  grid.innerHTML = list.map(o => {
    const net = ownerNetWorth(o.id);
    return `<div class="card">
      <span class="badge">${esc(o.owner_type)}${o.is_active?'':' · inactive'}</span>
      <h3>${esc(o.name)}</h3>
      <p class="muted">${esc(o.description || '')}</p>
      <div class="big">${money(net)}</div>
      <small class="muted">Net movement position</small>
      <div class="card-actions">
        <button onclick="toggleActive('owners','${o.id}',${!o.is_active})">${o.is_active?'Deactivate':'Activate'}</button>
        <button class="danger" onclick="deleteEntity('owners','${o.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

/* ========== STORAGES ========== */
$('addStorageBtn').onclick = () => modalSimple('New storage',
  `<label>Name<input name="name" required></label>
   <label>Type<select name="storage_type"><option>bank</option><option>cash</option><option>mobile_money</option><option>savings</option><option>investment</option><option>other</option></select></label>
   <label>Currency<input name="currency" value="MGA"></label>
   <label>Description<input name="description"></label>`, 'storages');

function renderStorages(){
  const grid = $('storagesGrid');
  if(!state.storages.length){ grid.innerHTML = emptyHTML('No storages yet','Add a bank account, cash wallet or mobile money account.'); return; }
  grid.innerHTML = state.storages.map(s => `<div class="card">
    <span class="badge">${esc(s.storage_type)}${s.is_active?'':' · inactive'}</span>
    <h3>${esc(s.name)}</h3>
    <p class="muted">${esc(s.description || '')}</p>
    <div class="big">${money(storageBalance(s.id))}</div>
    <small class="muted">${esc(s.currency)}</small>
    <div class="card-actions">
      <button onclick="toggleActive('storages','${s.id}',${!s.is_active})">${s.is_active?'Deactivate':'Activate'}</button>
      <button class="danger" onclick="deleteEntity('storages','${s.id}')">Delete</button>
    </div>
  </div>`).join('');
}

/* ========== CATEGORIES ========== */
$('addCategoryBtn').onclick = () => modalSimple('New category',
  `<label>Name<input name="name" required></label>
   <label>Type<select name="category_type"><option value="both">Both</option><option value="income">Income</option><option value="expense">Expense</option></select></label>
   <label>Color<input name="color" value="#a8846a"></label>
   <label>Icon<input name="icon" value="●"></label>`, 'categories');

function renderCategories(){
  const grid = $('categoriesGrid');
  if(!state.categories.length){ grid.innerHTML = emptyHTML('No categories yet','Group your money movements by category.'); return; }
  grid.innerHTML = state.categories.map(c => `<div class="card">
    <span class="badge" style="border-left:3px solid ${esc(c.color)}">${esc(c.category_type)}</span>
    <h3>${esc(c.icon || '●')} ${esc(c.name)}</h3>
    <p class="muted">${esc(c.color)}</p>
    <div class="card-actions">
      <button class="danger" onclick="deleteEntity('categories','${c.id}')">Delete</button>
    </div>
  </div>`).join('');
}

/* ========== RECURRING ========== */
$('addRecurringBtn').onclick = () => modalSimple('New recurring rule',
  `<label>Reason<input name="reason" required></label>
   <label>Amount<input name="amount" type="number" step="0.01" required></label>
   <label>Type<select name="transaction_type"><option value="expense">Expense</option><option value="income">Income</option></select></label>
   <label>Frequency<select name="frequency"><option>daily</option><option>weekly</option><option>monthly</option><option>yearly</option></select></label>
   <label>Start date<input name="start_date" type="date" value="${today()}"></label>
   <label>End date<input name="end_date" type="date"></label>
   <label>Day of month<input name="day_of_month" type="number" min="1" max="31"></label>
   <label>Owner<select name="owner_id"><option value="">None</option>${state.owners.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
   <label>Storage<select name="source_storage_id"><option value="">None</option>${state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`,
  'recurring_rules');

function renderRecurring(){
  const grid = $('recurringGrid');
  if(!state.recurring.length){ grid.innerHTML = emptyHTML('No recurring rules','Add rent, salary or subscriptions.'); return; }
  grid.innerHTML = state.recurring.map(r => `<div class="card">
    <span class="badge">${esc(r.frequency)}${r.is_active?'':' · inactive'}</span>
    <h3>${esc(r.reason)}</h3>
    <div class="big">${money(r.amount)}</div>
    <small class="muted">${fmtDate(r.start_date)}${r.end_date?' → '+fmtDate(r.end_date):' · ongoing'}</small>
    <div class="card-actions">
      <button onclick="toggleActive('recurring_rules','${r.id}',${!r.is_active})">${r.is_active?'Deactivate':'Activate'}</button>
      <button class="danger" onclick="deleteEntity('recurring_rules','${r.id}')">Delete</button>
    </div>
  </div>`).join('');
}

/* ========== LOANS ========== */
$('addLoanBtn').onclick = () => modalSimple('New loan',
  `<label>Lender<select name="lender_owner_id">${state.owners.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
   <label>Borrower<select name="borrower_owner_id">${state.owners.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
   <label>Amount<input name="principal_amount" type="number" step="0.01" required></label>
   <label>Loan date<input name="loan_date" type="date" value="${today()}"></label>
   <label>Due date<input name="due_date" type="date"></label>
   <label>Reason<input name="reason"></label>`,
  'loans');

function renderLoans(){
  const grid = $('loansGrid');
  if(!state.loans.length){ grid.innerHTML = emptyHTML('No loans','Track money lent or borrowed.'); return; }
  grid.innerHTML = state.loans.map(l => {
    const remaining = Number(l.principal_amount) - Number(l.repaid_amount);
    return `<div class="card">
      <span class="badge">${esc(l.status)}</span>
      <h3>${esc(ownerName(l.borrower_owner_id))}</h3>
      <p class="muted">Lender: ${esc(ownerName(l.lender_owner_id))}</p>
      <div class="big">${money(remaining)}</div>
      <small class="muted">${l.due_date?'Due '+fmtDate(l.due_date):'No due date'}</small>
      <div class="card-actions">
        <button onclick="repayLoan('${l.id}',${remaining})">Add repayment</button>
        <button class="danger" onclick="deleteEntity('loans','${l.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

window.repayLoan = async (loanId, remaining) => {
  openModal(`<h3>Loan repayment</h3>
    <form id="repayForm" class="form-grid">
      <label>Amount<input name="amount" type="number" step="0.01" required max="${remaining}" value="${remaining}"></label>
      <label>Date<input name="repayment_date" type="date" value="${today()}"></label>
      <label class="full-row">Reason<input name="reason"></label>
      <button class="primary full-row">Save repayment</button>
    </form>`);
  $('repayForm').onsubmit = async e => {
    e.preventDefault();
    const row = Object.fromEntries(new FormData(e.target));
    row.user_id = state.user.id;
    row.loan_id = loanId;
    row.amount = Number(row.amount);
    const { error } = await sb.from('loan_repayments').insert(row);
    if(error){ alert(error.message); return; }
    // Update loan repaid_amount & status
    const loan = state.loans.find(l => l.id === loanId);
    const newRepaid = Number(loan.repaid_amount) + row.amount;
    const newStatus = newRepaid >= Number(loan.principal_amount) ? 'paid' : 'partially_paid';
    await sb.from('loans').update({ repaid_amount:newRepaid, status:newStatus }).eq('id', loanId);
    closeModal(); await loadAll();
  };
};

/* ========== TOGGLE / DELETE ========== */
window.toggleActive = async (table, id, val) => {
  await sb.from(table).update({ is_active: val }).eq('id', id);
  await loadAll();
};
window.deleteEntity = async (table, id) => {
  if(!confirm('Delete this item permanently?')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if(error){ alert(error.message); return; }
  await loadAll();
};

/* ========== SIMPLE MODAL (CREATE) ========== */
function modalSimple(title, fields, table){
  openModal(`<h3>${title}</h3>
    <form id="simpleForm" class="form-grid">
      ${fields}
      <button class="primary full-row">Save</button>
    </form>`);
  $('simpleForm').onsubmit = async e => {
    e.preventDefault();
    const row = Object.fromEntries(new FormData(e.target));
    row.user_id = state.user.id;
    Object.keys(row).forEach(k => { if(row[k] === '') row[k] = null; });
    const { error } = await sb.from(table).insert(row);
    if(error){ alert(error.message); return; }
    closeModal(); await loadAll();
  };
}

/* ========== FORECAST ========== */
function projectedBalance(days){
  let total = state.storages.reduce((s,x) => s + storageBalance(x.id), 0);
  for(let i=1;i<=days;i++){
    const d = new Date(); d.setDate(d.getDate()+i);
    const ds = d.toISOString().slice(0,10);
    state.recurring
      .filter(r => r.is_active && inContext(r))
      .filter(r => r.start_date <= ds && (!r.end_date || r.end_date >= ds))
      .forEach(r => {
        const start = new Date(r.start_date+'T00:00:00');
        const match = r.frequency === 'daily'
          || (r.frequency === 'weekly'  && d.getDay()    === start.getDay())
          || (r.frequency === 'monthly' && d.getDate()   === Number(r.day_of_month || start.getDate()))
          || (r.frequency === 'yearly'  && d.getDate()   === start.getDate() && d.getMonth() === start.getMonth());
        if(match) total += (r.transaction_type === 'income' ? 1 : -1) * Number(r.amount);
      });
    state.transactions
      .filter(t => t.status === 'planned' && t.transaction_date === ds && inContext(t))
      .forEach(t => total += txSigned(t));
  }
  return total;
}

function renderForecast(){
  [7,30,90,365].forEach(n => $('f'+n).textContent = money(projectedBalance(n)));

  const labels = [], data = [];
  for(let i=0;i<=90;i+=5){
    const d = new Date(); d.setDate(d.getDate()+i);
    labels.push(d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}));
    data.push(projectedBalance(i));
  }
  chart('forecastChart','line',{
    labels,
    datasets:[{
      label:'Projected balance', data,
      borderColor:'#a8846a', backgroundColor:'rgba(168,132,106,.08)',
      borderWidth:2, tension:.3, fill:true, pointRadius:0
    }]
  });

  $('forecastWarnings').innerHTML = [7,30,90,365]
    .map(n => projectedBalance(n) < 0
      ? `<div class="warning">Potential cash shortage within ${n} days: projected balance ${money(projectedBalance(n))}.</div>`
      : '').join('');
}

/* ========== ANALYTICS ========== */
function renderAnalytics(){
  const txs = state.transactions.filter(inContext).filter(t => t.status === 'completed');
  const income  = txs.filter(t => t.transaction_type==='income' ).reduce((s,t) => s + Number(t.amount), 0);
  const expense = txs.filter(t => t.transaction_type==='expense').reduce((s,t) => s + Number(t.amount), 0);

  const labels = [], inc = [], exp = [];
  for(let i=5;i>=0;i--){
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const k = d.toISOString().slice(0,7);
    labels.push(k);
    inc.push(txs.filter(t => t.transaction_type==='income'  && t.transaction_date.startsWith(k)).reduce((s,t) => s + Number(t.amount),0));
    exp.push(txs.filter(t => t.transaction_type==='expense' && t.transaction_date.startsWith(k)).reduce((s,t) => s + Number(t.amount),0));
  }
  chart('incomeExpenseChart','bar',{labels,datasets:[
    { label:'Income',   data:inc, backgroundColor:'#7fb069', borderRadius:6 },
    { label:'Expenses', data:exp, backgroundColor:'#a8846a', borderRadius:6 }
  ]});

  const incCats = state.categories.map(c => ({
    name:c.name, total: txs.filter(t => t.transaction_type==='income' && t.category_id===c.id).reduce((s,t) => s + Number(t.amount),0)
  })).filter(x => x.total);
  chart('incomeCategoryChart','doughnut',{
    labels: incCats.map(x => x.name),
    datasets:[{ data: incCats.map(x => x.total), backgroundColor: CHART_COLORS, borderColor:'#141414', borderWidth:2 }]
  });

  const expCats = state.categories.map(c => ({
    name:c.name, total: txs.filter(t => t.transaction_type==='expense' && t.category_id===c.id).reduce((s,t) => s + Number(t.amount),0)
  })).filter(x => x.total);
  chart('expenseCategoryChart','doughnut',{
    labels: expCats.map(x => x.name),
    datasets:[{ data: expCats.map(x => x.total), backgroundColor: CHART_COLORS, borderColor:'#141414', borderWidth:2 }]
  });

  const rate = income ? ((income - expense) / income * 100) : 0;
  $('analyticsList').innerHTML = `
    <div class="insight">Total income <strong>${money(income)}</strong></div>
    <div class="insight">Total expenses <strong>${money(expense)}</strong></div>
    <div class="insight">Net cash flow <strong>${money(income-expense)}</strong></div>
    <div class="insight">Savings rate <strong>${rate.toFixed(1)}%</strong></div>`;
}

/* ========== CALENDAR ========== */
function renderCalendar(){
  const grid = $('calendarGrid');
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const startDay = (first.getDay() + 6) % 7; // Monday = 0

  const events = {};
  const addEvent = (date, ev) => { (events[date] ||= []).push(ev); };

  state.transactions.filter(t => t.status === 'planned' && inContext(t)).forEach(t => addEvent(t.transaction_date, {
    type: t.transaction_type === 'income' ? 'income' : 'expense',
    label: `${t.reason} · ${money(t.amount)}`,
    ref: { kind:'tx', id:t.id }
  }));

  for(let i=1;i<=daysInMonth;i++){
    const d = new Date(year, month, i);
    const ds = d.toISOString().slice(0,10);
    state.recurring.filter(r => r.is_active && inContext(r))
      .filter(r => r.start_date <= ds && (!r.end_date || r.end_date >= ds))
      .forEach(r => {
        const start = new Date(r.start_date+'T00:00:00');
        const match = r.frequency === 'daily'
          || (r.frequency === 'weekly'  && d.getDay()    === start.getDay())
          || (r.frequency === 'monthly' && d.getDate()   === Number(r.day_of_month || start.getDate()))
          || (r.frequency === 'yearly'  && d.getDate()   === start.getDate() && d.getMonth() === start.getMonth());
        if(match) addEvent(ds, {
          type: r.transaction_type === 'income' ? 'income' : 'expense',
          label: `↻ ${r.reason} · ${money(r.amount)}`,
          ref: { kind:'rule', id:r.id }
        });
      });
  }

  const dayNames = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  let html = dayNames.map(d => `<div class="cal-cell" style="min-height:auto;text-align:center;color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase">${d}</div>`).join('');
  for(let i=0;i<startDay;i++) html += `<div class="cal-cell" style="opacity:.2"></div>`;
  for(let i=1;i<=daysInMonth;i++){
    const d = new Date(year, month, i);
    const ds = d.toISOString().slice(0,10);
    const isToday = ds === today();
    const evs = events[ds] || [];
    html += `<div class="cal-cell ${isToday?'today':''}">
      <div class="day">${i}</div>
      ${evs.slice(0,3).map(e => `<span class="cal-event ${e.type}" title="${esc(e.label)}">${esc(e.label)}</span>`).join('')}
      ${evs.length > 3 ? `<span class="muted" style="font-size:9px">+${evs.length-3} more</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

/* ========== GLOBAL SEARCH ========== */
$('globalSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  if(!q) return;
  const matchTx = state.transactions.filter(t => `${t.reason} ${t.description||''} ${ownerName(t.owner_id)} ${storageName(t.source_storage_id)} ${storageName(t.destination_storage_id)}`.toLowerCase().includes(q));
  if(matchTx.length){
    navigate('transactions');
    $('searchTx').value = e.target.value;
    state.filters.search = e.target.value;
    renderTransactions();
  }
});

/* ========== EXPORT CSV ========== */
$('exportBtn').onclick = () => {
  const txs = state.transactions.filter(inContext);
  const header = ['date','type','category','reason','owner','source','destination','amount','status'];
  const rows = txs.map(t => [
    t.transaction_date, t.transaction_type, catName(t.category_id), t.reason,
    ownerName(t.owner_id), storageName(t.source_storage_id), storageName(t.destination_storage_id),
    t.amount, t.status
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `financial-os-${today()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

/* ========== MODAL CLOSE ========== */
$('closeModal').onclick = closeModal;
$('modal').onclick = e => { if(e.target.id === 'modal') closeModal(); };

/* ========== BOOT ========== */
init();
