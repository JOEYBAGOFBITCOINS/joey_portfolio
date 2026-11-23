import {TIERS,createInitialState,validateState,getAccounting,currentTier,formatUnits,parseUSDToCents,startPurchase,advancePurchase,cancelPurchase,startRedemption,advanceRedemption,cancelRedemption} from './demo-engine.js';
import {tierEmblem} from './tier-emblems.js';
const storageKey='b7-financial-demo-v1';
let state=createInitialState();
let storageAvailable=true;
try{const saved=JSON.parse(localStorage.getItem(storageKey));if(validateState(saved).valid)state=saved;else localStorage.setItem(storageKey,JSON.stringify(state));}catch{storageAvailable=false;}
const $=s=>document.querySelector(s);
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const tokens=u=>formatUnits(u);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const closed=s=>['completed','cancelled','failed'].includes(s);
const eventNames={purchase_authorized:'Purchase authorized',gold_allocated:'Gold allocation confirmed',tokens_minted:'B7 issued',purchase_cancelled:'Purchase cancelled',purchase_failed:'Purchase reversed',redemption_requested:'Redemption requested',delivery_confirmed:'Delivery confirmed',tokens_burned:'Redemption settled',redemption_cancelled:'Redemption cancelled',redemption_failed:'Redemption reversed'};
const memoryOnlyNotice=' Changes are not saved or synced and will be lost on reload.';
function persist(){if(!storageAvailable)return;try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{storageAvailable=false;}}
function announce(text){$('#notice').textContent=text;}
function commit(next,message){state=next;persist();render();announce(message+(storageAvailable?'':memoryOnlyNotice));}
async function transact(update,message){
 const accountVersion=state.createdAt;
 const run=()=>{
  let latest;
  if(storageAvailable)try{latest=JSON.parse(localStorage.getItem(storageKey));}catch{storageAvailable=false;}
  if(validateState(latest).valid){state=latest;render();if(latest.createdAt!==accountVersion)throw new Error('Demo account reset in another tab. Review the balance and retry.');}
  commit(update(state),message);
 };
 if(navigator.locks)await navigator.locks.request(storageKey,run);else run();
}
function showPanel(name){
 for(const el of document.querySelectorAll('[role=tabpanel]'))el.hidden=el.id!=='panel-'+name;
 for(const tab of document.querySelectorAll('[role=tab]')){const active=tab.dataset.panel===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
}
function route(){
 const key=location.hash.slice(1)||'home';
 if(key==='main'){$('#main').focus();return;}
 const home=['home','gold','ownership','custody','custody-research','membership','origin'].includes(key);
 const build=key==='build';
 $('#home-view').hidden=!home;$('#dashboard-view').hidden=home||build;$('#build-view').hidden=!build;
 if(!home&&!build)showPanel(['buy','redeem','reserves','tiers'].includes(key)?key:'overview');
 if(home&&key!=='home')requestAnimationFrame(()=>document.getElementById(key)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
 else window.scrollTo({top:0,behavior:'instant'});
 document.title=build?'The Build | B7 Financial':home?'B7 Financial | Digital gold. Tangible ownership.':'Your account | B7 Financial';
}
function tierCards(){
 const tier=currentTier(state);
 $('#tier-preview').innerHTML=TIERS.map(t=>`<a class="tier-peek" href="#tiers">${tierEmblem(t.level)}<span>${esc(t.name)}</span><small>${tokens(t.minimumUnits)}+ B7</small></a>`).join('');
 $('#tier-grid').innerHTML=TIERS.map(t=>`<article class="tier-card ${tier.level===t.level?'current':''}">${tierEmblem(t.level,'account')}${tier.level===t.level?'<b class="tier-current">YOUR LEVEL</b>':''}<h3>${esc(t.name)}</h3><p>${tokens(t.minimumUnits)}+ B7 held</p><ul>${t.benefits.map(b=>`<li>${esc(b)}</li>`).join('')}</ul></article>`).join('');
}
function renderProgress(kind){
 const orders=kind==='purchase'?state.purchases:state.redemptions;
 const host=kind==='purchase'?$('#purchase-progress'):$('#redemption-progress');
 if(!orders.length){host.innerHTML='<div class="empty-state"><span class="empty-symbol">↗</span>Start a demo order to see its progress.</div>';return;}
 const order=[...orders].reverse().find(o=>!closed(o.status))||orders.at(-1);
 const purchase=kind==='purchase';
 const steps=purchase?['Demo payment authorized','Demo gold allocated','Demo B7 issued']:['B7 held for redemption','Demo delivery confirmed','B7 removed from supply'];
 const statuses=purchase?['payment_authorized','gold_allocated','completed']:['tokens_held','delivery_confirmed','completed'];
 const pos=statuses.indexOf(order.status);
 const nextLabel=purchase?(pos===0?'Confirm demo allocation':'Issue demo B7'):(pos===0?'Confirm demo delivery':'Complete demo redemption');
 const canCancel=purchase?!closed(order.status):order.status==='tokens_held';
 host.innerHTML=`<div class="order-title"><span>${tokens(order.quantityUnits)} B7</span><small>${esc(order.id)}</small></div><ol class="progress-steps">${steps.map((label,i)=>`<li class="${i<=pos?'complete':''}"><span class="step-dot">${i<=pos?'✓':i+1}</span><span>${label}</span></li>`).join('')}</ol>${closed(order.status)?`<p class="order-hint">${order.status==='completed'?'Demo account and reserves updated.':'Demo ended; balance restored.'}</p>`:`<div class="order-actions"><button class="button primary" data-advance="${kind}" data-id="${esc(order.id)}" data-status="${esc(order.status)}">${nextLabel} <span>→</span></button>${canCancel?`<button class="text-button" data-cancel="${kind}" data-id="${esc(order.id)}">Cancel request</button>`:''}</div><p class="order-hint">Advance each step of the simulation.</p>`}`;
}
function render(){
 const accounting=getAccounting(state);const tier=currentTier(state);
 $('#balance-value').textContent=tokens(state.walletUnits);
 $('#balance-equivalent').textContent=`${tokens(state.walletUnits)} simulated grams${state.heldTokenUnits?` · ${tokens(state.heldTokenUnits)} B7 held for redemption`:''}`;
 $('#buying-power').textContent=money(state.availableUSDCents);$('#current-tier').textContent=tier.name;
 $('#reserve-coverage').textContent=Math.round(accounting.coverageRatio*100)+'%';
 $('#redeem-available').textContent=tokens(state.walletUnits)+' B7';
 $('#activity-list').innerHTML=state.ledger.length?[...state.ledger].reverse().slice(0,12).map(e=>{const o=state.purchases.find(x=>x.id===e.orderId)||state.redemptions.find(x=>x.id===e.orderId);return `<div class="activity"><span class="activity-icon">${e.action==='tokens_minted'?'+':e.action==='tokens_burned'?'−':'↗'}</span><div><b>${esc(eventNames[e.action]||e.action)}</b><small>${esc(e.orderId)} · EVENT ${String(e.sequence).padStart(2,'0')}</small></div><strong>${o?tokens(o.quantityUnits):''} <small>B7</small></strong></div>`;}).join(''):'<div class="empty-state">Demo activity appears after your first order.</div>';
 const reserves=[['CONFIRMED BACKING',state.reserveUnits,'Simulated reserve, in grams'],['ISSUED B7',state.totalSupplyUnits,'Includes B7 held for redemption'],['AWAITING ISSUANCE',state.allocatedGoldUnits,'Allocated gold, in grams'],['HELD FOR REDEMPTION',state.heldTokenUnits,'Included in issued supply']];
 $('#reserve-stats').innerHTML=reserves.map(([label,units,desc])=>`<article><p class="eyebrow">${label}</p><b>${tokens(units)}</b><span>${desc}</span></article>`).join('');
 $('#equation-gold').textContent=tokens(state.reserveUnits)+' g';$('#equation-tokens').textContent=tokens(state.totalSupplyUnits)+' g';
 tierCards();renderProgress('purchase');renderProgress('redemption');updateQuote();
}
function updateQuote(){try{$('#buy-quote').textContent=tokens(parseUSDToCents($('#buy-amount').value)*100)+' B7';}catch{$('#buy-quote').textContent='Enter an amount';}}
$('#buy-amount').addEventListener('input',updateQuote);
$('#buy-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#buy-error').textContent='';
 const amount=$('#buy-amount').value;
 try{await transact(current=>{if(current.purchases.some(o=>!closed(o.status)))throw new Error('Complete or cancel the pending purchase first.');return startPurchase(current,amount,{idempotencyKey:'purchase-'+current.nextSequence});},'Confirm allocation to continue your demo purchase.');$('#purchase-progress').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}catch(error){$('#buy-error').textContent=error.message;}
});
$('#redeem-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#redeem-error').textContent='';
 const amount=$('#redeem-amount').value;
 try{await transact(current=>{if(current.redemptions.some(o=>!closed(o.status)))throw new Error('Complete or cancel the pending redemption first.');return startRedemption(current,amount,{idempotencyKey:'redemption-'+current.nextSequence});},'B7 held for demo redemption.');$('#redemption-progress').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}catch(error){$('#redeem-error').textContent=error.message;}
});
document.addEventListener('click',async e=>{
 const tab=e.target.closest('[data-panel]');if(tab){location.hash=tab.dataset.panel==='overview'?'dashboard':tab.dataset.panel;return;}
 const quick=e.target.closest('[data-amount]');if(quick){$('#buy-amount').value=quick.dataset.amount;updateQuote();return;}
 const advance=e.target.closest('[data-advance]');const cancel=e.target.closest('[data-cancel]');
 if(advance||cancel){if(e.detail>1)return;const b=advance||cancel;const id=b.dataset.id,expectedStatus=b.dataset.status;try{const purchase=(b.dataset.advance||b.dataset.cancel)==='purchase';const fn=advance?(purchase?advancePurchase:advanceRedemption):(purchase?cancelPurchase:cancelRedemption);await transact(current=>fn(current,id,{expectedStatus}),advance?'Demo record updated.':'Demo request cancelled; balance restored.');}catch(error){announce(error.message);}}
});
$('.workspace-tabs').addEventListener('keydown',e=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...document.querySelectorAll('[role=tab]')];const i=tabs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();
});
$('#download-ledger').addEventListener('click',()=>{
 const report={project:'B7 Financial portfolio concept',simulation:true,notice:'All balances, prices, and events are simulated. This is not a financial statement or a blockchain transaction record.',state};
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='B7-demo-record.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);announce('Demo record exported.');
});
$('#reset-demo').addEventListener('click',async()=>{if(window.confirm('Reset your demo account and activity?'))try{await transact(()=>createInitialState(),'Demo account reset.');}catch(error){announce(error.message);}});
window.addEventListener('storage',e=>{
 if(!storageAvailable||e.key!==storageKey)return;
 // A queued event can describe an older write than this tab has already read.
 // Always load the current stored snapshot instead of replaying e.newValue.
 try{const next=JSON.parse(localStorage.getItem(storageKey));if(validateState(next).valid){state=next;render();announce('Demo account updated in another tab.');}}
 catch{storageAvailable=false;announce(memoryOnlyNotice.trim());}
});
window.addEventListener('hashchange',route);
render();route();
if(!storageAvailable)announce(memoryOnlyNotice.trim());
