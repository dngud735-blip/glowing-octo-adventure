let historyData = [];

// [초기화] 페이지 로드 시 히스토리 불러오기
window.onload = function() {
    const saved = localStorage.getItem('pvc_mesh_calculator_history');
    if (saved) { 
        try { 
            historyData = JSON.parse(saved); 
            renderHistory(); 
        } catch(e) { 
            historyData = []; 
        } 
    }
};

// [유틸리티] 햅틱 피드백 및 토스트 알림
function haptic(ms = 20) { if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(ms); }
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg; toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2000);
}

// [설정] API 키 관리
function openSettings() {
    document.getElementById('apiKeyInput').value = localStorage.getItem('gemini_api_key') || '';
    document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }
function saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) { alert("API 키를 입력해주세요."); return; }
    localStorage.setItem('gemini_api_key', key);
    closeSettings();
    showToast("API 키가 안전하게 저장되었습니다.");
}

// [AI 분석] 이미지 업로드 및 Gemini API 연동
async function processImage(input) {
    const file = input.files[0];
    const apiKey = localStorage.getItem('gemini_api_key');
    
    if (!apiKey) { 
        alert("우측 상단 톱니바퀴 아이콘을 눌러 API 키를 먼저 등록해주세요."); 
        input.value = ''; 
        return; 
    }
    if (!file) return;

    showToast("AI가 치수를 분석 중입니다... 🔍");
    document.getElementById('aiListContainer').classList.add('hidden');
    
    try {
        const base64Image = await toBase64(file);
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "이 이미지에서 작업해야 할 커팅 리스트(가로, 세로, 목표수량)를 찾아내서 JSON 배열로만 반환해줘. 데이터 형식 예시: [{\"w\": 120, \"h\": 200, \"q\": 5}]. 마크다운 기호 없이 순수 JSON만 출력해." },
                        { inline_data: { mime_type: file.type, data: base64Image.split(',')[1] } }
                    ]
                }]
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        
        let resultText = data.candidates[0].content.parts[0].text;
        resultText = resultText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const items = JSON.parse(resultText);
        
        if (items.length === 0) {
            showToast("인식된 치수가 없습니다.");
            return;
        }

        renderAiList(items, file);
        showToast("분석 완료! 목록을 선택하세요.");
        
    } catch (err) {
        console.error("AI 에러:", err);
        showToast("인식 실패. API 키를 확인해주세요.");
    } finally {
        input.value = ''; 
    }
}

function renderAiList(items, file) {
    const container = document.getElementById('aiItems');
    const wrapper = document.getElementById('aiListContainer');
    container.innerHTML = '';
    const imageUrl = URL.createObjectURL(file);

    items.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = "bg-white p-3 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between active:scale-[0.98] active:bg-blue-50 transition-all cursor-pointer mb-2";
        div.onclick = () => {
            document.getElementById('w_in').value = item.w || '';
            document.getElementById('h_in').value = item.h || '';
            document.getElementById('q_goal').value = item.q || '';
            document.getElementById('resultArea').classList.add('hidden');
            setTimeout(() => { calculate(); }, 100); 
            haptic(30);
        };
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative flex-shrink-0">
                    <img src="${imageUrl}" class="absolute scale-[2] origin-center opacity-60">
                </div>
                <div>
                    <div class="text-lg font-black text-slate-800">${item.w} X ${item.h}</div>
                    <div class="text-xs font-black text-blue-600">${item.q || 1}장 목표</div>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right text-slate-300"></i>`;
        container.appendChild(div);
    });
    wrapper.classList.remove('hidden');
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
function closeAiList() { document.getElementById('aiListContainer').classList.add('hidden'); }

// [핵심 로직] 커팅 계산 엔진
function calculate(isFromHistory = false) {
    haptic(30); hideError(); if(document.activeElement) document.activeElement.blur();
    
    const p1Raw = document.getElementById('p1_in').value;
    const p2Raw = document.getElementById('p2_in').value;
    const rIn = document.getElementById('r_in').value; 
    const wIn = document.getElementById('w_in').value; 
    const hIn = document.getElementById('h_in').value;
    const goalIn = document.getElementById('q_goal').value; 

    if (!wIn || !hIn) { showError("가로, 세로 치수를 입력해 주세요."); return; }

    const W = parseFloat(wIn); const H = parseFloat(hIn); 
    const R = rIn ? parseFloat(rIn) : H; 
    const P1_val = parseFloat(p1Raw); const P2_val = parseFloat(p2Raw);
    
    const isGoal = (goalIn && goalIn.trim() !== "");
    let goalN = 0, doneTotal = 0, Q = 0;
    
    if (isGoal) {
        goalN = parseFloat(goalIn);
        doneTotal = (parseFloat(document.getElementById('q_done1').value) || 0) + (parseFloat(document.getElementById('q_done2').value) || 0) + (parseFloat(document.getElementById('q_done3').value) || 0);
        Q = goalN - doneTotal;
        if (Q < 0) { showError("완료 수량이 목표를 초과했습니다."); return; }
    }

    const wasteW = (R < W) ? 99999 : (R - W);
    const wasteH = (R < H) ? 99999 : (R - H);
    if (wasteW === 99999 && wasteH === 99999) { showError("원단 폭이 부족하여 제작 불가합니다."); return; }

    let FIX, PULL, finalWaste, fixLabel, pullLabel;
    if (wasteH <= wasteW) { FIX = H; PULL = W; finalWaste = wasteH; fixLabel = "세로"; pullLabel = "가로"; } 
    else { FIX = W; PULL = H; finalWaste = wasteW; fixLabel = "가로"; pullLabel = "세로"; }
    
    // 최소 컷 계산 루프
    let minCuts = 999999;
    for (let n = 2; n <= 10; n++) {
        if (isGoal && Q > 0 && n > Q) break;
        let totalLen = (PULL * n) + 2; 
        if (totalLen > 1200) continue; 
        let curB = isGoal ? Math.ceil(Q / n) : 1;
        let totalCutCount = n + curB + (finalWaste > 0 ? 1 : 0);
        if (totalCutCount < minCuts) minCuts = totalCutCount;
    }
    
    document.getElementById('resultArea').classList.remove('hidden');
    document.getElementById('summaryCardHeader').innerHTML = `<i class="fa-solid fa-thumbtack text-sm mr-1"></i> ${fixLabel} ${fmt(FIX)} 고정`;
    
    const masterWebbingStr = [!isNaN(P1_val) && P1_val <= FIX ? fmt(P1_val) : null, !isNaN(P2_val) && P2_val <= FIX ? fmt(P2_val) : null].filter(v => v !== null).join(' / ') || '-';
    
    document.getElementById('summaryList').innerHTML = `
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
            <span class="text-[12px] font-black text-slate-400 uppercase">Trim</span>
            <span class="text-xl font-black text-slate-800">폭 ${fmt(R)} - ${fmt(FIX)} = <span class="text-red-500">${fmt(finalWaste)}cm</span></span>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-2">
            <div class="bg-violet-50/50 p-2 rounded-xl text-center">
                <span class="text-[11px] font-black text-violet-400 block mb-1">CENTER</span>
                <span class="text-lg font-black text-violet-700">${fmtSpecial(FIX/2)}</span>
            </div>
            <div class="bg-emerald-50/50 p-2 rounded-xl text-center">
                <span class="text-[11px] font-black text-emerald-600 block mb-1">3-PART</span>
                <span class="text-lg font-black text-emerald-900">${Math.round(FIX/3)} / ${Math.round(FIX*2/3)}</span>
            </div>
            <div class="bg-blue-50/50 p-2 rounded-xl text-center">
                <span class="text-[11px] font-black text-blue-400 block mb-1">4-PART</span>
                <span class="text-lg font-black text-blue-600">${fmtSpecial(FIX*0.25)} / ${fmtSpecial(FIX*0.75)}</span>
            </div>
            <div class="bg-amber-50/50 p-2 rounded-xl text-center">
                <span class="text-[11px] font-black text-amber-600 block mb-1">WEBBING</span>
                <span class="text-lg font-black text-amber-900">${masterWebbingStr}</span>
            </div>
        </div>`;
    
    const container = document.getElementById('cardsContainer'); container.innerHTML = '';
    for (let n = 2; n <= 10; n++) {
        if (isGoal && Q > 0 && n > Q) break;
        let totalLen = (PULL * n) + 2; if (totalLen > 1200) break;
        let floorB = isGoal ? Math.floor(Q / n) : 1; 
        let remB = isGoal ? (Q % n) : 0;
        let curB_for_cut = isGoal ? Math.ceil(Q / n) : 1; 
        let totalCutCount = n + curB_for_cut + (finalWaste > 0 ? 1 : 0);
        const isRec = isGoal && (totalCutCount === minCuts);
        
        let cuts = []; for(let i=1; i<=n; i++) cuts.push(fmt(PULL * i));
        let centers = []; for(let i=0; i<n; i++) centers.push(fmtSpecial((PULL/2) + (PULL * i)));
        let thirds = []; for(let i=0; i<n; i++) { let b = PULL * i; thirds.push(Math.round(b + PULL/3)); thirds.push(Math.round(b + PULL*2/3)); }
        let s4 = []; for(let i=0; i<n; i++) { let b = PULL * i; s4.push(fmtSpecial(b + PULL/4)); s4.push(fmtSpecial(b + PULL*3/4)); }
        
        let dWeb = []; if (!isNaN(P1_val) && P1_val <= PULL) dWeb.push(P1_val); if (!isNaN(P2_val) && P2_val <= PULL) dWeb.push(P2_val);
        let pts = []; 
        if (dWeb.length > 0) {
            for(let i=0; i<n; i++) { let b = PULL * i; dWeb.forEach(vp => pts.push(fmtSpecial(b + vp))); } 
            pts.sort((a,b)=>a-b);
        }

        const card = document.createElement('div'); 
        card.className = `w-full bg-white border rounded-[24px] overflow-hidden animate-in shadow-md ${isRec ? 'ring-2 ring-blue-500' : 'border-slate-100'}`;
        
        card.innerHTML = `
        <div class="px-5 py-3 bg-slate-900 flex items-center justify-between">
            <span class="text-2xl font-black text-white">${fmt(W)} X ${fmt(H)}</span>
            <span class="bg-blue-500 text-white px-3 py-1 rounded-lg font-black text-sm uppercase italic">${totalCutCount} Cuts</span>
        </div>
        <div class="p-5 bg-white">
            <div class="flex items-center justify-between mb-4">
                <span class="text-4xl font-black text-slate-900">${isGoal ? floorB+'회' : n+'장'}</span>
                <span class="text-xs font-black uppercase p-2 bg-slate-100 rounded-lg text-slate-500">${pullLabel} 당김</span>
            </div>
            <div class="bg-blue-50 p-4 rounded-2xl text-center mb-6">
                <span class="text-[11px] font-black text-blue-400 block mb-1 uppercase tracking-widest text-center">Total Length</span>
                <span class="text-5xl font-black text-blue-600">${fmt(totalLen)}<small class="text-2xl ml-1 text-slate-400">cm</small></span>
            </div>
            <div class="space-y-4">
                <div>
                    <span class="text-rose-500 font-black text-[11px] uppercase block mb-2 tracking-widest"><i class="fa-solid fa-cut mr-1"></i> Cut Points</span>
                    <div class="grid grid-cols-4 gap-2">${cuts.map(c => `<span class="data-chip text-rose-600" ${getChipStyle(c)}>${c}</span>`).join('')}</div>
                </div>
                <div>
                    <button onclick="toggleCardMarking(this)" class="w-full flex items-center justify-between py-1.5 text-slate-400">
                        <span class="font-black text-[11px] uppercase tracking-widest italic">More Markers</span>
                        <i class="fa-solid fa-chevron-down text-[10px] chevron-icon"></i>
                    </button>
                    <div class="hidden pt-2 space-y-3">
                        <div class="grid grid-cols-4 gap-2">${centers.map(c => `<span class="data-chip text-violet-700" ${getChipStyle(c)}>${c}</span>`).join('')}</div>
                        <div class="grid grid-cols-4 gap-2">${pts.length > 0 ? pts.map(p => `<span class="data-chip text-amber-700" ${getChipStyle(p)}>${p}</span>`).join('') : ''}</div>
                    </div>
                </div>
            </div>
        </div>`;
        container.appendChild(card);
    }
    if (!isFromHistory) saveToHistory(W, H, rIn ? R : '', p1Raw, p2Raw, (isGoal ? goalN : 0), doneTotal, Q, pullLabel);
}

// [히스토리] 저장 및 관리 로직
function saveToHistory(w, h, r, p1, p2, qg, dTotal, qLeft, pLabel) {
    const current = { id: Date.now(), w_in: w, h_in: h, r_in: r, p1_in: p1, p2_in: p2, q_goal: qg, d_total: dTotal, q_left: qLeft, pull_label: pLabel };
    historyData.unshift(current);
    if (historyData.length > 40) historyData.pop();
    saveToLocal();
}
function saveToLocal() { localStorage.setItem('pvc_mesh_calculator_history', JSON.stringify(historyData)); renderHistory(); }
function renderHistory() {
    const list = document.getElementById('historyList');
    if (historyData.length === 0) { list.innerHTML = '<p class="text-center text-slate-300 py-10 font-black uppercase italic">No History</p>'; return; }
    list.innerHTML = historyData.map(data => `
        <div class="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 history-card" onclick="fillFormFromHistory(${data.id})">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-2xl font-black text-slate-900">${data.w_in} X ${data.h_in}</div>
                    <div class="text-xs font-black text-blue-600 uppercase mt-1">폭 ${data.r_in || '-'} | ${data.pull_label} 당김</div>
                </div>
                <button onclick="confirmDeleteIndividual(event, ${data.id})" class="text-slate-200"><i class="fa-solid fa-circle-xmark text-2xl"></i></button>
            </div>
        </div>`).join('');
}

// [UI 제어] 기타 함수들
function fillFormFromHistory(id) {
    const data = historyData.find(d => d.id === id); if (!data) return;
    haptic(25);
    document.getElementById('w_in').value = data.w_in;
    document.getElementById('h_in').value = data.h_in;
    document.getElementById('r_in').value = data.r_in || '';
    document.getElementById('p1_in').value = data.p1_in || '';
    document.getElementById('p2_in').value = data.p2_in || '';
    document.getElementById('q_goal').value = data.q_goal || '';
    document.getElementById('q_done1').value = data.d_total || '';
    calculate(true); 
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function toggleHistory() { 
    const isHidden = document.getElementById('historyList').classList.toggle('hidden'); 
    document.getElementById('historyIcon').style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
}
function toggleCardMarking(btn) { 
    const content = btn.nextElementSibling;
    const isHidden = content.classList.toggle('hidden');
    btn.querySelector('.chevron-icon').style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
}
function handleEnter(event, isLast = false) { if (event.key === 'Enter') { calculate(); if (isLast) document.activeElement.blur(); } }
function fmt(num) { return (num % 1 === 0) ? num : parseFloat(num.toFixed(1)); }
function fmtSpecial(num) { return (num % 1 === 0) ? num : parseFloat(num.toFixed(1)); }
function getChipStyle(val) { return val.toString().length > 3 ? 'style="font-size: 1.1rem;"' : 'style="font-size: 1.4rem;"'; }
function showError(msg) { document.getElementById('errorMsg').innerText = msg; document.getElementById('errorBox').classList.remove('hidden'); }
function hideError() { document.getElementById('errorBox').classList.add('hidden'); }
function resetForm() { document.querySelectorAll('input').forEach(i => i.value = ''); hideError(); document.getElementById('resultArea').classList.add('hidden'); }
function closeDeleteModal() { document.getElementById('deleteModal').style.display = 'none'; }
function confirmClearAll(event) {
    event.stopPropagation();
    const modal = document.getElementById('deleteModal');
    document.getElementById('modalIcon').innerHTML = '<i class="fa-solid fa-triangle-exclamation text-amber-500"></i>';
    document.getElementById('modalTitle').innerText = "전체 삭제";
    document.getElementById('confirmDeleteBtn').innerText = "삭제하기";
    document.getElementById('confirmDeleteBtn').className = "flex-1 py-3 bg-red-600 text-white font-bold rounded-xl";
    document.getElementById('confirmDeleteBtn').onclick = () => { historyData = []; saveToLocal(); closeDeleteModal(); };
    modal.style.display = 'flex';
}
function confirmDeleteIndividual(event, id) {
    event.stopPropagation();
    historyData = historyData.filter(d => d.id !== id);
    saveToLocal();
    showToast("기록이 삭제되었습니다.");
}