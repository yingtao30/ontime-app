'use strict';

// ── Constants ──────────────────────────────
const PREP_TIMES = { quick:15, normal:35, fancy:60, special:90 };
const PREP_LABELS = { quick:'🏃 빠르게', normal:'😊 보통', fancy:'✨꾸미기', special:'🎩 특별한 날' };
const BUFFER = 5; // minutes

// ── State ──────────────────────────────────
let appointments = JSON.parse(localStorage.getItem('ontime_appts') || '[]');
let currentView = 'home';
let timerApptId = null;
let timerInterval = null;
let homeBannerInterval = null;
let currentStep = 1;
let travelMode = 'transit';
let selectedStyle = null;
let feedbackApptId = null;
let detailApptId = null;

// Draft for add wizard
let draft = {};

// ── Persistence ────────────────────────────
function save() {
  localStorage.setItem('ontime_appts', JSON.stringify(appointments));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Utils ───────────────────────────────────
function fmt(date) {
  return new Date(date).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:true});
}
function fmtDate(date) {
  return new Date(date).toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});
}
function minsToHHMM(mins) {
  const h = Math.floor(Math.abs(mins)/60), m = Math.abs(mins)%60;
  if (h>0) return `${h}시간 ${m>0?m+'분':''}`.trim();
  return `${m}분`;
}
function diffMs(a, b) { return new Date(a)-new Date(b); }
function pad(n) { return String(n).padStart(2,'0'); }
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const tot = Math.floor(ms/1000);
  const h = Math.floor(tot/3600), m = Math.floor((tot%3600)/60), s = tot%60;
  if (h>0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function showToast(msg, dur=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add('hidden'), dur);
}

// ── View Router ─────────────────────────────
function showView(name) {
  currentView = name;

  // 1. Show/hide views FIRST (before render calls)
  document.querySelectorAll('.view').forEach(el => {
    const isTarget = el.id === 'view-' + name;
    el.style.display = isTarget ? 'flex' : 'none';
    el.classList.toggle('active', isTarget);
  });

  // 2. Bottom nav
  document.getElementById('bottom-nav').style.display = name === 'timer' ? 'none' : '';

  // 3. Nav active state
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  // 4. Render content
  if (name === 'home')     renderHome();
  if (name === 'insights') renderInsights();
  if (name === 'add')      startAdd();
  if (name === 'timer')    renderTimer();
}

// ── Home View ───────────────────────────────
function renderHome() {
  const now = new Date();
  // greeting
  const h = now.getHours();
  const greet = h<12?'좋은 아침이에요 ☀️':h<17?'안녕하세요 👋':h<21?'좋은 저녁이에요 🌆':'좋은 밤이에요 🌙';
  document.getElementById('greeting').textContent = greet;
  document.getElementById('today-date').textContent = fmtDate(now);

  // categorise
  const upcoming = appointments.filter(a=>!a.feedback && new Date(a.appointmentTime)>now);
  const needFb   = appointments.filter(a=>!a.feedback && new Date(a.appointmentTime)<=now);
  const past     = appointments.filter(a=>a.feedback).slice(-5).reverse();

  // active banner
  const active = upcoming.find(a=>new Date(a.prepStartTime)<=now);
  const banner = document.getElementById('active-banner');
  if (active) {
    banner.classList.remove('hidden');
    document.getElementById('ab-name').textContent = active.name;
    document.getElementById('btn-goto-timer').onclick = ()=>{
      timerApptId = active.id;
      showView('timer');
    };
    if (homeBannerInterval) clearInterval(homeBannerInterval);
    homeBannerInterval = setInterval(()=>updateBanner(active), 1000);
    updateBanner(active);
  } else {
    banner.classList.add('hidden');
    if (homeBannerInterval) clearInterval(homeBannerInterval);
  }

  // feedback section
  const secFb = document.getElementById('sec-feedback');
  const listFb = document.getElementById('list-feedback');
  if (needFb.length) {
    secFb.classList.remove('hidden');
    listFb.innerHTML = needFb.map(apptCard).join('');
  } else {
    secFb.classList.add('hidden');
  }

  // upcoming
  const listUp = document.getElementById('list-upcoming');
  const empty  = document.getElementById('empty-state');
  if (upcoming.length) {
    listUp.innerHTML = upcoming.map(apptCard).join('');
    empty.classList.add('hidden');
  } else {
    listUp.innerHTML = '';
    empty.classList.remove('hidden');
  }

  // past
  const secPast = document.getElementById('sec-past');
  const listPast = document.getElementById('list-past');
  if (past.length) {
    secPast.classList.remove('hidden');
    listPast.innerHTML = past.map(apptCard).join('');
  } else {
    secPast.classList.add('hidden');
  }

  // card click handlers
  document.querySelectorAll('.appt-card').forEach(card=>{
    card.onclick = ()=>openDetail(card.dataset.id);
  });
}

function updateBanner(a) {
  const now = new Date();
  const apptTime = new Date(a.appointmentTime);
  const departTime = new Date(a.departureTime);
  const prepStart = new Date(a.prepStartTime);

  let status, ms;
  if (now < prepStart) {
    status='준비 시작 전'; ms=prepStart-now;
  } else if (now < departTime) {
    status='준비 중 🏃'; ms=departTime-now;
  } else if (now < apptTime) {
    status='이동 중 🚇'; ms=apptTime-now;
  } else {
    status='약속 시간 지남'; ms=0;
  }
  document.getElementById('ab-status').textContent = status;
  document.getElementById('ab-countdown').textContent = fmtCountdown(ms);
}

function apptCard(a) {
  const now = new Date();
  const apptTime = new Date(a.appointmentTime);
  const needFb = !a.feedback && apptTime<=now;
  let dotClass='upcoming', badgeClass='badge-upcoming', badgeText='예정';

  if (needFb) { dotClass='feedback'; badgeClass='badge-feedback'; badgeText='피드백'; }
  else if (a.feedback?.result==='ontime'||a.feedback?.result==='early') { dotClass='ontime'; badgeClass='badge-ontime'; badgeText='정시'; }
  else if (a.feedback?.result==='late') { dotClass='late'; badgeClass='badge-late'; badgeText='지각'; }
  else if (a.feedback?.result==='cancelled') { dotClass=''; badgeClass=''; badgeText='취소'; }

  const countdownText = !a.feedback && apptTime>now
    ? `${minsToHHMM(Math.round((apptTime-now)/60000))} 후` : '';

  return `<div class="appt-card" data-id="${a.id}">
    <div class="appt-dot ${dotClass}">${PREP_LABELS[a.prepStyle]?.slice(0,2)}</div>
    <div class="appt-info">
      <div class="appt-name">${a.name}</div>
      <div class="appt-meta">${fmtDate(apptTime)} · ${a.location}</div>
    </div>
    <div class="appt-right">
      <div class="appt-time">${fmt(apptTime)}</div>
      <div class="appt-countdown">${countdownText}</div>
      <span class="appt-badge ${badgeClass}">${badgeText}</span>
    </div>
  </div>`;
}

// ── Detail Modal ────────────────────────────
function openDetail(id) {
  const a = appointments.find(x=>x.id===id);
  if (!a) return;
  detailApptId = id;
  const now = new Date();
  const apptTime = new Date(a.appointmentTime);
  const needFb = !a.feedback && apptTime<=now;
  const isUpcoming = !a.feedback && apptTime>now;

  document.getElementById('detail-content').innerHTML = `
    <h3 class="modal-title">${a.name}</h3>
    <p class="modal-sub">${fmtDate(apptTime)} · ${fmt(apptTime)}</p>
    <div class="summary-card">
      <div class="summary-row"><span class="sr-label">장소</span><span class="sr-val">${a.location}</span></div>
      <div class="summary-row"><span class="sr-label">이동 수단</span><span class="sr-val">${a.travelMode==='transit'?'🚇 대중교통':a.travelMode==='car'?'🚗 자동차':'🚶 도보'}</span></div>
      <div class="summary-row"><span class="sr-label">이동 시간</span><span class="sr-val">${a.travelTime}분</span></div>
      <div class="summary-row"><span class="sr-label">준비 스타일</span><span class="sr-val">${PREP_LABELS[a.prepStyle]}</span></div>
      <div class="summary-row"><span class="sr-label">준비 시작</span><span class="sr-val">${fmt(a.prepStartTime)}</span></div>
      <div class="summary-row"><span class="sr-label">출발 시간</span><span class="sr-val">${fmt(a.departureTime)}</span></div>
      ${a.feedback ? `<div class="summary-row"><span class="sr-label">결과</span><span class="sr-val">${fbResultText(a.feedback)}</span></div>` : ''}
    </div>`;

  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';
  if (isUpcoming) {
    const timerBtn = document.createElement('button');
    timerBtn.className='btn btn-primary';
    timerBtn.textContent='⏱ 타이머 시작';
    timerBtn.onclick=()=>{
      timerApptId=id;
      closeModal('modal-detail');
      showView('timer');
    };
    actions.appendChild(timerBtn);
  }
  if (needFb) {
    const fbBtn = document.createElement('button');
    fbBtn.className='btn btn-primary';
    fbBtn.textContent='📝 피드백 남기기';
    fbBtn.onclick=()=>{ closeModal('modal-detail'); openFeedback(id); };
    actions.appendChild(fbBtn);
  }
  const delBtn = document.createElement('button');
  delBtn.className='btn btn-ghost btn-sm';
  delBtn.textContent='🗑 삭제';
  delBtn.onclick=()=>deleteAppt(id);
  actions.appendChild(delBtn);

  document.getElementById('modal-detail').classList.remove('hidden');
}

function fbResultText(fb) {
  if (!fb) return '';
  if (fb.result==='ontime') return '✅ 정시 도착';
  if (fb.result==='early') return `🎉 ${fb.minutesDiff}분 일찍 도착`;
  if (fb.result==='late') return `😅 ${fb.minutesDiff}분 지각`;
  return '❌ 취소';
}

function deleteAppt(id) {
  if (!confirm('이 약속을 삭제할까요?')) return;
  appointments = appointments.filter(a=>a.id!==id);
  save();
  closeModal('modal-detail');
  renderHome();
  showToast('약속이 삭제됐어요');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Add Wizard ──────────────────────────────
function startAdd() {
  draft = {};
  selectedStyle = null;
  travelMode = 'transit';
  goToStep(1);
  // set default date to today (local timezone)
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  document.getElementById('in-date').value = localDate;
  document.getElementById('in-time').value = '';
  document.getElementById('in-name').value = '';
  document.getElementById('in-location').value = '';
  document.getElementById('in-travel').value = 30;
  document.getElementById('travel-val').textContent = '30분';
  document.querySelectorAll('.prep-card').forEach(c=>c.classList.remove('selected'));
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode==='transit'));
}

function goToStep(n) {
  if (n===2 && !validateStep1()) return;
  if (n===3 && !validateStep2()) return;
  if (n===4 && !validateStep3()) return;

  currentStep = n;
  document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
  document.getElementById('step-'+n).classList.add('active');

  const titles = ['약속 정보','장소 & 이동','준비 스타일','최종 확인'];
  document.getElementById('add-step-title').textContent = titles[n-1];

  const dots = document.querySelectorAll('.dot');
  dots.forEach((d,i)=>d.classList.toggle('active',i<n));

  if (n===3) showAiRec();
  if (n===4) renderSummary();
}

function validateStep1() {
  const name = document.getElementById('in-name').value.trim();
  const date = document.getElementById('in-date').value;
  const time = document.getElementById('in-time').value;
  if (!name) { showToast('약속 이름을 입력해주세요'); return false; }
  if (!date || !time) { showToast('날짜와 시간을 선택해주세요'); return false; }
  // Parse as local time by adding seconds (avoids browser UTC ambiguity)
  const dt = new Date(date + 'T' + time + ':00');
  if (isNaN(dt.getTime())) { showToast('올바른 날짜/시간 형식을 확인해주세요'); return false; }
  // Allow up to 30 minutes in the past (user might take time filling the form)
  if (dt < new Date(Date.now() - 30 * 60 * 1000)) {
    showToast('너무 과거의 시간이에요. 다시 확인해주세요 ⏰'); return false;
  }
  draft.name = name;
  draft.appointmentTime = dt.toISOString();
  return true;
}

function validateStep2() {
  const loc = document.getElementById('in-location').value.trim();
  if (!loc) { showToast('장소를 입력해주세요'); return false; }
  draft.location = loc;
  draft.travelTime = parseInt(document.getElementById('in-travel').value);
  draft.travelMode = travelMode;
  return true;
}

function validateStep3() {
  if (!selectedStyle) { showToast('준비 스타일을 선택해주세요'); return false; }
  draft.prepStyle = selectedStyle;
  draft.prepTime = PREP_TIMES[selectedStyle];
  return true;
}

// AI Recommendation (rule-based)
function getAiRec(location, apptTime) {
  const loc = location.toLowerCase();
  const hour = new Date(apptTime).getHours();
  if (/클럽|나이트|파티|바bar/.test(loc)) return { style:'special', reason:`파티 분위기! 헤어·옷에 여유 있게 시간을 잡았어요.` };
  if (/다이닝|파인|호텔|루프탑/.test(loc)) return { style:'fancy', reason:`격식 있는 장소예요. 꾸미기 스타일을 추천드려요.` };
  if (/사무실|회의|비즈|미팅/.test(loc)) return { style:'normal', reason:`비즈니스 미팅이에요. 깔끔하게 보통 스타일로!` };
  if (/카페|점심|구내식당/.test(loc)) return { style:'quick', reason:`캐주얼한 만남이에요. 빠르게도 충분해요.` };
  if (hour >= 18) return { style:'normal', reason:`저녁 약속이에요. 보통 스타일을 추천드려요.` };
  return { style:'normal', reason:`장소와 시간대를 고려해 보통 스타일을 추천해요.` };
}

function showAiRec() {
  const loc = document.getElementById('in-location').value.trim();
  const dt  = draft.appointmentTime;
  if (!loc || !dt) return;
  const rec = getAiRec(loc, dt);
  document.getElementById('ai-rec-text').textContent = rec.reason;
  // highlight recommended card
  document.querySelectorAll('.prep-card').forEach(c=>{
    if (c.dataset.style===rec.style && !selectedStyle) {
      c.classList.add('selected');
      selectedStyle = rec.style;
    }
  });
}

function renderSummary() {
  const apptTime   = new Date(draft.appointmentTime);
  const departTime = new Date(apptTime - (draft.travelTime + BUFFER)*60000);
  const prepStart  = new Date(departTime - draft.prepTime*60000);
  draft.departureTime  = departTime.toISOString();
  draft.prepStartTime  = prepStart.toISOString();

  document.getElementById('summary-card').innerHTML = `
    <div class="summary-row"><span class="sr-label">약속 이름</span><span class="sr-val">${draft.name}</span></div>
    <div class="summary-row"><span class="sr-label">약속 시간</span><span class="sr-val">${fmtDate(apptTime)} ${fmt(apptTime)}</span></div>
    <div class="summary-row"><span class="sr-label">장소</span><span class="sr-val">${draft.location}</span></div>
    <div class="summary-row"><span class="sr-label">준비 스타일</span><span class="sr-val">${PREP_LABELS[draft.prepStyle]}</span></div>
    <div class="summary-row"><span class="sr-label">총 이동 시간</span><span class="sr-val">${draft.travelTime}분</span></div>`;

  document.getElementById('timeline-card').innerHTML = `
    <div class="timeline-title">📍 타임라인</div>
    <div class="tl-item"><div class="tl-dot tl-prep">🏃</div><div class="tl-info"><div class="tl-label">준비 시작</div><div class="tl-time">${fmt(prepStart)}</div></div></div>
    <div class="tl-item"><div class="tl-dot tl-depart">🚇</div><div class="tl-info"><div class="tl-label">출발</div><div class="tl-time">${fmt(departTime)}</div></div></div>
    <div class="tl-item"><div class="tl-dot tl-appt">✅</div><div class="tl-info"><div class="tl-label">약속</div><div class="tl-time">${fmt(apptTime)}</div></div></div>`;
}

function confirmAdd() {
  const appt = {
    id: genId(),
    ...draft,
    status: 'upcoming',
    feedback: null,
    createdAt: new Date().toISOString()
  };
  appointments.push(appt);
  save();
  scheduleNotifications(appt);
  showToast('약속이 추가됐어요! 🎉');
  showView('home');
}

// ── Timer View ──────────────────────────────
function renderTimer() {
  if (!timerApptId) return; // view already shown; just do nothing
  const a = appointments.find(x => x.id === timerApptId);
  if (!a) return;
  document.getElementById('timer-appt-name').textContent = a.name;
  document.getElementById('tib-prep').textContent   = fmt(a.prepStartTime);
  document.getElementById('tib-depart').textContent = fmt(a.departureTime);
  document.getElementById('tib-appt').textContent   = fmt(a.appointmentTime);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => tickTimer(a), 1000);
  tickTimer(a);
}

function pct(remaining, total) { return total<=0?0:Math.max(0,Math.min(1,remaining/total)); }

function tickTimer(a) {
  const now=new Date(), prep=new Date(a.prepStartTime), dep=new Date(a.departureTime), appt=new Date(a.appointmentTime);
  const totalPrepMs=dep-prep, totalTransMs=appt-dep;
  let stage,ms,totalMs,ringClass,bgClass,sublabel;
  if (now<prep) {
    stage='⏰ 준비 전';ms=prep-now;totalMs=prep-now;ringClass='ring-purple';bgClass='prep';sublabel='준비 시작까지';
  } else if (now<dep) {
    const p=pct(dep-now,totalPrepMs);
    stage='🏃 준비 중';ms=dep-now;totalMs=totalPrepMs;
    ringClass=p>0.3?'ring-purple':p>0.1?'ring-yellow':'ring-red';
    bgClass=p>0.3?'prep':p>0.1?'warning':'danger';sublabel='출발까지';
  } else if (now<appt) {
    stage='🚇 이동 중';ms=appt-now;totalMs=totalTransMs;ringClass='ring-blue';bgClass='transit';sublabel='약속까지';
  } else {
    stage='✅ 도착!';ms=0;totalMs=1;ringClass='ring-green';bgClass='';sublabel='수고했어요';
    clearInterval(timerInterval);
    setTimeout(()=>{ if(currentView==='timer') openFeedback(a.id); },3000);
  }
  document.getElementById('timer-stage').textContent=stage;
  document.getElementById('timer-digits').textContent=ms>0?fmtCountdown(ms):'도착!';
  document.getElementById('timer-sublabel').textContent=sublabel;
  const CIRC=597, offset=ms>0?CIRC*(1-pct(ms,totalMs)):0;
  const ring=document.getElementById('ring-progress');
  ring.style.strokeDashoffset=offset;
  ring.className='ring-progress '+ringClass;
  const timerBg=document.getElementById('timer-bg'); if(timerBg) timerBg.className='timer-bg '+bgClass;
  renderMilestones(a,now);
}

function renderMilestones(a,now) {
  const prep=new Date(a.prepStartTime),dep=new Date(a.departureTime),appt=new Date(a.appointmentTime);
  const dep10=new Date(dep-10*60000);
  const ms=[{label:'준비 시작',t:prep},{label:'출발 10분 전',t:dep10},{label:'출발',t:dep},{label:'약속',t:appt}];
  document.getElementById('timer-milestones').innerHTML=ms.map(m=>{
    const done=now>=m.t, active=!done&&ms.find(x=>now<x.t)===m;
    return `<span class="milestone${done?' done':''}${active?' active':''}">${m.label} ${fmt(m.t)}</span>`;
  }).join('');
}

// ── Insights ────────────────────────────────
function renderInsights() {
  const withFb=appointments.filter(a=>a.feedback&&a.feedback.result!=='cancelled');
  const total=appointments.length;
  const ontime=withFb.filter(a=>a.feedback.result==='ontime'||a.feedback.result==='early').length;
  const late=withFb.filter(a=>a.feedback.result==='late');
  const avgLate=late.length>0?Math.round(late.reduce((s,a)=>s+(a.feedback.minutesDiff||0),0)/late.length):0;
  const onPct=withFb.length>0?Math.round(ontime/withFb.length*100):0;
  const streak=withFb.filter(a=>a.feedback.result==='ontime'||a.feedback.result==='early').length;
  const styleCounts={quick:0,normal:0,fancy:0,special:0};
  appointments.forEach(a=>{ if(a.prepStyle in styleCounts) styleCounts[a.prepStyle]++; });
  document.getElementById('insights-content').innerHTML=`
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">${total}</div><div class="stat-label">총 약속</div></div>
      <div class="stat-card"><div class="stat-val">${onPct}%</div><div class="stat-label">정시 도착률</div></div>
      <div class="stat-card"><div class="stat-val">${late.length}</div><div class="stat-label">지각 횟수</div></div>
      <div class="stat-card"><div class="stat-val">${streak}🔥</div><div class="stat-label">정시 도착 횟수</div></div>
    </div>
    ${avgLate>0?`<div class="insight-card"><div class="insight-title">⏱ 평균 지각 시간</div>
      <p style="font-size:28px;font-weight:800;background:var(--grad-r);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${avgLate}분</p>
      <p style="font-size:13px;color:var(--t2);margin-top:4px;">준비 시간을 ${avgLate}분 더 잡아보세요!</p></div>`:''}
    <div class="insight-card"><div class="insight-title">🎨 준비 스타일 분포</div>
      ${Object.entries(styleCounts).map(([k,v])=>`
        <div class="progress-bar-wrap">
          <span class="style-row-label" style="min-width:80px;font-size:13px">${PREP_LABELS[k]}</span>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${total>0?(v/total*100).toFixed(0):0}%"></div></div>
          <span class="progress-label">${v}회</span>
        </div>`).join('')}
    </div>
    ${withFb.length===0?`<div class="empty-state"><div class="empty-icon">📊</div><h3>아직 데이터가 없어요</h3><p>약속 후 피드백을 남기면 인사이트가 쌓여요</p></div>`:''}`;
}

// ── Feedback Modal ───────────────────────────
function openFeedback(id) {
  feedbackApptId=id;
  const a=appointments.find(x=>x.id===id);
  if (!a) return;
  document.getElementById('fb-appt-name').textContent=a.name;
  document.querySelectorAll('.fb-btn').forEach(b=>b.classList.remove('selected'));
  document.getElementById('fb-minutes-wrap').classList.add('hidden');
  document.getElementById('fb-minutes-input').value='';
  document.getElementById('modal-feedback').classList.remove('hidden');
}

function submitFeedback() {
  const result=document.querySelector('.fb-btn.selected')?.dataset.result;
  if (!result) { showToast('결과를 선택해주세요'); return; }
  const minVal=document.getElementById('fb-minutes-input').value;
  let minutesDiff=minVal?parseInt(minVal)||0:0;
  const idx=appointments.findIndex(a=>a.id===feedbackApptId);
  if (idx<0) return;
  appointments[idx].feedback={result,minutesDiff,submittedAt:new Date().toISOString()};
  save();
  closeModal('modal-feedback');
  showToast(result==='late'?'😅 기록됐어요. 다음엔 꼭 정시에!':'🎉 대단해요! 기록됐어요.');
  if (currentView==='timer') showView('home');
  else renderHome();
}

// ── Notifications ────────────────────────────
let swReg=null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try { swReg=await navigator.serviceWorker.register('./sw.js'); } catch(e){ console.warn('SW:',e); }
}
async function requestNotifPerm() {
  if (!('Notification' in window)) return;
  try {
    if (Notification.permission!=='granted') await Notification.requestPermission();
  } catch(e) { console.warn('Notification:', e); }
}
function scheduleNotifications(a) {
  if (!swReg?.active) return;
  const now=new Date();
  [{t:new Date(a.prepStartTime),title:'OnTime ⏱',body:`[${a.name}] 지금 준비를 시작하세요!`},
   {t:new Date(new Date(a.departureTime)-10*60000),title:'OnTime 🚨',body:`[${a.name}] 출발 10분 전! 짐 챙기세요.`},
   {t:new Date(a.departureTime),title:'OnTime 🚀',body:`[${a.name}] 지금 출발하세요!`}
  ].forEach(j=>{ const d=j.t-now; if(d>0) swReg.active.postMessage({type:'SCHEDULE_NOTIFICATION',id:a.id+j.title,title:j.title,body:j.body,delay:d}); });
}

// ── Event Listeners ──────────────────────────
function initEvents() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
  document.getElementById('nav-add-btn').addEventListener('click',()=>showView('add'));
document.getElementById('btn-empty-add').addEventListener('click',()=>showView('add'));
  document.getElementById('btn-add-back').addEventListener('click',()=>{ if(currentStep>1) goToStep(currentStep-1); else showView('home'); });
  document.getElementById('btn-step1-next').addEventListener('click',()=>goToStep(2));
  document.getElementById('btn-step2-next').addEventListener('click',()=>goToStep(3));
  document.getElementById('btn-step3-next').addEventListener('click',()=>goToStep(4));
  document.getElementById('btn-confirm').addEventListener('click',confirmAdd);
  document.getElementById('in-date').addEventListener('click',function(){ try{ this.showPicker(); }catch(e){} });
  document.getElementById('in-time').addEventListener('click',function(){ try{ this.showPicker(); }catch(e){} });
  document.getElementById('in-travel').addEventListener('input',e=>{ document.getElementById('travel-val').textContent=e.target.value+'분'; });
  document.querySelectorAll('.mode-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); travelMode=btn.dataset.mode;
  }));
  document.querySelectorAll('.prep-card').forEach(card=>card.addEventListener('click',()=>{
    document.querySelectorAll('.prep-card').forEach(c=>c.classList.remove('selected'));
    card.classList.add('selected'); selectedStyle=card.dataset.style;
  }));
  document.getElementById('btn-timer-back').addEventListener('click',()=>{ clearInterval(timerInterval); showView('home'); });
  document.getElementById('btn-goto-timer').addEventListener('click',()=>{ if(timerApptId) showView('timer'); });
  document.querySelectorAll('.fb-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.fb-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    const r=btn.dataset.result, wrap=document.getElementById('fb-minutes-wrap');
    if (r==='early'||r==='late') { wrap.classList.remove('hidden'); document.getElementById('fb-minutes-label').textContent=r==='early'?'몇 분 일찍?':'몇 분 지각?'; }
    else wrap.classList.add('hidden');
  }));
  document.getElementById('btn-fb-submit').addEventListener('click',submitFeedback);
  document.getElementById('btn-fb-skip').addEventListener('click',()=>closeModal('modal-feedback'));
  document.getElementById('btn-detail-close').addEventListener('click',()=>closeModal('modal-detail'));
  document.getElementById('modal-detail').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeModal('modal-detail'); });
  document.getElementById('modal-feedback').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeModal('modal-feedback'); });
}

// ── Init ─────────────────────────────────────
async function init() {
  await registerSW();
  await requestNotifPerm();
  initEvents();
  document.querySelectorAll('.view').forEach(v=>v.style.display='none');
  setTimeout(()=>{
    document.getElementById('splash').classList.add('fade-out');
    setTimeout(()=>{
      document.getElementById('splash').style.display='none';
      document.getElementById('app').classList.remove('hidden');
      showView('home');
    },600);
  },1400);
}

document.addEventListener('DOMContentLoaded',init);
