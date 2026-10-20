const CFG_KEY = "ideas.cfg.v1";
const MSG_KEY = "ideas.msgs.v1";
const DEFAULT_CFG = { repo: "arctikasdiary-creator/ideas", branch: "main", token: "" };
const FILE = "ideas.json";
const API = "https://api.github.com";

const $ = (sel) => document.querySelector(sel);
const els = {
  chat: $("#chat"),
  input: $("#input"),
  send: $("#btnSend"),
  status: $("#status"),
  sync: $("#btnSync"),
  settings: $("#btnSettings"),
  sheet: $("#settings"),
  cfgRepo: $("#cfgRepo"),
  cfgBranch: $("#cfgBranch"),
  cfgToken: $("#cfgToken"),
  btnEye: $("#btnEye"),
  btnClose: $("#btnClose"),
  btnCheck: $("#btnCheck"),
  btnExport: $("#btnExport"),
  sheetMsg: $("#sheetMsg"),
  toast: $("#toast"),
  install: $("#install"),
  installText: $("#installText"),
  btnInstall: $("#btnInstall"),
  btnInstallClose: $("#btnInstallClose"),
};

let cfg = loadCfg();
let msgs = loadMsgs();
let syncing = false;
let syncQueued = false;
let deferredPrompt = null;

function loadCfg() {
  try {
    return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function loadMsgs() {
  try {
    const list = JSON.parse(localStorage.getItem(MSG_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveMsgs() {
  localStorage.setItem(MSG_KEY, JSON.stringify(msgs));
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.dataset.kind = kind || "idle";
}

const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const fmtDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const fmtDayYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
const fmtKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow" });

function dayLabel(date) {
  const now = new Date();
  const key = fmtKey.format(date);
  if (key === fmtKey.format(now)) return "Сегодня";
  if (key === fmtKey.format(new Date(now.getTime() - 86400000))) return "Вчера";
  return (date.getFullYear() === now.getFullYear() ? fmtDay : fmtDayYear).format(date);
}

function emptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty";
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>' +
    "<h2>Здесь появятся идеи</h2>" +
    "<p>Пиши сюда, даже когда компьютер выключен — идеи сохранятся и дойдут до меня, когда он включится.</p>";
  return wrap;
}

function messageEl(m) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (m.role === "user" ? "user" : "agent");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = m.text;
  const meta = document.createElement("div");
  meta.className = "meta";
  const time = document.createElement("span");
  time.textContent = fmtTime.format(new Date(m.ts));
  meta.appendChild(time);
  if (m.role === "user") {
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = m.pending ? "…" : m.read ? "✓✓" : "✓";
    mark.title = m.pending ? "Не отправлено" : m.read ? "Прочитано" : "Доставлено";
    meta.appendChild(mark);
  }
  wrap.append(bubble, meta);
  return wrap;
}

function render(forceScroll) {
  const chat = els.chat;
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  chat.innerHTML = "";
  const list = [...msgs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!list.length) {
    chat.appendChild(emptyState());
    els.send.disabled = !els.input.value.trim();
    return;
  }
  let lastDay = "";
  for (const m of list) {
    const date = new Date(m.ts);
    const key = fmtKey.format(date);
    if (key !== lastDay) {
      lastDay = key;
      const sep = document.createElement("div");
      sep.className = "day";
      sep.textContent = dayLabel(date);
      chat.appendChild(sep);
    }
    chat.appendChild(messageEl(m));
  }
  if (forceScroll || nearBottom) {
    requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
    });
  }
  els.send.disabled = !els.input.value.trim();
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64decode(text) {
  const bin = atob(String(text).replace(/\s+/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function api(target, method, path, body) {
  const res = await fetch(`${API}/repos/${target.repo}/${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${target.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return { notFound: true };
  if (res.status === 409) return { conflict: true };
  if (!res.ok) {
    if (res.status === 401) throw new Error("Токен не подходит");
    if (res.status === 403) throw new Error("Нет доступа: проверь права токена");
    throw new Error(`GitHub API ${res.status}`);
  }
  return res.json();
}

async function fetchRemote(target) {
  const r = await api(target, "GET", `contents/${FILE}?ref=${encodeURIComponent(target.branch)}`);
  if (r.notFound) return { sha: null, messages: [] };
  let data;
  try {
    data = JSON.parse(b64decode(r.content || ""));
  } catch {
    data = {};
  }
  return { sha: r.sha, messages: Array.isArray(data.messages) ? data.messages : [] };
}

async function putRemote(target, messages, sha) {
  const doc = { schema: 1, updated: new Date().toISOString(), messages };
  const body = {
    message: `idea sync ${new Date().toISOString()}`,
    content: b64encode(JSON.stringify(doc, null, 2)),
    branch: target.branch,
  };
  if (sha) body.sha = sha;
  const r = await api(target, "PUT", `contents/${FILE}`, body);
  if (r.conflict) return { conflict: true };
  if (r.notFound) throw new Error("Нет доступа к репозиторию или файлу");
  return { ok: true };
}

function hasPending() {
  return msgs.some((m) => m.pending);
}

async function sync() {
  if (syncing) {
    syncQueued = true;
    return;
  }
  if (!cfg.token) {
    setStatus("Не настроено — открой настройки", "warn");
    return;
  }
  if (!navigator.onLine) {
    setStatus(hasPending() ? "Нет сети — идеи сохранены" : "Нет сети", "warn");
    return;
  }
  syncing = true;
  setStatus("Синхронизация…", "busy");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote(cfg);
      const known = new Set(remote.messages.map((m) => m.id));
      const pending = msgs
        .filter((m) => m.pending && !known.has(m.id))
        .map(({ id, text, ts }) => ({ id, role: "user", text, ts, read: false }));
      let result = remote.messages;
      if (pending.length || !remote.sha) {
        const merged = [...remote.messages, ...pending].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
        const res = await putRemote(cfg, merged, remote.sha);
        if (res.conflict) {
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
          continue;
        }
        result = merged;
        try {
          const after = await fetchRemote(cfg);
          if (after.sha) result = after.messages;
        } catch {
          result = merged;
        }
      }
      msgs = result.map((m) => ({ ...m, pending: false }));
      saveMsgs();
      render();
      setStatus(hasPending() ? "Есть неотправленные" : "Синхронизировано", hasPending() ? "warn" : "ok");
      return;
    }
    setStatus("Конфликт записи — попробую позже", "warn");
  } catch (e) {
    setStatus(e.message || "Ошибка синхронизации", "error");
  } finally {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      setTimeout(sync, 400);
    }
  }
}

function send() {
  const text = els.input.value.trim();
  if (!text) return;
  if (text.length > 20000) {
    toast("Слишком длинная идея");
    return;
  }
  els.input.value = "";
  resizeInput();
  msgs.push({ id: uid(), role: "user", text, ts: new Date().toISOString(), read: false, pending: true });
  saveMsgs();
  render(true);
  sync();
}

function resizeInput() {
  const el = els.input;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 130) + "px";
  els.send.disabled = !el.value.trim();
}

function openSettings() {
  els.cfgRepo.value = cfg.repo;
  els.cfgBranch.value = cfg.branch;
  els.cfgToken.value = cfg.token;
  els.cfgToken.type = "password";
  els.btnEye.textContent = "Показать";
  els.sheetMsg.textContent = "";
  els.sheet.classList.remove("hidden");
  document.body.classList.add("locked");
}

function closeSettings() {
  cfg = {
    repo: els.cfgRepo.value.trim() || DEFAULT_CFG.repo,
    branch: els.cfgBranch.value.trim() || "main",
    token: els.cfgToken.value.trim(),
  };
  saveCfg();
  els.sheet.classList.add("hidden");
  document.body.classList.remove("locked");
  if (cfg.token) sync();
  else setStatus("Не настроено — открой настройки", "warn");
}

async function checkConnection() {
  const test = {
    repo: els.cfgRepo.value.trim() || DEFAULT_CFG.repo,
    branch: els.cfgBranch.value.trim() || "main",
    token: els.cfgToken.value.trim(),
  };
  if (!test.token) {
    els.sheetMsg.textContent = "Вставь токен";
    return;
  }
  els.sheetMsg.textContent = "Проверяю…";
  try {
    const r = await fetchRemote(test);
    els.sheetMsg.textContent = r.sha
      ? `Связь есть. Сообщений в облаке: ${r.messages.length}`
      : "Файл не найден или нет доступа к репозиторию";
  } catch (e) {
    els.sheetMsg.textContent = e.message;
  }
}

function exportJson() {
  const clean = msgs.map(({ pending, ...m }) => m);
  const blob = new Blob([JSON.stringify({ schema: 1, updated: new Date().toISOString(), messages: clean }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ideas.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

els.send.addEventListener("click", send);
els.input.addEventListener("input", resizeInput);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
els.sync.addEventListener("click", () => sync());
els.settings.addEventListener("click", openSettings);
els.btnClose.addEventListener("click", closeSettings);
els.btnCheck.addEventListener("click", checkConnection);
els.btnExport.addEventListener("click", exportJson);
els.btnEye.addEventListener("click", () => {
  const show = els.cfgToken.type === "password";
  els.cfgToken.type = show ? "text" : "password";
  els.btnEye.textContent = show ? "Скрыть" : "Показать";
});
els.sheet.addEventListener("click", (e) => {
  if (e.target === els.sheet) closeSettings();
});

window.addEventListener("online", () => {
  if (cfg.token) sync();
});
window.addEventListener("offline", () => {
  setStatus(hasPending() ? "Нет сети — идеи сохранены" : "Нет сети", "warn");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cfg.token) sync();
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function showInstallHint() {
  if (isStandalone() || localStorage.getItem("ideas.installDismissed") === "1") return;
  const ua = navigator.userAgent;
  const inApp = /\bwv\b\)/.test(ua) || /Telegram|Instagram|FBAN|FBAV/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  els.install.classList.remove("hidden");
  els.btnInstall.classList.toggle("hidden", !deferredPrompt);
  if (deferredPrompt) {
    els.installText.textContent = "Установить приложение на телефон?";
  } else if (inApp) {
    els.installText.textContent = "Открой ссылку в браузере (меню → «Открыть в браузере»), затем установи приложение.";
  } else if (isIOS) {
    els.installText.textContent = "Установка на iPhone: «Поделиться» → «На экран „Домой“».";
  } else if (isAndroid) {
    els.installText.textContent = "Установка: меню Chrome (⋮) → «Установить приложение» (или «Добавить на главный экран»).";
  } else {
    els.installText.textContent = "Установка: значок установки в адресной строке Chrome.";
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallHint();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  els.install.classList.add("hidden");
});

els.btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.install.classList.add("hidden");
});

els.btnInstallClose.addEventListener("click", () => {
  els.install.classList.add("hidden");
  localStorage.setItem("ideas.installDismissed", "1");
});

setTimeout(showInstallHint, 1200);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

setInterval(() => {
  if (document.visibilityState === "visible" && navigator.onLine && cfg.token) sync();
}, 45000);

render();
resizeInput();
sync();
