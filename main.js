// ======================
// 보선녀 VN main.js (통합 안정판 - window.scenes 방식 지원)
// ======================

// ----------------------
// 전역 상태
// ----------------------
let playerName = "";
const SAVE_KEY = "vn_save_v2";

// DOM refs
let dialogueBox = null;
let leftSprite = null;
let rightSprite = null;

// ✅ scenes는 window.scenes를 "단일 진실"로 사용
window.scenes = window.scenes || {};
const scenes = window.scenes; // ✅ 이거 반드시 있어야 함!

// ----------------------
// 게임 상태
// ----------------------
const state = {
  scene: "day1_morning",
  line: 0,

  // ✅ 선택 기억용
  flags: {
    day3_calledSto: false,
    unlock_rib: false,
    unlock_ara: false,
  },

  // ✅ "씬 진입 시 effect"를 1회만 적용하기 위한 기록
  appliedSceneEffects: {},

  affection: 0,
  points: { sto: 0, ise: 0, tar: 0, rib: 0, ara: 0 },

  outfit: "uniform",
  settings: { autoSave: true }
};

// ----------------------
// 저장/불러오기
// ----------------------
function saveGame() {
  try {
    const payload = {
      playerName,
      state: {
        scene: state.scene,
        line: state.line,
        affection: state.affection,
        points: state.points,
        outfit: state.outfit,
        settings: state.settings,
        flags: state.flags,
        appliedSceneEffects: state.appliedSceneEffects,
      }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("save failed", e);
    return false;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);

    const pn = String(data.playerName || "").trim();
    if (!pn) return false;
    playerName = pn;

    const s = data.state || {};

    state.scene = s.scene || "day1_morning";
    state.line = Number.isFinite(s.line) ? s.line : 0;
    state.affection = Number.isFinite(s.affection) ? s.affection : 0;

    state.points = (s.points && typeof s.points === "object")
      ? s.points
      : { sto: 0, ise: 0, tar: 0, rib: 0, ara: 0 };

    state.outfit = s.outfit || "uniform";

    state.settings = (s.settings && typeof s.settings === "object")
      ? s.settings
      : { autoSave: true };
    if (typeof state.settings.autoSave !== "boolean") state.settings.autoSave = true;

    // ✅ flags 복원 + 기본키 보강
    const baseFlags = { day3_calledSto: false, unlock_rib: false, unlock_ara: false };
    state.flags = (s.flags && typeof s.flags === "object") ? { ...baseFlags, ...s.flags } : { ...baseFlags };

    // ✅ 씬 effect 적용 기록 복원
    state.appliedSceneEffects = (s.appliedSceneEffects && typeof s.appliedSceneEffects === "object")
      ? s.appliedSceneEffects
      : {};

    ensurePoints();
    return true;
  } catch (e) {
    console.warn("load failed", e);
    return false;
  }
}

// ----------------------
// 공통 util
// ----------------------
function ensurePoints() {
  if (!state.points || typeof state.points !== "object") {
    state.points = { sto: 0, ise: 0, tar: 0, rib: 0, ara: 0 };
  }
  for (const k of ["sto", "ise", "tar", "rib", "ara"]) {
    if (typeof state.points[k] !== "number") state.points[k] = 0;
  }
}

function getScene(id) { return scenes[id]; }

function parseScript(rawText) {
  const lines = (rawText || "")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const script = [];
  for (const line of lines) {
    if (line.startsWith("(") && line.endsWith(")")) {
      script.push({ type: "narration", text: line });
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 20) {
      const speaker = line.slice(0, colonIdx).trim();
      const text = line.slice(colonIdx + 1).trim();
      if (speaker && text) {
        script.push({ type: "dialogue", speaker, text });
        continue;
      }
    }
    script.push({ type: "narration", text: line });
  }
  return script;
}

function getSceneScript(sceneId) {
  const scene = getScene(sceneId);
  if (!scene) {
    console.warn("씬을 찾을 수 없음:", sceneId, "현재 등록된 씬:", Object.keys(window.scenes));
    return [{ type: "narration", text: `씬을 찾을 수 없어: ${sceneId}` }];
  }

  const raw = (typeof scene.text === "function") ? scene.text() : scene.text;

  if (!scene.__scriptCache || scene.__scriptCacheRaw !== raw) {
    scene.__scriptCache = parseScript(raw);
    scene.__scriptCacheRaw = raw;
  }
  return scene.__scriptCache;
}

function getPointsSnapshot() {
  ensurePoints();
  return { ...state.points };
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = msg;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");

  clearTimeout(showToast.__t);
  showToast.__t = setTimeout(() => el.classList.remove("show"), 1300);
}

function applyEffect(effect) {
  if (!effect) return;
  ensurePoints();

  if (typeof effect === "number") {
    state.affection += effect;
    return;
  }

  if (typeof effect === "object") {
    for (const [key, val] of Object.entries(effect)) {
      if (typeof val === "boolean") {
        if (!state.flags) state.flags = {};
        state.flags[key] = val;
        continue;
      }

      if (typeof val === "number") {
        if (!state.points) state.points = {};
        if (typeof state.points[key] !== "number") state.points[key] = 0;
        state.points[key] += val;
        continue;
      }
    }
  }
}

function repName(s) {
  return String(s || "").replaceAll("{name}", playerName);
}

// ✅ 씬 진입 시(scene.effect) 1회 적용
function applySceneEnterEffectOnce(sceneId) {
  const scene = getScene(sceneId);
  if (!scene || !scene.effect) return;

  if (!state.appliedSceneEffects || typeof state.appliedSceneEffects !== "object") {
    state.appliedSceneEffects = {};
  }

  if (state.appliedSceneEffects[sceneId]) return; // 이미 적용됨

  applyEffect(scene.effect);
  state.appliedSceneEffects[sceneId] = true;
}

// ----------------------
// 스프라이트
// ----------------------
function setSprite(side, src) {
  const el = side === "left" ? leftSprite : rightSprite;
  if (!el) return;

  if (!src) {
    el.classList.add("hidden");
    el.removeAttribute("src");
    return;
  }
  el.src = src;
  el.classList.remove("hidden");
}

function setSpeaking(side) {
  if (!leftSprite || !rightSprite) return;

  const leftHidden = leftSprite.classList.contains("hidden");
  const rightHidden = rightSprite.classList.contains("hidden");
  if (leftHidden && rightHidden) return;

  if (side === "left") {
    leftSprite.classList.remove("dim");
    rightSprite.classList.add("dim");
  } else if (side === "right") {
    rightSprite.classList.remove("dim");
    leftSprite.classList.add("dim");
  } else {
    leftSprite.classList.remove("dim");
    rightSprite.classList.remove("dim");
  }
}

// ----------------------
// 상태창/모달/오버레이
// ----------------------
function setText(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(v ?? "");
}

function updateStatusPanelLabels() {
  ensurePoints();

  setText("stoStatus", state.points.sto);
  setText("iseStatus", state.points.ise);
  setText("tarStatus", state.points.tar);

  const ribCard = document.getElementById("ribCard");
  const araCard = document.getElementById("araCard");

  if (ribCard) ribCard.classList.toggle("hidden", !state.flags.unlock_rib);
  if (araCard) araCard.classList.toggle("hidden", !state.flags.unlock_ara);

  if (state.flags.unlock_rib) setText("ribStatus", state.points.rib);
  if (state.flags.unlock_ara) setText("araStatus", state.points.ara);

  setText("outfitLabel", state.outfit);
  setText("autosaveLabel", state.settings.autoSave ? "ON" : "OFF");
}

function openOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
}

function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
}

function openModal(title, builder) {
  const overlay = document.getElementById("modalOverlay");
  const t = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!overlay || !t || !body) return;

  t.textContent = title;
  body.innerHTML = "";
  builder(body);

  overlay.classList.remove("hidden");
}

function closeModal() {
  closeOverlay("modalOverlay");
}

function makeBtn(label, onClick, className = "btn") {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// ----------------------
// 화면 전환
// ----------------------
function showScreen(idToShow) {
  const ids = ["titleScreen", "nameScreen", "gameScreen"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === idToShow) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }
}

// ----------------------
// 렌더/진행
// ----------------------
function render(textEl, namePlateEl, choicesEl) {
  ensurePoints();

  const scene = getScene(state.scene);

  // ✅ 씬 진입 효과(아라랑궁 unlock 같은 거) 적용: "해당 씬 처음 들어왔을 때" 1회
  // (state.line이 0일 때만 체크하면, 새로고침/불러오기에도 안정적으로 1회만 적용됨)
  if (state.line === 0) {
    applySceneEnterEffectOnce(state.scene);
  }

  const script = getSceneScript(state.scene);

  if (!script || script.length === 0) {
    namePlateEl.style.display = "none";
    textEl.textContent = "대사가 비어있음! scene.text 확인해줘.";
    choicesEl.innerHTML = "";
    return;
  }

  if (state.line < 0) state.line = 0;
  if (state.line >= script.length) state.line = script.length - 1;

  const cur = script[state.line] || { type: "narration", text: "" };

  if (dialogueBox) {
    dialogueBox.classList.toggle("isDialogue", cur.type === "dialogue");
    dialogueBox.classList.toggle("isNarration", cur.type !== "dialogue");
    dialogueBox.dataset.outfit = state.outfit;
  }

  // sprite auto
  if (cur.type === "dialogue") {
    const sp = repName(cur.speaker);
    if (sp.includes("스토마쉐")) {
      setSprite("left", "img/sto.png");
      setSpeaking("left");
    } else if (sp.includes("이세치슈")) {
      setSprite("right", "img/ise.png");
      setSpeaking("right");
    } else {
      setSpeaking(null);
    }
  } else {
    setSpeaking(null);
  }

  // 출력
  choicesEl.innerHTML = "";
  if (cur.type === "dialogue") {
    namePlateEl.style.display = "inline-block";
    namePlateEl.textContent = repName(cur.speaker);
    textEl.textContent = repName(cur.text);
  } else {
    namePlateEl.style.display = "none";
    textEl.textContent = repName(cur.text);
  }

  if (state.settings.autoSave) saveGame();

  const isLastLine = state.line >= script.length - 1;
  if (!isLastLine) return;

  // 마지막 줄: choices
  if (Array.isArray(scene?.choices) && scene.choices.length > 0) {
    for (const choice of scene.choices) {
      const btn = document.createElement("button");
      btn.className = "choiceBtn";
      btn.textContent = choice.label;

      btn.addEventListener("click", () => {
        const before = getPointsSnapshot();
        applyEffect(choice.effect);
        const after = getPointsSnapshot();

        const msgs = [];
        const delta = (k, label) => {
          const d = (after[k] ?? 0) - (before[k] ?? 0);
          if (d) msgs.push(`${label} ${d > 0 ? `+${d}` : d}`);
        };
        delta("sto", "스토마쉐");
        delta("ise", "이세치슈");
        delta("tar", "선배");
        delta("rib", "리복매");
        delta("ara", "아라랑궁");
        if (msgs.length) showToast(msgs.join(" / "));

        if (choice.reset) {
          state.affection = 0;
          state.points = { sto: 0, ise: 0, tar: 0, rib: 0, ara: 0 };
          showToast("호감도가 초기화되었습니다.");
        }

        let nextId = choice.next;

        if (Array.isArray(choice.condNext)) {
          for (const rule of choice.condNext) {
            try {
              if (rule?.if?.(state)) {
                nextId = rule.next;
                break;
              }
            } catch (e) {
              console.warn("condNext error", e);
            }
          }
        }

        if (!nextId || !getScene(nextId)) {
          alert(`다음 씬이 없거나 오타야: "${nextId}"`);
          return;
        }

        state.scene = nextId;
        state.line = 0;

        if (state.settings.autoSave) saveGame();
        render(textEl, namePlateEl, choicesEl);
      });

      choicesEl.appendChild(btn);
    }
    return;
  }

  // 마지막 줄: next만 있는 씬은 클릭으로 advance에서 넘어감
  if (scene?.next) return;

  const hint = document.createElement("div");
  hint.style.opacity = "0.8";
  hint.textContent = "(이 씬은 choices 또는 next가 필요해)";
  choicesEl.appendChild(hint);
}

function advance(textEl, namePlateEl, choicesEl) {
  const scene = getScene(state.scene);
  const script = getSceneScript(state.scene);
  if (!script || script.length === 0) return;

  if (state.line < script.length - 1) {
    state.line += 1;
    if (state.settings.autoSave) saveGame();
    render(textEl, namePlateEl, choicesEl);
    return;
  }

  if (Array.isArray(scene?.choices) && scene.choices.length > 0) return;

  if (scene?.next) {
    if (!getScene(scene.next)) {
      alert(`다음 씬이 없거나 오타야: "${scene.next}"`);
      return;
    }
    state.scene = scene.next;
    state.line = 0;
    if (state.settings.autoSave) saveGame();
    render(textEl, namePlateEl, choicesEl);
    return;
  }

  alert("끝! (다음 씬/선택지를 추가해줘)");
}

// ----------------------
// 옷장/설정 모달
// ----------------------
function toastDelta(before, after, label) {
  const msgs = [`${label} 선택!`];
  const delta = (k, label2) => {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (d) msgs.push(`${label2} ${d > 0 ? `+${d}` : d}`);
  };
  delta("sto", "스토마쉐");
  delta("ise", "이세치슈");
  delta("tar", "선배");
  delta("rib", "리복매");
  delta("ara", "아라랑궁");
  showToast(msgs.join(" / "));
}

function openWardrobeModal(renderArgs) {
  const { textEl, namePlate, choicesEl } = renderArgs;

  openModal("옷장", (body) => {
    const info = document.createElement("div");
    info.className = "modalText";
    info.textContent = `옷을 고르면 누군가는 좋아하고 누군가는 싫어함 ㅎㅎ\n현재 착장: ${state.outfit}`;
    body.appendChild(info);

    const row = document.createElement("div");
    row.className = "row";

    row.appendChild(makeBtn("교복", () => {
      state.outfit = "uniform";
      const before = getPointsSnapshot();
      applyEffect({ ise: +1 });
      const after = getPointsSnapshot();
      toastDelta(before, after, "교복");
      if (state.settings.autoSave) saveGame();
      closeModal();
      updateStatusPanelLabels();
      render(textEl, namePlate, choicesEl);
    }, "btn small"));

    row.appendChild(makeBtn("후드티", () => {
      state.outfit = "hoodie";
      const before = getPointsSnapshot();
      applyEffect({ sto: +1, ise: -1 });
      const after = getPointsSnapshot();
      toastDelta(before, after, "후드티");
      if (state.settings.autoSave) saveGame();
      closeModal();
      updateStatusPanelLabels();
      render(textEl, namePlate, choicesEl);
    }, "btn small"));

    row.appendChild(makeBtn("큐티룩", () => {
      state.outfit = "cute";
      const before = getPointsSnapshot();
      applyEffect({ sto: +1, tar: +1 });
      const after = getPointsSnapshot();
      toastDelta(before, after, "큐티룩");
      if (state.settings.autoSave) saveGame();
      closeModal();
      updateStatusPanelLabels();
      render(textEl, namePlate, choicesEl);
    }, "btn small primary"));

    body.appendChild(row);
  });
}

function openSettingsModal() {
  openModal("설정", (body) => {
    const wrap = document.createElement("div");
    wrap.className = "modalText";

    const line = document.createElement("div");
    line.textContent = `자동저장: ${state.settings.autoSave ? "ON" : "OFF"}`;
    wrap.appendChild(line);

    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(makeBtn("자동저장 토글", () => {
      state.settings.autoSave = !state.settings.autoSave;
      saveGame();
      showToast(`자동저장 ${state.settings.autoSave ? "ON" : "OFF"}`);
      closeModal();
      updateStatusPanelLabels();
    }, "btn small"));
    wrap.appendChild(row);

    body.appendChild(wrap);
  });
}

// ----------------------
// DOM 연결
// ----------------------
window.addEventListener("DOMContentLoaded", () => {
  // screens
  const titleScreen = document.getElementById("titleScreen");
  const nameScreen = document.getElementById("nameScreen");
  const gameScreen = document.getElementById("gameScreen");

  // sprites
  leftSprite = document.getElementById("leftSprite");
  rightSprite = document.getElementById("rightSprite");

  // title buttons
  const goStart = document.getElementById("goStart");
  const goContinue = document.getElementById("goContinue");
  const goIntro = document.getElementById("goIntro");
  const goChars = document.getElementById("goChars");
  const goWardrobe = document.getElementById("goWardrobe");
  const goSettings = document.getElementById("goSettings");

  // name screen
  const nameInput = document.getElementById("nameInput");
  const startBtn = document.getElementById("startBtn");
  const backToTitle1 = document.getElementById("backToTitle1");

  // game ui
  const textEl = document.getElementById("text");
  const choicesEl = document.getElementById("choices");
  dialogueBox = document.getElementById("dialogueBox");
  const namePlate = document.getElementById("namePlate");

  const menuBtn = document.getElementById("menuBtn");
  const statusBtn = document.getElementById("statusBtn");
  const saveBtn = document.getElementById("saveBtn");
  const loadBtn = document.getElementById("loadBtn");
  const resetBtn = document.getElementById("resetBtn");

  // status overlay
  const statusOverlay = document.getElementById("statusOverlay");
  const closeStatusBtn = document.getElementById("closeStatusBtn");
  const closeStatusBtn2 = document.getElementById("closeStatusBtn2");

  // modal
  const closeModalBtn = document.getElementById("closeModalBtn");
  const modalOkBtn = document.getElementById("modalOkBtn");
  const modalOverlay = document.getElementById("modalOverlay");

  // 필수 체크
  const must = [
    titleScreen, nameScreen, gameScreen,
    goStart, goContinue, goIntro, goChars, goWardrobe, goSettings,
    nameInput, startBtn, backToTitle1,
    textEl, choicesEl, dialogueBox, namePlate,
    menuBtn, statusBtn, saveBtn, loadBtn, resetBtn,
    statusOverlay, closeStatusBtn, closeStatusBtn2,
    closeModalBtn, modalOkBtn, modalOverlay
  ];
  if (must.some(v => !v)) {
    alert("index.html id 누락 있음! (버튼/오버레이/모달/스프라이트/toast id 확인)");
    return;
  }

  // 초기 화면
  showScreen("titleScreen");
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    goContinue.disabled = !raw;
  } catch {
    goContinue.disabled = true;
  }

  // 타이틀 버튼
  goStart.addEventListener("click", () => {
    nameInput.value = "";
    showScreen("nameScreen");
  });

  goContinue.addEventListener("click", () => {
    const ok = loadGame();
    if (!ok) return alert("저장 데이터가 없어!");
    showScreen("gameScreen");
    render(textEl, namePlate, choicesEl);
  });

  goIntro.addEventListener("click", () => {
    openModal("게임 소개", (body) => {
      const p = document.createElement("div");
      p.className = "modalText";
      p.textContent =
        "목표: 보선녀 VN을 ‘진짜 게임’처럼 완성해서 플레이스토어에 올리기!\n\n" +
        "Day 1에서 시작해 스토마쉐/이세치슈/선배/리복매/아라랑궁과의 관계를 선택으로 바꾸며 엔딩을 만든다.\n" +
        "옷장/설정/상태창/메뉴 같은 ‘게임 기능’을 계속 추가하는 중.";
      body.appendChild(p);
    });
  });

  goChars.addEventListener("click", () => {
    openModal("캐릭터", (body) => {
      const p = document.createElement("div");
      p.className = "modalText";
      p.textContent =
        "스토마쉐: 어릴 때부터 같이 다닌 친구. 다정한데 가끔 폭주.\n\n" +
        "이세치슈: 전학생. 거리감 있고 차가운데 은근 반응이 귀여움.\n\n" +
        "선배(타루렐 떡밥): 매점에서 결제해준 미스터리 선배.\n\n" +
        "리복매/아라랑궁: Day 5~7부터 본격 가동(추가 예정).";
      body.appendChild(p);
    });
  });

  goWardrobe.addEventListener("click", () => openWardrobeModal({ textEl, namePlate, choicesEl }));
  goSettings.addEventListener("click", () => openSettingsModal());

  // 이름 입력 화면
  backToTitle1.addEventListener("click", () => showScreen("titleScreen"));

  startBtn.addEventListener("click", () => {
    const input = nameInput.value.trim();
    if (!input) return alert("이름을 입력해줘!");
    playerName = input;

    // ✅ 새게임 초기화 (flags 포함 확실히 초기화)
    state.scene = "day1_morning";
    state.line = 0;
    state.affection = 0;
    state.points = { sto: 0, ise: 0, tar: 0, rib: 0, ara: 0 };
    state.outfit = "uniform";
    if (!state.settings) state.settings = { autoSave: true };

    state.flags = { day3_calledSto: false, unlock_rib: false, unlock_ara: false };
    state.appliedSceneEffects = {}; // ✅ 씬 effect 적용 기록 초기화

    saveGame();
    goContinue.disabled = false;

    showScreen("gameScreen");
    render(textEl, namePlate, choicesEl);
  });

  // 게임 화면 버튼들
  menuBtn.addEventListener("click", () => {
    openModal("메뉴", (body) => {
      const row = document.createElement("div");
      row.className = "row";
      row.appendChild(makeBtn("게임 소개", () => { closeModal(); goIntro.click(); }, "btn small"));
      row.appendChild(makeBtn("캐릭터", () => { closeModal(); goChars.click(); }, "btn small"));
      row.appendChild(makeBtn("옷장", () => { closeModal(); openWardrobeModal({ textEl, namePlate, choicesEl }); }, "btn small"));
      row.appendChild(makeBtn("설정", () => { closeModal(); openSettingsModal(); }, "btn small"));
      body.appendChild(row);

      const row2 = document.createElement("div");
      row2.className = "row";
      row2.appendChild(makeBtn("타이틀로", () => { closeModal(); showScreen("titleScreen"); }, "btn danger"));
      body.appendChild(row2);
    });
  });

  statusBtn.addEventListener("click", () => {
    updateStatusPanelLabels();
    openOverlay("statusOverlay");
  });

  closeStatusBtn.addEventListener("click", () => closeOverlay("statusOverlay"));
  closeStatusBtn2.addEventListener("click", () => closeOverlay("statusOverlay"));
  statusOverlay.addEventListener("click", (e) => {
    if (e.target === statusOverlay) closeOverlay("statusOverlay");
  });

  // 대사창 클릭 = 진행
  dialogueBox.addEventListener("click", () => {
    if (choicesEl.childElementCount > 0) return;
    advance(textEl, namePlate, choicesEl);
  });

  // 저장/불러오기/리셋
  saveBtn.addEventListener("click", () => {
    saveGame();
    goContinue.disabled = false;
    showToast("저장 완료!");
  });

  loadBtn.addEventListener("click", () => {
    const ok = loadGame();
    if (!ok) return alert("저장 데이터가 없어!");
    render(textEl, namePlate, choicesEl);
    showToast("불러오기 완료!");
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("진짜 처음부터 할래? 저장도 삭제돼!")) return;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });

  // 모달 닫기
  closeModalBtn.addEventListener("click", closeModal);
  modalOkBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ESC로 닫기
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeOverlay("statusOverlay");
    closeModal();
  });
});
