// 설정창 컨트롤
function openSettings() {
    document.getElementById('apiKeyInput').value = localStorage.getItem('gemini_api_key') || '';
    document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettings() { 
    document.getElementById('settingsModal').style.display = 'none'; 
}
function saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) { alert("API 키를 입력해주세요!"); return; }
    localStorage.setItem('gemini_api_key', key);
    closeSettings();
    showToast("API 키가 저장되었습니다.");
}

// 이미지 업로드 및 AI 분석
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
        
        // Gemini API 호출 (Vision 모델)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "이 이미지에서 작업해야 할 커팅 리스트(가로, 세로, 목표수량)를 찾아내서 JSON 배열로만 반환해줘. 데이터 형식 예시: [{\"w\": 120, \"h\": 200, \"q\": 5}]. 마크다운 기호(```json) 없이 순수 JSON 텍스트만 출력해." },
                        { inline_data: { mime_type: file.type, data: base64Image.split(',')[1] } }
                    ]
                }]
            })
        });
        
        const data = await response.json();
        
        if (data.error) throw new Error(data.error.message);
        
        let resultText = data.candidates[0].content.parts[0].text;
        // 마크다운 잔재물 제거
        resultText = resultText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        const items = JSON.parse(resultText);
        
        if (items.length === 0) {
            showToast("인식된 치수가 없습니다. 다시 찍어주세요.");
            return;
        }

        renderAiList(items, file);
        showToast("분석 완료! 목록을 터치하세요.");
        
    } catch (err) {
        console.error("AI 분석 에러:", err);
        showToast("인식 실패. API 키나 이미지를 확인해주세요.");
    } finally {
        input.value = ''; // 입력창 초기화 (같은 사진 다시 올릴 수 있게)
    }
}

// AI 추출 목록 화면에 그리기
function renderAiList(items, file) {
    const container = document.getElementById('aiItems');
    const wrapper = document.getElementById('aiListContainer');
    container.innerHTML = '';
    
    const imageUrl = URL.createObjectURL(file);

    items.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = "bg-white p-3 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between active:scale-[0.98] active:bg-blue-50 transition-all cursor-pointer";
        
        // 클릭하면 자동으로 폼 채우고 계산 실행
        div.onclick = () => {
            document.getElementById('w_in').value = item.w || '';
            document.getElementById('h_in').value = item.h || '';
            document.getElementById('q_goal').value = item.q || '';
            
            // 기존 결과 닫고 폼 리셋 효과
            document.getElementById('resultArea').classList.add('hidden');
            
            // 계산 함수 호출 (script.js에 있는 함수)
            setTimeout(() => { calculate(); }, 100); 
            haptic(30);
        };

        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-14 h-14 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative flex-shrink-0">
                    <img src="${imageUrl}" class="absolute scale-[3] origin-center opacity-80" style="top: ${idx % 2 === 0 ? '-20%' : '10%'}; left: ${idx % 2 === 0 ? '-20%' : '10%'};"> 
                    <div class="absolute inset-0 border-[3px] border-blue-500/30 rounded-xl z-10"></div>
                </div>
                <div>
                    <div class="text-xl font-black text-slate-800 tracking-tighter">${item.w} <span class="text-slate-300 font-light text-base mx-0.5">X</span> ${item.h}</div>
                    <div class="text-[13px] font-black text-blue-600 mt-0.5"><i class="fa-solid fa-layer-group mr-1 opacity-70"></i>${item.q || 1}장 목표</div>
                </div>
            </div>
            <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
                <i class="fa-solid fa-chevron-right text-sm"></i>
            </div>
        `;
        container.appendChild(div);
    });

    wrapper.classList.remove('hidden');
    // 결과 목록으로 부드럽게 스크롤
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 파일(사진)을 Base64 포맷으로 변환하는 보조 함수
function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function closeAiList() { 
    document.getElementById('aiListContainer').classList.add('hidden'); 
}