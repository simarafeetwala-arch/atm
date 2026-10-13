/**
 * APEX DIGITAL BANK & ATM CONTROLLER
 * Main application logic handling state, virtual hardware, Supabase synchronization,
 * audio synthesizers, UI components, and transactional business rules.
 */

// Global State
const State = {
  users: [],
  transactions: [],
  balances: {}, // user_id -> number
  activeUser: null, // user object currently in ATM
  soundEnabled: true,
  latestReceipt: null,
  activeFilter: 'all',
  lastPing: 0
};

// ==========================================================================
// 1. WEB AUDIO SYNTHESIZER (AUTHENTIC ATM SOUND EFFECTS)
// ==========================================================================
class SoundFX {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  beep(freq = 1200, duration = 0.06, type = 'sine') {
    if (!State.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  cardClick() {
    this.beep(800, 0.08, 'triangle');
  }

  dispense() {
    if (!State.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      // Mechanical buzz simulation
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.beep(300 + i * 40, 0.09, 'sawtooth'), i * 80);
      }
      setTimeout(() => this.beep(1600, 0.15, 'sine'), 400);
    } catch (e) {}
  }

  success() {
    this.beep(880, 0.1, 'sine');
    setTimeout(() => this.beep(1320, 0.18, 'sine'), 100);
  }

  error() {
    this.beep(240, 0.2, 'square');
  }
}

const sfx = new SoundFX();

// ==========================================================================
// 2. TOAST NOTIFICATION SYSTEM
// ==========================================================================
function showToast(title, desc = '', type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="toast-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/[&<>"']/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

function formatCurrency(num) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(num || 0);
}

function formatDate(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return isoStr;
  }
}

// ==========================================================================
// 3. CORE DATA MANAGEMENT & CALCULATIONS
// ==========================================================================

/**
 * Recomputes balance for all users based on Supabase transaction history
 */
function recalculateBalances() {
  const balMap = {};
  
  // Initialize all known users with $0
  State.users.forEach(u => {
    balMap[u.id] = 0;
  });

  // Aggregate ATM transactions
  State.transactions.forEach(tx => {
    const uid = tx.user_id;
    const type = (tx.type || '').toLowerCase();
    const amount = Number(tx.amount) || 0;

    if (balMap[uid] === undefined) {
      balMap[uid] = 0;
    }

    if (['deposit', 'credit', 'transfer_in'].includes(type)) {
      balMap[uid] += amount;
    } else if (['withdraw', 'withdrawal', 'debit', 'transfer_out'].includes(type)) {
      balMap[uid] -= amount;
    }
  });

  State.balances = balMap;
}

/**
 * Loads both Users and ATM transactions from Supabase
 */
async function loadAllData() {
  const refreshBtn = document.getElementById('refreshAllBtn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    const t0 = performance.now();
    const [users, transactions] = await Promise.all([
      window.supabaseService.getUsers(),
      window.supabaseService.getTransactions()
    ]);
    const ping = Math.round(performance.now() - t0);

    State.users = users || [];
    State.transactions = transactions || [];
    recalculateBalances();

    // Update connection badge
    updateConnectionStatus(true, ping);

    // Refresh UI Components
    renderStats();
    renderQuickUsersList();
    renderUserSelectOptions();
    renderUsersGrid();
    renderTransactionsTable();
    updateAtmScreenActiveUser();

    console.log(`Synced data from Supabase: ${State.users.length} users, ${State.transactions.length} transactions (${ping}ms)`);
  } catch (err) {
    console.error('Failed to load data from Supabase:', err);
    updateConnectionStatus(false);
    showToast('Supabase Connection Error', err.message, 'error');
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

function updateConnectionStatus(isOnline, latency = 0) {
  const badge = document.getElementById('supabaseStatusBadge');
  const text = document.getElementById('supabaseStatusText');
  const pingEl = document.getElementById('pingLatency');

  if (isOnline) {
    badge.className = 'supabase-badge';
    text.textContent = 'Supabase Connected';
    pingEl.textContent = `(${latency}ms)`;
  } else {
    badge.className = 'supabase-badge offline';
    text.textContent = 'Disconnected';
    pingEl.textContent = '';
  }
}

// ==========================================================================
// 4. STATS & OVERVIEW RENDERING
// ==========================================================================
function renderStats() {
  const statUsers = document.getElementById('statUsersCount');
  const statDep = document.getElementById('statTotalDeposits');
  const statWth = document.getElementById('statTotalWithdrawals');
  const statNet = document.getElementById('statNetBalance');
  const sideOps = document.getElementById('sideOpsCount');

  let totalDeposits = 0;
  let totalWithdrawals = 0;

  State.transactions.forEach(tx => {
    const type = (tx.type || '').toLowerCase();
    const amt = Number(tx.amount) || 0;
    if (['deposit', 'transfer_in', 'credit'].includes(type)) {
      totalDeposits += amt;
    } else if (['withdraw', 'withdrawal', 'transfer_out', 'debit'].includes(type)) {
      totalWithdrawals += amt;
    }
  });

  const net = totalDeposits - totalWithdrawals;

  if (statUsers) statUsers.textContent = State.users.length;
  if (statDep) statDep.textContent = formatCurrency(totalDeposits);
  if (statWth) statWth.textContent = formatCurrency(totalWithdrawals);
  if (statNet) statNet.textContent = formatCurrency(net);
  if (sideOps) sideOps.textContent = State.transactions.length;
}

// ==========================================================================
// 5. ATM HARDWARE & SCREEN ENGINE
// ==========================================================================

function switchAtmScreenState(stateId) {
  const states = [
    'atmStateWelcome',
    'atmStateMenu',
    'atmStateDeposit',
    'atmStateWithdraw',
    'atmStateTransfer',
    'atmStateBalance',
    'atmStateProcessing'
  ];

  states.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  const target = document.getElementById(stateId);
  if (target) {
    target.classList.add('active');
  }

  // Clear focused input focus if switching
  if (stateId === 'atmStateDeposit') {
    const input = document.getElementById('atmDepositAmount');
    if (input) {
      input.value = '';
      input.focus();
    }
  } else if (stateId === 'atmStateWithdraw') {
    const input = document.getElementById('atmWithdrawAmount');
    const avail = document.getElementById('withdrawAvailBal');
    if (avail && State.activeUser) {
      avail.textContent = formatCurrency(State.balances[State.activeUser.id] || 0);
    }
    if (input) {
      input.value = '';
      input.focus();
    }
  } else if (stateId === 'atmStateBalance') {
    if (State.activeUser) {
      const bal = State.balances[State.activeUser.id] || 0;
      document.getElementById('inquiryAccNum').textContent = State.activeUser.account_number;
      document.getElementById('inquiryBalanceDisplay').textContent = formatCurrency(bal);
    }
  } else if (stateId === 'atmStateTransfer') {
    populateTransferBeneficiaries();
  }
}

function updateAtmScreenActiveUser() {
  const sessionUser = document.getElementById('screenSessionUser');
  const cardMockup = document.getElementById('cardMockup');
  const cardMockupLabel = document.getElementById('cardMockupLabel');
  const cardSlotLed = document.getElementById('cardSlotLed');
  const select = document.getElementById('atmUserSelect');

  if (State.activeUser) {
    const bal = State.balances[State.activeUser.id] || 0;
    if (sessionUser) sessionUser.textContent = `CUSTOMER: ${State.activeUser.user_name.toUpperCase()}`;
    if (cardMockup) cardMockup.classList.add('inserted');
    if (cardMockupLabel) cardMockupLabel.textContent = `💳 ${State.activeUser.user_name}`;
    if (cardSlotLed) {
      cardSlotLed.style.background = 'var(--accent-emerald)';
      cardSlotLed.style.boxShadow = '0 0 10px var(--accent-emerald)';
    }

    // Update Menu state header
    const menuName = document.getElementById('menuUserName');
    const menuAcc = document.getElementById('menuUserAcc');
    const menuBal = document.getElementById('menuUserBalance');
    if (menuName) menuName.textContent = State.activeUser.user_name;
    if (menuAcc) menuAcc.textContent = `ACC: **** ${String(State.activeUser.account_number).slice(-4)}`;
    if (menuBal) menuBal.textContent = formatCurrency(bal);

    if (select) select.value = State.activeUser.id;
  } else {
    if (sessionUser) sessionUser.textContent = 'NO CARD INSERTED';
    if (cardMockup) cardMockup.classList.remove('inserted');
    if (cardMockupLabel) cardMockupLabel.textContent = '💳 APEX DEBIT';
    if (cardSlotLed) {
      cardSlotLed.style.background = '#64748b';
      cardSlotLed.style.boxShadow = 'none';
    }
    if (select) select.value = '';
  }
}

/**
 * Loads a user into ATM and shows Main Menu
 */
function insertCardForUser(user) {
  if (!user) return;
  State.activeUser = user;
  sfx.cardClick();
  updateAtmScreenActiveUser();
  switchAtmScreenState('atmStateMenu');
  renderQuickUsersList();
  showToast('Card Accepted', `Welcome, ${user.user_name}! PIN Verified.`, 'success');

  // Switch to ATM tab if not already on it
  activateTab('atm-view');
}

/**
 * Ejects card from ATM
 */
function ejectCard() {
  if (State.activeUser) {
    showToast('Card Ejected', `Thank you, ${State.activeUser.user_name}. Please take your card.`, 'info');
  }
  State.activeUser = null;
  sfx.cardClick();
  updateAtmScreenActiveUser();
  switchAtmScreenState('atmStateWelcome');
  renderQuickUsersList();
}

/**
 * Trigger animated cash dispensing
 */
function triggerCashDispenser(amount) {
  sfx.dispense();
  const bill = document.getElementById('dispensedCashBill');
  const tag = document.getElementById('dispensedAmountTag');
  if (bill && tag) {
    tag.textContent = formatCurrency(amount);
    bill.classList.add('active');

    // Auto-retract after 8s if user doesn't click
    setTimeout(() => {
      bill.classList.remove('active');
    }, 8000);
  }
}

// ==========================================================================
// 6. ATM TRANSACTIONS EXECUTION
// ==========================================================================

async function executeAtmDeposit() {
  if (!State.activeUser) {
    showToast('Error', 'Please insert a card first.', 'error');
    return;
  }

  const amtInput = document.getElementById('atmDepositAmount');
  const locInput = document.getElementById('atmDepositLocation');
  const amount = Number(amtInput.value);

  if (!amount || amount <= 0) {
    sfx.error();
    showToast('Invalid Amount', 'Please enter a valid deposit amount.', 'warning');
    amtInput.focus();
    return;
  }

  const location = (locInput.value && locInput.value.trim()) || 'Apex ATM #01';

  // Processing screen
  setProcessingScreen(true, 'DEPOSITING CASH...', 'Counting banknotes in deposit slot...');
  switchAtmScreenState('atmStateProcessing');

  try {
    const tx = await window.supabaseService.createTransaction({
      user_id: State.activeUser.id,
      type: 'deposit',
      amount: amount,
      location: location
    });

    sfx.success();
    // Reload data
    await loadAllData();

    setReceiptData({
      log_id: tx.log_id || 'DEP-' + Date.now(),
      created_at: tx.created_at || new Date().toISOString(),
      user_name: State.activeUser.user_name,
      account_number: State.activeUser.account_number,
      type: 'CASH DEPOSIT',
      amount: amount,
      location: location,
      balance: State.balances[State.activeUser.id] || 0
    });

    setProcessingScreen(false, 'DEPOSIT SUCCESSFUL!', `Added ${formatCurrency(amount)} to account.`);
    showToast('Deposit Complete', `Successfully deposited ${formatCurrency(amount)} to Supabase!`, 'success');
  } catch (err) {
    sfx.error();
    setProcessingScreen(false, 'TRANSACTION FAILED', err.message);
    showToast('Deposit Error', err.message, 'error');
  }
}

async function executeAtmWithdrawal() {
  if (!State.activeUser) {
    showToast('Error', 'Please insert a card first.', 'error');
    return;
  }

  const amtInput = document.getElementById('atmWithdrawAmount');
  const locInput = document.getElementById('atmWithdrawLocation');
  const amount = Number(amtInput.value);
  const currentBalance = State.balances[State.activeUser.id] || 0;

  if (!amount || amount <= 0) {
    sfx.error();
    showToast('Invalid Amount', 'Please enter a valid withdrawal amount.', 'warning');
    amtInput.focus();
    return;
  }

  if (amount > currentBalance) {
    sfx.error();
    showToast('Insufficient Funds', `Your balance is ${formatCurrency(currentBalance)}. Cannot withdraw ${formatCurrency(amount)}.`, 'error');
    return;
  }

  const location = (locInput.value && locInput.value.trim()) || 'Apex ATM #01';

  setProcessingScreen(true, 'DISPENSING CASH...', 'Authorizing with bank vault & verifying balance...');
  switchAtmScreenState('atmStateProcessing');

  try {
    const tx = await window.supabaseService.createTransaction({
      user_id: State.activeUser.id,
      type: 'withdraw',
      amount: amount,
      location: location
    });

    triggerCashDispenser(amount);
    await loadAllData();

    setReceiptData({
      log_id: tx.log_id || 'WTH-' + Date.now(),
      created_at: tx.created_at || new Date().toISOString(),
      user_name: State.activeUser.user_name,
      account_number: State.activeUser.account_number,
      type: 'CASH WITHDRAWAL',
      amount: amount,
      location: location,
      balance: State.balances[State.activeUser.id] || 0
    });

    setProcessingScreen(false, 'CASH DISPENSED!', `Please take your ${formatCurrency(amount)} from the slot below.`);
    showToast('Cash Dispensed', `Dispensed ${formatCurrency(amount)}. Please take cash!`, 'success');
  } catch (err) {
    sfx.error();
    setProcessingScreen(false, 'DISPENSE FAILED', err.message);
    showToast('Withdrawal Error', err.message, 'error');
  }
}

async function executeFastCash() {
  if (!State.activeUser) {
    showToast('Error', 'Please insert a card first.', 'error');
    return;
  }

  const amount = 100;
  const currentBalance = State.balances[State.activeUser.id] || 0;

  if (amount > currentBalance) {
    sfx.error();
    showToast('Insufficient Funds', `Balance of ${formatCurrency(currentBalance)} is less than fast cash amount ($100).`, 'error');
    return;
  }

  setProcessingScreen(true, 'FAST CASH DISPENSING...', 'Quick withdrawal of $100 in progress...');
  switchAtmScreenState('atmStateProcessing');

  try {
    const tx = await window.supabaseService.createTransaction({
      user_id: State.activeUser.id,
      type: 'withdraw',
      amount: amount,
      location: 'Apex ATM #01 (Fast Cash)'
    });

    triggerCashDispenser(amount);
    await loadAllData();

    setReceiptData({
      log_id: tx.log_id || 'FST-' + Date.now(),
      created_at: tx.created_at || new Date().toISOString(),
      user_name: State.activeUser.user_name,
      account_number: State.activeUser.account_number,
      type: 'FAST CASH ($100)',
      amount: amount,
      location: 'Apex ATM #01',
      balance: State.balances[State.activeUser.id] || 0
    });

    setProcessingScreen(false, 'FAST CASH READY!', 'Please take your $100 bill.');
    showToast('Fast Cash Dispensed', 'Please collect $100 from the cash dispenser.', 'success');
  } catch (err) {
    sfx.error();
    setProcessingScreen(false, 'FAST CASH FAILED', err.message);
    showToast('Fast Cash Error', err.message, 'error');
  }
}

async function executeAtmTransfer() {
  if (!State.activeUser) {
    showToast('Error', 'Please insert a card first.', 'error');
    return;
  }

  const recipientSelect = document.getElementById('atmTransferRecipientSelect');
  const amtInput = document.getElementById('atmTransferAmount');
  const recipientId = Number(recipientSelect.value);
  const amount = Number(amtInput.value);
  const currentBalance = State.balances[State.activeUser.id] || 0;

  if (!recipientId) {
    sfx.error();
    showToast('Select Beneficiary', 'Please select a recipient account.', 'warning');
    return;
  }

  if (!amount || amount <= 0) {
    sfx.error();
    showToast('Invalid Amount', 'Please enter a valid transfer amount.', 'warning');
    amtInput.focus();
    return;
  }

  if (amount > currentBalance) {
    sfx.error();
    showToast('Insufficient Funds', `Your balance is ${formatCurrency(currentBalance)}. Cannot transfer ${formatCurrency(amount)}.`, 'error');
    return;
  }

  const recipientUser = State.users.find(u => u.id === recipientId);
  const recipientName = recipientUser ? recipientUser.user_name : `User #${recipientId}`;

  setProcessingScreen(true, 'WIRE TRANSFER IN PROGRESS...', `Routing funds to ${recipientName}...`);
  switchAtmScreenState('atmStateProcessing');

  try {
    // 1. Create debit for sender
    const txOut = await window.supabaseService.createTransaction({
      user_id: State.activeUser.id,
      type: 'transfer_out',
      amount: amount,
      location: `Transfer to ${recipientName}`
    });

    // 2. Create credit for recipient
    await window.supabaseService.createTransaction({
      user_id: recipientId,
      type: 'transfer_in',
      amount: amount,
      location: `Transfer from ${State.activeUser.user_name}`
    });

    sfx.success();
    await loadAllData();

    setReceiptData({
      log_id: txOut.log_id || 'TRF-' + Date.now(),
      created_at: txOut.created_at || new Date().toISOString(),
      user_name: State.activeUser.user_name,
      account_number: State.activeUser.account_number,
      type: `WIRE TO ${recipientName.toUpperCase()}`,
      amount: amount,
      location: 'Apex ATM #01 Wire System',
      balance: State.balances[State.activeUser.id] || 0
    });

    setProcessingScreen(false, 'TRANSFER EXECUTED!', `Successfully transferred ${formatCurrency(amount)} to ${recipientName}.`);
    showToast('Transfer Complete', `Transferred ${formatCurrency(amount)} to ${recipientName}.`, 'success');
  } catch (err) {
    sfx.error();
    setProcessingScreen(false, 'TRANSFER FAILED', err.message);
    showToast('Transfer Error', err.message, 'error');
  }
}

function setProcessingScreen(isBusy, title, subtitle) {
  const icon = document.getElementById('processingIcon');
  const titleEl = document.getElementById('processingTitle');
  const subEl = document.getElementById('processingSubtitle');
  const doneBtn = document.getElementById('processingDoneBtn');

  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;

  if (isBusy) {
    if (icon) icon.textContent = '⏳';
    if (doneBtn) doneBtn.style.display = 'none';
  } else {
    if (icon) icon.textContent = '✅';
    if (doneBtn) doneBtn.style.display = 'inline-block';
  }
}

function populateTransferBeneficiaries() {
  const select = document.getElementById('atmTransferRecipientSelect');
  if (!select) return;

  select.innerHTML = '<option value="">-- Choose Beneficiary --</option>';
  State.users
    .filter(u => !State.activeUser || u.id !== State.activeUser.id)
    .forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.user_name} (Acc: ${u.account_number}) - ${u.location || 'Branch'}`;
      select.appendChild(opt);
    });
}

// ==========================================================================
// 7. RECEIPT BUILDER & PRINTER
// ==========================================================================

function setReceiptData(data) {
  State.latestReceipt = data;

  const dtEl = document.getElementById('receiptDateTime');
  const txIdEl = document.getElementById('receiptTxId');
  const userEl = document.getElementById('receiptUserName');
  const accEl = document.getElementById('receiptAccountMasked');
  const locEl = document.getElementById('receiptLocation');
  const typeEl = document.getElementById('receiptTxType');
  const amtEl = document.getElementById('receiptAmount');
  const balEl = document.getElementById('receiptBalance');

  if (dtEl) dtEl.textContent = formatDate(data.created_at);
  if (txIdEl) txIdEl.textContent = `#${data.log_id}`;
  if (userEl) userEl.textContent = (data.user_name || '').toUpperCase();
  if (accEl) accEl.textContent = `**** ${String(data.account_number).slice(-4)}`;
  if (locEl) locEl.textContent = (data.location || 'ATM TERMINAL #01').toUpperCase();
  if (typeEl) typeEl.textContent = (data.type || 'TRANSACTION').toUpperCase();
  if (amtEl) amtEl.textContent = formatCurrency(data.amount);
  if (balEl) balEl.textContent = formatCurrency(data.balance);
}

function openReceiptModal() {
  if (!State.latestReceipt) {
    if (State.activeUser) {
      setReceiptData({
        log_id: 'INQ-' + Math.floor(Math.random() * 100000),
        created_at: new Date().toISOString(),
        user_name: State.activeUser.user_name,
        account_number: State.activeUser.account_number,
        type: 'BALANCE INQUIRY',
        amount: 0,
        location: 'Apex ATM Terminal #01',
        balance: State.balances[State.activeUser.id] || 0
      });
    } else {
      showToast('No Recent Activity', 'Perform an ATM operation or balance inquiry first.', 'info');
      return;
    }
  }

  const modal = document.getElementById('receiptModal');
  if (modal) modal.classList.add('active');
}

// ==========================================================================
// 8. USERS TAB & ROSTER RENDERING
// ==========================================================================

function renderQuickUsersList() {
  const container = document.getElementById('quickUsersList');
  if (!container) return;

  if (!State.users.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">
        No accounts registered yet.<br />Click "+ New" to add one!
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  State.users.forEach(u => {
    const isSelected = State.activeUser && State.activeUser.id === u.id;
    const bal = State.balances[u.id] || 0;
    const initials = (u.user_name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    const item = document.createElement('div');
    item.className = `quick-user-item ${isSelected ? 'selected' : ''}`;
    item.innerHTML = `
      <div class="user-avatar-initials">${escapeHtml(initials)}</div>
      <div class="quick-user-meta">
        <div class="name">${escapeHtml(u.user_name)}</div>
        <div class="acc">Acc: ${escapeHtml(String(u.account_number))}</div>
      </div>
      <div class="quick-user-balance">${formatCurrency(bal)}</div>
    `;

    item.addEventListener('click', () => {
      insertCardForUser(u);
    });

    container.appendChild(item);
  });
}

function renderUserSelectOptions() {
  const select = document.getElementById('atmUserSelect');
  const tellerSelect = document.getElementById('tellerUserSelect');
  const tellerRecip = document.getElementById('tellerRecipientSelect');

  const optionsHtml = '<option value="">-- Choose Account --</option>' +
    State.users.map(u => {
      const bal = State.balances[u.id] || 0;
      return `<option value="${u.id}">${escapeHtml(u.user_name)} (Acc: ${u.account_number}) - ${formatCurrency(bal)}</option>`;
    }).join('');

  if (select) select.innerHTML = optionsHtml;
  if (tellerSelect) tellerSelect.innerHTML = optionsHtml;
  if (tellerRecip) tellerRecip.innerHTML = optionsHtml;
}

function renderUsersGrid() {
  const container = document.getElementById('usersGrid');
  const search = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
  if (!container) return;

  const filtered = State.users.filter(u => {
    if (!search) return true;
    return (
      (u.user_name && u.user_name.toLowerCase().includes(search)) ||
      (String(u.account_number).includes(search)) ||
      (u.location && u.location.toLowerCase().includes(search))
    );
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <p>No bank customers found matching search.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(u => {
    const bal = State.balances[u.id] || 0;
    const initials = (u.user_name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="user-card-header">
        <div class="user-avatar-lg">${escapeHtml(initials)}</div>
        <div class="user-info-text">
          <h4>${escapeHtml(u.user_name)}</h4>
          <div class="user-location">📍 ${escapeHtml(u.location || 'Central Branch')}</div>
        </div>
      </div>

      <div class="account-badge">
        <span class="acc-label">Account No.</span>
        <span class="acc-num">${escapeHtml(String(u.account_number))}</span>
      </div>

      <div class="balance-showcase">
        <span class="label">Current Balance</span>
        <span class="amount">${formatCurrency(bal)}</span>
      </div>

      <div class="user-card-actions">
        <button class="user-action-btn btn-atm" data-id="${u.id}">
          🏧 Insert into ATM
        </button>
        <button class="user-action-btn btn-delete" data-id="${u.id}" title="Delete Account">
          🗑️
        </button>
      </div>
    `;

    // Action listeners
    card.querySelector('.btn-atm').addEventListener('click', () => {
      insertCardForUser(u);
    });

    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete customer "${u.user_name}" and all their ATM records from Supabase?`)) {
        try {
          await window.supabaseService.deleteUser(u.id);
          showToast('Account Deleted', `Customer ${u.user_name} removed.`, 'info');
          if (State.activeUser && State.activeUser.id === u.id) {
            ejectCard();
          }
          await loadAllData();
        } catch (err) {
          showToast('Delete Failed', err.message, 'error');
        }
      }
    });

    container.appendChild(card);
  });
}

// ==========================================================================
// 9. TRANSACTIONS TAB & AUDIT LEDGER
// ==========================================================================

function renderTransactionsTable() {
  const tbody = document.getElementById('txTableBody');
  const search = (document.getElementById('txSearchInput')?.value || '').toLowerCase().trim();
  if (!tbody) return;

  const userMap = {};
  State.users.forEach(u => {
    userMap[u.id] = u;
  });

  const filtered = State.transactions.filter(tx => {
    const type = (tx.type || '').toLowerCase();
    
    // Chip filter
    if (State.activeFilter === 'deposit' && !['deposit', 'credit', 'transfer_in'].includes(type)) return false;
    if (State.activeFilter === 'withdraw' && !['withdraw', 'withdrawal', 'debit', 'transfer_out'].includes(type)) return false;
    if (State.activeFilter === 'transfer' && !type.includes('transfer')) return false;

    // Search query
    if (search) {
      const u = userMap[tx.user_id];
      const uName = u ? u.user_name.toLowerCase() : '';
      const uAcc = u ? String(u.account_number) : '';
      const loc = (tx.location || '').toLowerCase();
      const id = String(tx.log_id);
      return uName.includes(search) || uAcc.includes(search) || loc.includes(search) || id.includes(search) || type.includes(search);
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">No transaction logs recorded yet in Supabase.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(tx => {
    const u = userMap[tx.user_id];
    const type = (tx.type || 'deposit').toLowerCase();
    const isCredit = ['deposit', 'transfer_in', 'credit'].includes(type);
    const badgeClass = isCredit ? 'deposit' : (type.includes('transfer') ? 'transfer' : 'withdraw');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-weight: 600; color: var(--accent-cyan);">#${tx.log_id}</td>
      <td style="font-size: 0.82rem; color: var(--text-secondary);">${formatDate(tx.created_at)}</td>
      <td><strong>${escapeHtml(u ? u.user_name : `User ID: ${tx.user_id}`)}</strong></td>
      <td style="font-family: var(--font-mono);">${escapeHtml(u ? String(u.account_number) : 'N/A')}</td>
      <td><span class="tx-type-badge ${badgeClass}">${escapeHtml(type.toUpperCase())}</span></td>
      <td class="amount-cell ${isCredit ? 'positive' : 'negative'}">
        ${isCredit ? '+' : '-'}${formatCurrency(tx.amount)}
      </td>
      <td style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(tx.location || 'ATM Terminal')}</td>
      <td>
        <button class="user-action-btn btn-tx-receipt" style="display: inline-flex; padding: 0.3rem 0.6rem; font-size: 0.75rem;" title="View Receipt">
          📜 Receipt
        </button>
      </td>
    `;

    tr.querySelector('.btn-tx-receipt').addEventListener('click', () => {
      setReceiptData({
        log_id: tx.log_id,
        created_at: tx.created_at,
        user_name: u ? u.user_name : 'Valued Customer',
        account_number: u ? u.account_number : '1234',
        type: type.toUpperCase(),
        amount: tx.amount,
        location: tx.location || 'Apex ATM',
        balance: u ? (State.balances[u.id] || 0) : 0
      });
      openReceiptModal();
    });

    tbody.appendChild(tr);
  });
}

// ==========================================================================
// 10. TAB NAVIGATION & KEYPAD WIRING
// ==========================================================================

function activateTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === tabId);
  });
}

function setupKeypad() {
  const keypad = document.querySelector('.keypad-grid');
  if (!keypad) return;

  // Handle digit / value buttons
  keypad.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-btn');
    if (!btn) return;

    sfx.beep(1100, 0.04);
    const val = btn.getAttribute('data-val');

    // Find currently active input in ATM screen
    const activeScreen = document.querySelector('.screen-state.active');
    const input = activeScreen ? activeScreen.querySelector('input[type="number"]') : null;

    if (val !== null && input) {
      input.value = (input.value || '') + val;
    }
  });

  // Action buttons
  document.getElementById('keypadCancelBtn')?.addEventListener('click', () => {
    sfx.error();
    if (State.activeUser) {
      switchAtmScreenState('atmStateMenu');
    } else {
      switchAtmScreenState('atmStateWelcome');
    }
  });

  document.getElementById('keypadClearBtn')?.addEventListener('click', () => {
    sfx.beep(800, 0.05);
    const activeScreen = document.querySelector('.screen-state.active');
    const input = activeScreen ? activeScreen.querySelector('input') : null;
    if (input) input.value = '';
  });

  document.getElementById('keypadBackBtn')?.addEventListener('click', () => {
    sfx.beep(950, 0.04);
    const activeScreen = document.querySelector('.screen-state.active');
    const input = activeScreen ? activeScreen.querySelector('input') : null;
    if (input) input.value = input.value.slice(0, -1);
  });

  document.getElementById('keypadEnterBtn')?.addEventListener('click', () => {
    sfx.beep(1400, 0.08);
    const activeScreen = document.querySelector('.screen-state.active');
    if (!activeScreen) return;

    if (activeScreen.id === 'atmStateDeposit') {
      executeAtmDeposit();
    } else if (activeScreen.id === 'atmStateWithdraw') {
      executeAtmWithdrawal();
    } else if (activeScreen.id === 'atmStateTransfer') {
      executeAtmTransfer();
    } else if (activeScreen.id === 'atmStateWelcome') {
      const select = document.getElementById('atmUserSelect');
      const u = State.users.find(x => x.id === Number(select.value));
      if (u) insertCardForUser(u);
    }
  });
}

function setupFunctionKeys() {
  // F1: Fast Cash ($100) or Menu Option
  document.getElementById('fKey1')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') executeFastCash();
  });

  // F2: Custom Withdraw
  document.getElementById('fKey2')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') switchAtmScreenState('atmStateWithdraw');
  });

  // F3: Balance Inquiry
  document.getElementById('fKey3')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') switchAtmScreenState('atmStateBalance');
  });

  // F4: Cash Deposit
  document.getElementById('fKey4')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') switchAtmScreenState('atmStateDeposit');
  });

  // F5: Wire Transfer
  document.getElementById('fKey5')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') switchAtmScreenState('atmStateTransfer');
  });

  // F6: Eject / Exit
  document.getElementById('fKey6')?.addEventListener('click', () => {
    sfx.beep(1000, 0.05);
    const active = document.querySelector('.screen-state.active');
    if (active && active.id === 'atmStateMenu') ejectCard();
    else switchAtmScreenState('atmStateMenu');
  });
}

// ==========================================================================
// 11. EVENT LISTENERS & INITIALIZATION
// ==========================================================================

function attachEvents() {
  // Navigation tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.beep(900, 0.03);
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  // Sound toggle
  document.getElementById('soundToggleBtn')?.addEventListener('click', () => {
    State.soundEnabled = !State.soundEnabled;
    const icon = document.getElementById('soundIcon');
    if (icon) icon.textContent = State.soundEnabled ? '🔊' : '🔇';
    showToast('Sound Effects', State.soundEnabled ? 'Audio feedback enabled' : 'Muted', 'info');
  });

  // Manual refresh button
  document.getElementById('refreshAllBtn')?.addEventListener('click', () => {
    sfx.beep(1200, 0.05);
    loadAllData();
  });

  // Card slot click
  document.getElementById('cardSlotAperture')?.addEventListener('click', () => {
    if (State.activeUser) {
      ejectCard();
    } else {
      const select = document.getElementById('atmUserSelect');
      if (select && select.value) {
        const u = State.users.find(x => x.id === Number(select.value));
        if (u) insertCardForUser(u);
      } else if (State.users.length) {
        insertCardForUser(State.users[0]);
      } else {
        showToast('No Users', 'Please register a customer first.', 'warning');
      }
    }
  });

  // Take dispensed cash bill
  document.getElementById('dispensedCashBill')?.addEventListener('click', () => {
    sfx.success();
    const bill = document.getElementById('dispensedCashBill');
    if (bill) bill.classList.remove('active');
    showToast('Cash Collected', 'Thank you! Take your cash and receipt.', 'success');
  });

  // ATM Welcome Screen Insert Button
  document.getElementById('atmInsertCardBtn')?.addEventListener('click', () => {
    const select = document.getElementById('atmUserSelect');
    const u = State.users.find(x => x.id === Number(select.value));
    if (u) {
      insertCardForUser(u);
    } else {
      sfx.error();
      showToast('Select Account', 'Please choose an account from the dropdown or side panel.', 'warning');
    }
  });

  // Menu Screen Buttons
  document.getElementById('menuOptFastCash')?.addEventListener('click', executeFastCash);
  document.getElementById('menuOptDeposit')?.addEventListener('click', () => switchAtmScreenState('atmStateDeposit'));
  document.getElementById('menuOptWithdraw')?.addEventListener('click', () => switchAtmScreenState('atmStateWithdraw'));
  document.getElementById('menuOptTransfer')?.addEventListener('click', () => switchAtmScreenState('atmStateTransfer'));
  document.getElementById('menuOptBalance')?.addEventListener('click', () => switchAtmScreenState('atmStateBalance'));
  document.getElementById('menuOptEject')?.addEventListener('click', ejectCard);

  // Quick Amount chips (Deposit & Withdraw)
  document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      sfx.beep(1000, 0.04);
      const amt = chip.getAttribute('data-amt');
      const activeScreen = document.querySelector('.screen-state.active');
      const input = activeScreen ? activeScreen.querySelector('input[type="number"]') : null;
      if (input) input.value = amt;
    });
  });

  // Deposit Actions
  document.getElementById('atmSubmitDepositBtn')?.addEventListener('click', executeAtmDeposit);
  document.getElementById('atmCancelDepositBtn')?.addEventListener('click', () => switchAtmScreenState('atmStateMenu'));

  // Withdraw Actions
  document.getElementById('atmSubmitWithdrawBtn')?.addEventListener('click', executeAtmWithdrawal);
  document.getElementById('atmCancelWithdrawBtn')?.addEventListener('click', () => switchAtmScreenState('atmStateMenu'));

  // Transfer Actions
  document.getElementById('atmSubmitTransferBtn')?.addEventListener('click', executeAtmTransfer);
  document.getElementById('atmCancelTransferBtn')?.addEventListener('click', () => switchAtmScreenState('atmStateMenu'));

  // Balance Inquiry Actions
  document.getElementById('atmPrintReceiptBtn')?.addEventListener('click', () => {
    sfx.beep(1100, 0.05);
    openReceiptModal();
  });
  document.getElementById('atmBackToMenuBtn')?.addEventListener('click', () => switchAtmScreenState('atmStateMenu'));

  // Processing Done Button
  document.getElementById('processingDoneBtn')?.addEventListener('click', () => {
    switchAtmScreenState('atmStateMenu');
  });

  // Quick print receipt from hardware deck
  document.getElementById('quickPrintReceiptBtn')?.addEventListener('click', openReceiptModal);

  // Close Receipt Modal
  document.getElementById('closeReceiptModalBtn')?.addEventListener('click', () => {
    document.getElementById('receiptModal')?.classList.remove('active');
  });
  document.getElementById('receiptModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'receiptModal') e.target.classList.remove('active');
  });
  document.getElementById('printReceiptDirectBtn')?.addEventListener('click', () => {
    window.print();
  });

  // Search input listeners
  document.getElementById('userSearchInput')?.addEventListener('input', renderUsersGrid);
  document.getElementById('txSearchInput')?.addEventListener('input', renderTransactionsTable);

  // Filter chips in Ledger
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.activeFilter = chip.getAttribute('data-filter');
      renderTransactionsTable();
    });
  });

  // Export CSV
  document.getElementById('exportTxCsvBtn')?.addEventListener('click', () => {
    exportTransactionsCsv();
  });

  // New User Modal open/close
  const newUserModal = document.getElementById('newUserModal');
  const openModal = () => {
    // Generate fresh random 6-digit account number
    document.getElementById('newUserAccount').value = Math.floor(100000 + Math.random() * 900000);
    document.getElementById('newUserName').value = '';
    document.getElementById('newUserLocation').value = 'Main Branch';
    document.getElementById('newUserInitialDeposit').value = 100;
    newUserModal.classList.add('active');
    document.getElementById('newUserName').focus();
  };

  document.getElementById('openNewUserModalBtn')?.addEventListener('click', openModal);
  document.getElementById('sideNewUserBtn')?.addEventListener('click', openModal);
  document.getElementById('closeNewUserModalBtn')?.addEventListener('click', () => newUserModal.classList.remove('active'));
  document.getElementById('cancelNewUserModalBtn')?.addEventListener('click', () => newUserModal.classList.remove('active'));
  document.getElementById('generateAccNumBtn')?.addEventListener('click', () => {
    sfx.beep(1200, 0.04);
    document.getElementById('newUserAccount').value = Math.floor(100000 + Math.random() * 900000);
  });

  // New User Form Submit
  document.getElementById('newUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newUserName').value;
    const acc = document.getElementById('newUserAccount').value;
    const loc = document.getElementById('newUserLocation').value;
    const initDep = Number(document.getElementById('newUserInitialDeposit').value);

    try {
      const user = await window.supabaseService.createUser({
        user_name: name,
        account_number: acc,
        location: loc
      });

      // If initial deposit > 0, create corresponding ATM transaction
      if (initDep > 0) {
        await window.supabaseService.createTransaction({
          user_id: user.id,
          type: 'deposit',
          amount: initDep,
          location: `${loc || 'Branch'} (Opening Deposit)`
        });
      }

      sfx.success();
      showToast('Account Created', `Customer ${user.user_name} registered successfully in Supabase!`, 'success');
      newUserModal.classList.remove('active');
      await loadAllData();

      // Automatically offer to insert this new card into ATM
      insertCardForUser(user);
    } catch (err) {
      sfx.error();
      showToast('Registration Failed', err.message, 'error');
    }
  });

  // Quick Teller Form Submit
  const tellerOpType = document.getElementById('tellerOpType');
  const tellerRecipientGroup = document.getElementById('tellerRecipientGroup');
  tellerOpType?.addEventListener('change', () => {
    if (tellerRecipientGroup) {
      tellerRecipientGroup.style.display = tellerOpType.value === 'transfer' ? 'flex' : 'none';
    }
  });

  document.getElementById('tellerDirectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = Number(document.getElementById('tellerUserSelect').value);
    const op = document.getElementById('tellerOpType').value;
    const amt = Number(document.getElementById('tellerAmountInput').value);
    const loc = document.getElementById('tellerLocationInput').value;
    const recipId = Number(document.getElementById('tellerRecipientSelect').value);

    if (!userId) {
      showToast('Select Account', 'Please choose customer account.', 'warning');
      return;
    }
    if (!amt || amt <= 0) {
      showToast('Invalid Amount', 'Please specify a valid amount.', 'warning');
      return;
    }

    try {
      const u = State.users.find(x => x.id === userId);
      const currentBal = State.balances[userId] || 0;

      if ((op === 'withdraw' || op === 'transfer') && amt > currentBal) {
        sfx.error();
        showToast('Insufficient Funds', `Customer balance is ${formatCurrency(currentBal)}. Cannot perform ${op}.`, 'error');
        return;
      }

      if (op === 'transfer') {
        if (!recipId || recipId === userId) {
          showToast('Invalid Beneficiary', 'Please select a distinct beneficiary account.', 'warning');
          return;
        }
        const recip = State.users.find(x => x.id === recipId);
        await window.supabaseService.createTransaction({
          user_id: userId,
          type: 'transfer_out',
          amount: amt,
          location: loc || 'Teller Counter'
        });
        await window.supabaseService.createTransaction({
          user_id: recipId,
          type: 'transfer_in',
          amount: amt,
          location: loc || 'Teller Counter'
        });
        showToast('Teller Transfer Complete', `Transferred ${formatCurrency(amt)} from ${u.user_name} to ${recip.user_name}.`, 'success');
      } else {
        await window.supabaseService.createTransaction({
          user_id: userId,
          type: op,
          amount: amt,
          location: loc || 'Teller Counter'
        });
        showToast('Operation Successful', `Recorded ${op.toUpperCase()} of ${formatCurrency(amt)} for ${u.user_name}.`, 'success');
      }

      sfx.success();
      document.getElementById('tellerAmountInput').value = '';
      await loadAllData();
    } catch (err) {
      sfx.error();
      showToast('Teller Operation Error', err.message, 'error');
    }
  });

  // Live Screen Clock
  setInterval(() => {
    const clockEl = document.getElementById('screenLiveClock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    }
  }, 1000);

  // Background sync polling every 25 seconds
  setInterval(() => {
    loadAllData();
  }, 25000);
}

// ==========================================================================
// 12. CSV EXPORT UTILITY
// ==========================================================================
function exportTransactionsCsv() {
  if (!State.transactions.length) {
    showToast('No Data', 'No transactions to export.', 'info');
    return;
  }

  const userMap = {};
  State.users.forEach(u => { userMap[u.id] = u; });

  const headers = ['Log ID', 'Created At', 'User ID', 'Customer Name', 'Account Number', 'Type', 'Amount', 'Location'];
  const rows = State.transactions.map(tx => {
    const u = userMap[tx.user_id];
    return [
      tx.log_id,
      `"${tx.created_at || ''}"`,
      tx.user_id,
      `"${(u ? u.user_name : '').replace(/"/g, '""')}"`,
      u ? u.account_number : '',
      `"${tx.type}"`,
      tx.amount,
      `"${(tx.location || '').replace(/"/g, '""')}"`
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `apex_atm_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Export Complete', 'Downloaded transactions CSV.', 'success');
}

// ==========================================================================
// 13. BOOTSTRAP APPLICATION
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupKeypad();
  setupFunctionKeys();
  attachEvents();
  loadAllData();
});
