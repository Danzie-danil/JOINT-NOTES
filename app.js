// Family Ideas PWA - Vanilla JS + Supabase

/* =========================================
   Simple DOM helpers
========================================= */
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/* =========================================
   Global state
========================================= */
const state = {
  route: "notes",
  session: null,
  user: null,
  familyId: null,
  families: [],
  books: [],
  notes: [],
  activities: [],
  members: [],
  chatOpenMemberId: null,
  supabase: null,
  theme: "dark",
  online: navigator.onLine,
  subscriptions: [],
  overlay: null,
  overlayDismissible: true,
  overlayPrevHeader: null,
  currentRole: null,
  authMode: localStorage.getItem("pwa.auth.mode") || "member",
};

const STORAGE_KEYS = {
  theme: "pwa.theme",
  supabase: "pwa.supabase.config",
  cacheNotes: (familyId) => `pwa.cache.notes.${familyId}`,
  cacheBooks: (familyId) => `pwa.cache.books.${familyId}`,
  cacheActivities: (familyId) => `pwa.cache.activities.${familyId}`,
  cacheMembers: (familyId) => `pwa.cache.members.${familyId}`,
  cacheMessages: (familyId, peerId) => `pwa.cache.messages.${familyId}.${peerId}`,
};

/* =========================================
   Toasts / banners
========================================= */
let toastTimer;
function showToast(msg, type = "info") {
  const t = qs("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2500);
}
function setOfflineBanner(visible) {
  qs("#offlineBanner").classList.toggle("hidden", !visible);
}

/* =========================================
   Theme handling
========================================= */
function applyTheme(theme) {
  state.theme = theme;
  const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = theme === "system" ? (sysDark ? "dark" : "light") : theme;
  document.body.classList.toggle("theme-light", effective === "light");
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  const themeColor = effective === "light" ? "#ffffff" : "#000000";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor);
}
function toggleTheme() {
  const next = state.theme === "dark" ? "light" : state.theme === "light" ? "system" : "dark";
  applyTheme(next);
}

/* =========================================
   Service worker
========================================= */
async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("service-worker.js");
    } catch (err) {
      console.warn("SW registration failed", err);
    }
  }
}

/* =========================================
   Drawer
========================================= */
function openDrawer() {
  qs("#drawer").classList.add("open");
  qs("#drawerBackdrop").classList.add("open");
}
function closeDrawer() {
  qs("#drawer").classList.remove("open");
  qs("#drawerBackdrop").classList.remove("open");
}

/* =========================================
   Overlay modal + back navigation
========================================= */
function openOverlay(title, buildContent, dismissible = true) {
  const modal = qs("#modalLayer");
  const content = qs("#modalContent");
  content.innerHTML = "";
  const header = el("div", "detail-header");
  const htitle = el("div", "detail-title");
  htitle.textContent = title;
  const closeBtn = el("button", "icon-btn");
  closeBtn.textContent = "✕";
  header.append(closeBtn, htitle);
  content.append(header);
  buildContent(content);
  modal.classList.remove("hidden");
  state.overlay = title;
  state.overlayDismissible = !!dismissible;
  state.overlayPrevHeader = qs("#headerTitle").textContent;
  qs("#headerTitle").textContent = `${state.overlayPrevHeader} · ${title}`;
  closeBtn.onclick = () => closeOverlay(true);
  modal.onclick = (e) => {
    if (!state.overlayDismissible) return;
    if (e.target === modal) closeOverlay(true);
  };
  const focusable = content.querySelector("input,textarea,select,[contenteditable='true'],button");
  if (focusable) try { focusable.focus(); } catch {}
  window.addEventListener("keydown", handleEscToClose);
  history.pushState({ kind: "overlay", title }, "");
}
function handleEscToClose(e) {
  if (e.key === "Escape" && state.overlay) {
    closeOverlay(true);
  }
}
function closeOverlay(fromUi = false) {
  if (!state.overlay) return;
  const modal = qs("#modalLayer");
  modal.classList.add("hidden");
  state.overlay = null;
  qs("#headerTitle").textContent = state.overlayPrevHeader || qs("#headerTitle").textContent;
  window.removeEventListener("keydown", handleEscToClose);
  if (fromUi) {
    // Avoid navigating away if no matching history state
    const st = history.state;
    if (st && st.kind === "overlay") {
      history.back();
    }
  }
}
function pushDetailState(tag) {
  history.pushState({ kind: "detail", tag }, "");
}
window.addEventListener("popstate", () => {
  if (state.overlay) {
    // If overlay open, closing it on back
    const modal = qs("#modalLayer");
    modal.classList.add("hidden");
    state.overlay = null;
    qs("#headerTitle").textContent = state.overlayPrevHeader || qs("#headerTitle").textContent;
    window.removeEventListener("keydown", handleEscToClose);
    return;
  }
  // Close detail views if open
  const closes = [
    "#noteDetail",
    "#bookDetail",
    "#activityDetail",
    "#conversationView",
  ];
  for (const sel of closes) {
    const v = qs(sel);
    if (v && !v.classList.contains("hidden")) {
      if (sel === "#noteDetail") {
        const pending = qs("#editorInput").innerHTML.trim();
        if (pending && !confirm("Discard unsaved paragraph?")) {
          pushDetailState("note");
          return;
        }
      }
      v.classList.add("hidden");
      return;
    }
  }
});

/* =========================================
   Router / navigation
========================================= */
function setRoute(name) {
  state.route = name;
  qsa(".screen").forEach((s) => s.classList.remove("screen--active"));
  qs(`#screen-${name}`).classList.add("screen--active");
  qsa(".tab").forEach((t) => t.classList.toggle("active", t.dataset.route === name));
  qs("#headerTitle").textContent = name[0].toUpperCase() + name.slice(1);
  const tabs = qsa(".tab");
  const idx = tabs.findIndex((t) => t.dataset.route === name);
  const root = qs(".bottom-tabs");
  if (idx >= 0 && root) {
    root.style.setProperty("--tab-x", `${idx * 100}%`);
  }
}

/* =========================================
   Supabase setup
========================================= */
function getSupabaseConfig() {
  const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
  const metaAnon = document.querySelector('meta[name="supabase-anon"]')?.content?.trim();
  if (metaUrl && metaAnon) return { url: metaUrl, anon: metaAnon };
  const raw = localStorage.getItem(STORAGE_KEYS.supabase);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function ensureSupabaseConfigured() {
  const cfg = getSupabaseConfig();
  if (cfg && cfg.url && cfg.anon) {
    state.supabase = supabase.createClient(cfg.url, cfg.anon);
    return true;
  }
  return false;
}
function showSupabaseConfigModal() {
  openOverlay("Supabase Configuration", (content) => {
    const card = el("div", "list-item");
    const url = el("input");
    url.placeholder = "Supabase URL";
    url.value = getSupabaseConfig()?.url || "";
    const anon = el("input");
    anon.placeholder = "Supabase anon key";
    anon.value = getSupabaseConfig()?.anon || "";
    anon.type = "password";
    const actions = el("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    const save = el("button", "primary-btn");
    save.textContent = "Save";
    const cancel = el("button", "icon-btn");
    cancel.textContent = "Cancel";
    actions.append(save, cancel);
    card.append(url, anon, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    save.onclick = () => {
      const cfg = { url: url.value.trim(), anon: anon.value.trim() };
      localStorage.setItem(STORAGE_KEYS.supabase, JSON.stringify(cfg));
      closeOverlay(true);
      ensureSupabaseConfigured();
      attemptAuthBootstrap();
    };
  }, true);
}

/* =========================================
   Auth flow
========================================= */
function showAuthScreen() {
  setRoute("auth");
  qs("#bottomTabs").style.display = "none";
}
function showMainApp() {
  qs("#bottomTabs").style.display = "grid";
  setRoute("notes");
}
async function attemptAuthBootstrap() {
  if (!state.supabase) {
    attemptLocalBootstrap();
    return;
  }
  const { data } = await state.supabase.auth.getSession();
  state.session = data.session || null;
  state.user = state.session?.user || null;
  if (!state.session) {
    showAuthScreen();
  } else {
    showMainApp();
    await upsertProfile();
    await postLoginInit();
    const pending = localStorage.getItem("pwa.pendingJoinCode");
    if (pending) {
      await joinFamilyByCode(pending);
      localStorage.removeItem("pwa.pendingJoinCode");
    }
  }
  state.supabase.auth.onAuthStateChange((evt, session) => {
    state.session = session || null;
    state.user = session?.user || null;
    if (evt === "PASSWORD_RECOVERY") {
      openSetNewPassword();
      return;
    }
    if (state.user) {
      showMainApp();
      upsertProfile().then(postLoginInit);
      const pending = localStorage.getItem("pwa.pendingJoinCode");
      if (pending) {
        joinFamilyByCode(pending).then(() => {
          localStorage.removeItem("pwa.pendingJoinCode");
        });
      }
    } else {
      showAuthScreen();
    }
  });
}

/* =========================================
   Family management and post-login init
========================================= */
async function postLoginInit() {
  if (!state.supabase) {
    updateFamilyBadges();
    return;
  }
  await ensureFamilyContext();
  await loadAllData();
  bindRealtime();
}
async function ensureFamilyContext() {
  try {
    const { data: families, error } = await state.supabase
      .from("families")
      .select("id,name")
      .in(
        "id",
        (
          await state.supabase
            .from("family_members")
            .select("family_id")
            .eq("user_id", state.user.id)
        ).data?.map((x) => x.family_id) || []
      );
    if (error) throw error;
    state.families = families || [];
    if (!state.familyId) {
      state.familyId = state.families[0]?.id || null;
    }
    updateFamilyBadges();
    if (state.familyId && state.user) {
      await loadMembershipRole();
    }
    if (!state.familyId) {
      if (state.authMode === "member") openJoinByCode();
      else openFamilySwitcher();
    }
  } catch (e) {
    showToast("Failed to load families");
  }
}
async function localEnsureFamilyContext() {
  const families = lg("pwa.local.families", []);
  const mems = lg("pwa.local.family_members", []);
  const myMems = mems.filter((m) => m.user_id === state.user.id);
  if (!myMems.length && state.authMode === "manager") {
    const id = genId("fam");
    const join_code = randomCode(10);
    families.push({ id, name: "My Family", join_code });
    ls("pwa.local.families", families);
    mems.push({ family_id: id, user_id: state.user.id, role: "owner" });
    ls("pwa.local.family_members", mems);
  }
  const updatedMems = lg("pwa.local.family_members", []).filter((m) => m.user_id === state.user.id);
  state.families = lg("pwa.local.families", []).filter((f) =>
    updatedMems.some((m) => m.family_id === f.id)
  );
  if (!state.familyId) state.familyId = state.families[0]?.id || null;
  await loadMembershipRole();
  if (!state.familyId && state.authMode === "member") {
    openJoinByCode();
  }
}
function updateFamilyBadges() {
  const fam = state.families.find((f) => f.id === state.familyId);
  const roleName = state.currentRole ? (state.currentRole === "owner" ? "Owner" : "Member") : "—";
  const name = fam ? `Family: ${fam.name} · Role: ${roleName}` : "No Family";
  const ids = ["currentFamilyBadge", "booksFamilyBadge", "activitiesFamilyBadge"];
  ids.forEach((id) => {
    const elRef = qs(`#${id}`);
    if (elRef) elRef.textContent = name;
  });
}
function openFamilySwitcher() {
  openOverlay("Family Switcher / Management", (content) => {
    const card = el("div", "list-item");
    const list = el("div", "list");
    (state.families || []).forEach((fam) => {
      const item = el("button", "drawer-item");
      item.textContent = fam.name;
      item.onclick = () => {
        state.familyId = fam.id;
        updateFamilyBadges();
        closeOverlay(true);
        if (state.supabase) {
          loadAllData();
          rebindRealtime();
          loadMembershipRole();
        } else {
          localLoadAllData();
          loadMembershipRole();
        }
      };
      list.appendChild(item);
    });
    const createRow = el("div"); createRow.style.display = "grid"; createRow.style.gap = "8px";
    const nameInput = el("input"); nameInput.placeholder = "New family name";
    const createBtn = el("button", "primary-btn"); createBtn.textContent = "Create New Family";
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast("Enter a family name"); return; }
      if (!state.user) { showAuthScreen(); showToast("Sign in first"); return; }
      if (state.supabase) {
        try {
          const { data: fam, error } = await state.supabase
            .from("families")
            .insert({ name })
            .select()
            .single();
          if (error) throw error;
          await state.supabase
            .from("family_members")
            .insert({ family_id: fam.id, user_id: state.user.id, role: "owner" });
          state.families.push(fam);
          state.familyId = fam.id;
          updateFamilyBadges();
          closeOverlay(true);
          loadAllData();
          rebindRealtime();
          loadMembershipRole();
        } catch (e) {
          showToast("Failed to create family");
        }
      } else {
        const families = lg("pwa.local.families", []);
        const id = genId("fam");
        const fam = { id, name, join_code: randomCode(10) };
        families.push(fam);
        ls("pwa.local.families", families);
        const mems = lg("pwa.local.family_members", []);
        mems.push({ family_id: id, user_id: state.user.id, role: "owner" });
        ls("pwa.local.family_members", mems);
        state.families = families.filter((f) => mems.some((m) => m.family_id === f.id && m.user_id === state.user.id));
        state.familyId = id;
        updateFamilyBadges();
        closeOverlay(true);
        localLoadAllData();
        loadMembershipRole();
      }
    };
    createRow.append(nameInput, createBtn);
    card.append(list, createRow);
    content.append(card);
  }, true);
}

async function loadMembershipRole() {
  if (!state.supabase) {
    const mems = lg("pwa.local.family_members", []);
    const row = mems.find((m) => m.family_id === state.familyId && m.user_id === state.user.id);
    state.currentRole = row?.role || null;
    updateFamilyBadges();
    updateOwnerControls();
    return;
  }
  try {
    const { data } = await state.supabase
      .from("family_members")
      .select("role")
      .eq("family_id", state.familyId)
      .eq("user_id", state.user.id)
      .single();
    state.currentRole = data?.role || null;
    updateFamilyBadges();
    updateOwnerControls();
  } catch {
    state.currentRole = null;
    updateOwnerControls();
  }
}

function updateOwnerControls() {
  const isOwner = state.currentRole === "owner";
  const shareBtn = qs("#btnShareJoinCode");
  const reviewBtn = qs("#btnReviewRequests");
  if (shareBtn) shareBtn.disabled = !isOwner;
  if (reviewBtn) reviewBtn.disabled = !isOwner;
}

/* =========================================
   Data loading and caching
========================================= */
async function loadAllData() {
  await Promise.all([
    loadBooks(),
    loadNotes(),
    loadActivities(),
    loadMembers(),
  ]);
}
async function localLoadAllData() {
  const fid = state.familyId;
  state.books = lg("pwa.local.books", []).filter((x) => x.family_id === fid);
  state.notes = lg("pwa.local.notes", []).filter((x) => x.family_id === fid);
  state.activities = lg("pwa.local.activities", []).filter((x) => x.family_id === fid);
  await loadMembers();
  renderBooksScreen();
  renderNotesScreen();
  renderActivitiesScreen();
}
async function safeFetch(fn, cacheKey) {
  try {
    const res = await fn();
    localStorage.setItem(cacheKey, JSON.stringify(res || []));
    setOfflineBanner(false);
    return res || [];
  } catch (e) {
    setOfflineBanner(true);
    const cached = localStorage.getItem(cacheKey);
    return cached ? JSON.parse(cached) : [];
  }
}
async function loadBooks() {
  const books = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("books")
      .select("*")
      .eq("family_id", state.familyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheBooks(state.familyId));
  state.books = books;
  renderBooksScreen();
}
async function loadNotes() {
  const notes = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("notes")
      .select("*")
      .eq("family_id", state.familyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheNotes(state.familyId));
  state.notes = notes;
  renderNotesScreen();
}
async function loadActivities() {
  const items = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("activities")
      .select("*")
      .eq("family_id", state.familyId)
      .order("datetime", { ascending: false });
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheActivities(state.familyId));
  state.activities = items;
  renderActivitiesScreen();
}
async function loadMembers() {
  if (!state.supabase) {
    const mems = lg("pwa.local.family_members", []).filter((m) => m.family_id === state.familyId);
    const users = lg("pwa.local.users", []);
    state.members = mems.map((m) => {
      const u = users.find((x) => x.id === m.user_id) || { id: m.user_id, display_name: m.user_id };
      return { id: u.id, display_name: u.display_name || u.email || u.id };
    });
    renderChatScreen();
    return;
  }
  const members = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .in(
        "id",
        (
          await state.supabase
            .from("family_members")
            .select("user_id")
            .eq("family_id", state.familyId)
        ).data?.map((x) => x.user_id) || []
      );
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheMembers(state.familyId));
  state.members = members;
  renderChatScreen();
}

/* =========================================
   Real-time subscriptions
========================================= */
function rebindRealtime() {
  state.subscriptions.forEach((c) => c.unsubscribe());
  state.subscriptions = [];
  bindRealtime();
}
function bindRealtime() {
  if (!state.supabase || !state.familyId) return;
  const chParagraphs = state.supabase
    .channel(`rt-paragraphs-${state.familyId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "paragraphs", filter: `family_id=eq.${state.familyId}` },
      () => {
        if (state.route === "notes") loadNotes();
      }
    )
    .subscribe();
  const chActivities = state.supabase
    .channel(`rt-activities-${state.familyId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "activities", filter: `family_id=eq.${state.familyId}` },
      () => {
        if (state.route === "activities") loadActivities();
      }
    )
    .subscribe();
  const chMessages = state.supabase
    .channel(`rt-messages-${state.familyId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `family_id=eq.${state.familyId}` },
      (payload) => {
        if (state.route === "chat") {
          if (state.chatOpenMemberId) {
            loadConversation(state.chatOpenMemberId);
          } else {
            renderChatScreen();
          }
        }
      }
    )
    .subscribe();
  const chRequests = state.supabase
    .channel(`rt-requests-${state.familyId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "family_access_requests", filter: `family_id=eq.${state.familyId}` },
      () => {
        if (state.currentRole === "owner") {
          // no-op unless overlay is open; owner can refresh manually
        }
      }
    )
    .subscribe();
  state.subscriptions.push(chParagraphs, chActivities, chMessages, chRequests);
}

/* =========================================
   Utilities
========================================= */
function truncateLines(html, maxLines = 5) {
  const tmp = el("div");
  tmp.innerHTML = html || "";
  const text = tmp.textContent || "";
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${out}…` : out;
}
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
function formatDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function firstDefined(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}
function randomCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function genId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}
function lg(key, def = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch {
    return def;
  }
}
function ls(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}
function getNoteReactions(noteId) {
  const recs = lg("pwa.local.note_reactions", []);
  const counts = { "👍": 0, "👎": 0, "❤️": 0 };
  recs.filter((r) => r.note_id === noteId).forEach((r) => {
    if (counts[r.emoji] !== undefined) counts[r.emoji]++;
  });
  return counts;
}
function getMyNoteReaction(noteId) {
  const recs = lg("pwa.local.note_reactions", []);
  const r = recs.find((x) => x.note_id === noteId && x.user_id === (state.user?.id || "anon"));
  return r?.emoji || null;
}
function setMyNoteReaction(noteId, emoji) {
  const userId = state.user?.id || "anon";
  const recs = lg("pwa.local.note_reactions", []);
  const idx = recs.findIndex((x) => x.note_id === noteId && x.user_id === userId);
  if (idx >= 0) {
    if (recs[idx].emoji === emoji) recs.splice(idx, 1);
    else recs[idx].emoji = emoji;
  } else {
    recs.push({ id: genId("react"), note_id: noteId, user_id: userId, emoji });
  }
  ls("pwa.local.note_reactions", recs);
}

/* =========================================
   Notes screen
========================================= */
function renderNotesScreen() {
  const list = qs("#notesList");
  list.innerHTML = "";
  const hasData = (state.notes || []).length > 0;
  const emptyMsg = qs("#notesEmpty");
  if (emptyMsg) emptyMsg.classList.toggle("hidden", hasData);
  const term = qs("#notesSearchInput")?.value?.toLowerCase() || "";
  const items = (state.notes || []).filter((n) =>
    !term ||
    (n.title?.toLowerCase().includes(term))
  );
  if (!items.length && hasData) {
    const empty = el("div", "list-item skeleton");
    empty.textContent = "No notes found";
    list.appendChild(empty);
    return;
  }
  items.forEach((note) => {
    const item = el("div", "list-item");
    const title = el("div", "title");
    title.textContent = note.title;
    const meta = el("div", "meta");
    meta.textContent = `Book: ${state.books.find((b) => b.id === note.book_id)?.title || "—"} `;
    const preview = el("div", "preview");
    preview.textContent = state.supabase ? "Loading preview…" : (note.preview || "—");
    item.append(title, meta, preview);
    item.onclick = () => openNoteDetail(note, { showTitle: false });
    title.onclick = (e) => { e.stopPropagation(); openNoteDetail(note, { showTitle: true }); };
    list.appendChild(item);
    if (state.supabase) {
      state.supabase
        .from("paragraphs")
        .select("content_html")
        .eq("note_id", note.id)
        .order("created_at", { ascending: true })
        .limit(10)
        .then(({ data }) => {
          const join = (data || []).map((p) => truncateLines(p.content_html || "", 5)).join("\n");
          preview.textContent = join || "No content yet";
        }).catch(() => {
          preview.textContent = "Preview unavailable";
        });
    }
  });
}
async function openNoteDetail(note, opts = {}) {
  qs("#noteDetail").classList.remove("hidden");
  const showTitle = opts.showTitle !== false;
  qs("#noteTitleView").textContent = note.title;
  qs("#noteTitleView").style.display = showTitle ? "" : "none";
  qs("#editorInput").innerHTML = "";
  await loadParagraphs(note.id);
  pushDetailState("note");
  qs("#btnSaveParagraph").onclick = () => saveParagraph(note.id);
  qs("#btnCloseNote").onclick = () => {
    const pending = qs("#editorInput").innerHTML.trim();
    if (pending) {
      if (!confirm("Discard unsaved paragraph?")) return;
    }
    qs("#noteDetail").classList.add("hidden");
    history.back();
  };
  qsa(".toolbar button").forEach((b) => {
    b.onclick = () => document.execCommand(b.dataset.cmd, false, null);
  });
}
async function loadParagraphs(noteId) {
  const box = qs("#paragraphs");
  box.innerHTML = "";
  if (!state.supabase) {
    const paras = lg("pwa.local.paragraphs", [])
      .filter((p) => p.note_id === noteId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    (paras || []).forEach((p) => {
      const wrap = el("div", "paragraph");
      const body = el("div");
      body.innerHTML = p.content_html;
      const signature = el("span", "note-author-signature");
      signature.textContent = ` — ${p.author_name || "Unknown"}`;
      wrap.append(body, signature);
      box.appendChild(wrap);
    });
    return;
  }
  try {
    const { data, error } = await state.supabase
      .from("paragraphs")
      .select("id,content_html,author_id,author_name,created_at")
      .eq("note_id", noteId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    (data || []).forEach((p) => {
      const wrap = el("div", "paragraph");
      const body = el("div");
      body.innerHTML = p.content_html;
      const signature = el("span", "note-author-signature");
      signature.textContent = ` — ${p.author_name || "Unknown"}`;
      const actions = el("div", "paragraph-actions");
      const canEdit = p.author_id === state.user.id;
      if (canEdit) {
        const edit = el("button", "icon-btn");
        edit.textContent = "Edit";
        const del = el("button", "icon-btn");
        del.textContent = "Delete";
        edit.onclick = () => editParagraph(p);
        del.onclick = () => deleteParagraph(p);
        actions.append(edit, del);
      }
      wrap.append(body, signature, actions);
      box.appendChild(wrap);
    });
  } catch {
    showToast("Failed to load paragraphs");
  }
}
async function saveParagraph(noteId) {
  const html = qs("#editorInput").innerHTML.trim();
  if (!html) {
    showToast("Write something first");
    return;
  }
  if (!state.supabase) {
    const paras = lg("pwa.local.paragraphs", []);
    paras.push({
      id: genId("para"),
      note_id: noteId,
      family_id: state.familyId,
      author_id: state.user.id,
      author_name: state.user.user_metadata?.full_name || state.user.email,
      content_html: html,
      created_at: new Date().toISOString(),
    });
    ls("pwa.local.paragraphs", paras);
    qs("#editorInput").innerHTML = "";
    await loadParagraphs(noteId);
    showToast("Paragraph added");
    return;
  }
  try {
    const { error } = await state.supabase.from("paragraphs").insert({
      note_id: noteId,
      family_id: state.familyId,
      author_id: state.user.id,
      author_name: state.user.user_metadata?.full_name || state.user.email,
      content_html: html,
    });
    if (error) throw error;
    qs("#editorInput").innerHTML = "";
    await loadParagraphs(noteId);
    showToast("Paragraph added");
  } catch (e) {
    showToast("Failed to save paragraph");
  }
}
function editParagraph(p) {
  openOverlay("Edit Paragraph", (content) => {
    const card = el("div", "list-item");
    const input = el("div", "editor-input");
    input.contentEditable = "true";
    input.innerHTML = p.content_html;
    const actions = el("div", "editor-actions");
    const save = el("button", "primary-btn");
    save.textContent = "Save";
    const cancel = el("button", "icon-btn");
    cancel.textContent = "Cancel";
    actions.append(save, cancel);
    card.append(input, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    save.onclick = async () => {
      try {
        const { error } = await state.supabase
          .from("paragraphs")
          .update({ content_html: input.innerHTML })
          .eq("id", p.id)
          .eq("author_id", state.user.id);
        if (error) throw error;
        closeOverlay(true);
        showToast("Updated");
        await loadParagraphs(p.note_id);
      } catch {
        showToast("Permission denied or failed");
      }
    };
  }, true);
}
async function deleteParagraph(p) {
  if (!confirm("Delete this paragraph?")) return;
  try {
    const { error } = await state.supabase
      .from("paragraphs")
      .delete()
      .eq("id", p.id)
      .eq("author_id", state.user.id);
    if (error) throw error;
    showToast("Deleted");
    await loadParagraphs(p.note_id);
  } catch {
    showToast("Permission denied or failed");
  }
}

/* =========================================
   New Note flow
========================================= */
function openNewNoteModal() {
  const host = qs("#notesInlineForm");
  host.classList.remove("hidden");
  host.innerHTML = "";
  const card = el("div", "form-card");
  const row1 = el("div", "form-row");
  const inputTitle = el("input"); inputTitle.placeholder = "Title";
  const bookSelect = el("select");
  state.books.forEach((b) => {
    const opt = el("option"); opt.value = b.id; opt.textContent = b.title;
    bookSelect.appendChild(opt);
  });
  row1.append(inputTitle, bookSelect);
  const firstPara = el("div", "editor-input"); firstPara.contentEditable = "true"; firstPara.placeholder = "First paragraph";
  const actions = el("div", "form-actions");
  const create = el("button", "primary-btn"); create.textContent = "Create";
  const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
  actions.append(create, cancel);
  card.append(row1, firstPara, actions);
  host.append(card);
  cancel.onclick = () => { host.classList.add("hidden"); host.innerHTML = ""; };
  create.onclick = async () => {
    if (!inputTitle.value.trim() || !bookSelect.value) {
      showToast("Title & book required");
      return;
    }
    if (state.supabase) {
      try {
        const { data: note, error } = await state.supabase
          .from("notes")
          .insert({
            family_id: state.familyId,
            book_id: bookSelect.value,
            title: inputTitle.value.trim(),
            created_by: state.user.id,
          })
          .select()
          .single();
        if (error) throw error;
        if (firstPara.innerHTML.trim()) {
          await state.supabase.from("paragraphs").insert({
            note_id: note.id,
            family_id: state.familyId,
            author_id: state.user.id,
            author_name: state.user.user_metadata?.full_name || state.user.email,
            content_html: firstPara.innerHTML.trim(),
          });
        }
        host.classList.add("hidden"); host.innerHTML = "";
        await loadNotes();
        openNoteDetail(note);
        showToast("Note created");
      } catch {
        showToast("Failed to create note");
      }
    } else {
      if (!state.familyId) { showToast("Create/select a family first"); return; }
      const notes = lg("pwa.local.notes", []);
      const id = genId("note");
      const preview = truncateLines(firstPara.innerHTML.trim(), 5);
      const note = {
        id,
        family_id: state.familyId,
        book_id: bookSelect.value,
        title: inputTitle.value.trim(),
        created_by: state.user.id,
        preview,
        created_at: new Date().toISOString(),
      };
      notes.unshift(note);
      ls("pwa.local.notes", notes);
      if (firstPara.innerHTML.trim()) {
        const paras = lg("pwa.local.paragraphs", []);
        paras.push({
          id: genId("para"),
          note_id: id,
          family_id: state.familyId,
          author_id: state.user.id,
          author_name: state.user.user_metadata?.full_name || state.user.email,
          content_html: firstPara.innerHTML.trim(),
          created_at: new Date().toISOString(),
        });
        ls("pwa.local.paragraphs", paras);
      }
      host.classList.add("hidden"); host.innerHTML = "";
      await localLoadAllData();
      openNoteDetail(note);
      showToast("Note created");
    }
  };
}

/* =========================================
   Books screen
========================================= */
function renderBooksScreen() {
  const list = qs("#booksList");
  list.innerHTML = "";
  const hasData = (state.books || []).length > 0;
  const emptyMsg = qs("#booksEmpty");
  if (emptyMsg) emptyMsg.classList.toggle("hidden", hasData);
  const term = qs("#booksSearchInput")?.value?.toLowerCase() || "";
  const items = (state.books || []).filter((b) =>
    !term ||
    (b.title?.toLowerCase().includes(term)) ||
    (firstDefined(b, ["description", "desc", "summary"]).toLowerCase().includes(term))
  );
  if (!items.length && hasData) {
    const empty = el("div", "list-item skeleton");
    empty.textContent = "No books found";
    list.appendChild(empty);
    return;
  }
  items.forEach((book) => {
    const item = el("div", "list-item");
    const title = el("div", "title");
    title.textContent = book.title;
    const meta = el("div", "meta");
    meta.textContent = firstDefined(book, ["description", "desc", "summary"]) || "";
    const stat = el("div", "preview");
    stat.textContent = state.supabase ? "Loading stats…" : `${(state.notes || []).filter((n) => n.book_id === book.id).length} linked notes`;
    item.append(title, meta, stat);
    item.onclick = () => openBookDetail(book);
    list.appendChild(item);
    if (state.supabase) {
      state.supabase
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("book_id", book.id)
        .then(({ count }) => {
          stat.textContent = `${count || 0} linked notes`;
        }).catch(() => {
          stat.textContent = "—";
        });
    }
  });
}
function openBookDetail(book) {
  qs("#bookDetail").classList.remove("hidden");
  qs("#bookTitleView").textContent = book.title;
  qs("#bookDescriptionView").textContent = firstDefined(book, ["description", "desc", "summary"]) || "";
  pushDetailState("book");
  const list = qs("#bookNotesList");
  list.innerHTML = "";
  const notes = state.notes.filter((n) => n.book_id === book.id);
  notes.forEach((note) => {
    const item = el("div", "list-item");
    const title = el("div", "title");
    title.textContent = note.title;
    const prev = el("div", "preview");
    prev.textContent = state.supabase ? "Loading preview…" : (note.preview || "—");
    item.append(title, prev);
    const reactionsWrap = el("div");
    function renderBar() {
      reactionsWrap.innerHTML = "";
      const bar = el("div", "reaction-bar");
      const counts = getNoteReactions(note.id);
      ["👍", "👎", "❤️"].forEach((em) => {
        const btn = el("button", "icon-btn");
        const mine = getMyNoteReaction(note.id) === em ? " • You" : "";
        btn.textContent = `${em} ${counts[em] || 0}${mine}`;
        btn.onclick = () => { setMyNoteReaction(note.id, em); renderBar(); };
        bar.appendChild(btn);
      });
      reactionsWrap.appendChild(bar);
    }
    renderBar();
    item.appendChild(reactionsWrap);
    list.appendChild(item);
    if (state.supabase) {
      state.supabase
        .from("paragraphs")
        .select("content_html")
        .eq("note_id", note.id)
        .order("created_at", { ascending: true })
        .limit(10)
        .then(({ data }) => {
          const join = (data || []).map((p) => truncateLines(p.content_html || "", 5)).join("\n");
          prev.textContent = join || "No content yet";
        }).catch(() => {
          prev.textContent = "Preview unavailable";
        });
    }
  });
  qs("#btnCloseBook").onclick = () => qs("#bookDetail").classList.add("hidden");
  qs("#btnCloseBook").onclick = () => { qs("#bookDetail").classList.add("hidden"); history.back(); };
}
function openCreateBookModal() {
  const host = qs("#booksInlineForm");
  host.classList.remove("hidden");
  host.innerHTML = "";
  const card = el("div", "form-card");
  const row = el("div", "form-row");
  const inputTitle = el("input"); inputTitle.placeholder = "Title";
  const inputDesc = el("input"); inputDesc.placeholder = "Description (optional)";
  row.append(inputTitle, inputDesc);
  const actions = el("div", "form-actions");
  const create = el("button", "primary-btn"); create.textContent = "Create";
  const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
  actions.append(create, cancel);
  card.append(row, actions);
  host.append(card);
  cancel.onclick = () => { host.classList.add("hidden"); host.innerHTML = ""; };
  create.onclick = async () => {
    if (!inputTitle.value.trim()) {
      showToast("Title is required");
      return;
    }
    if (state.supabase) {
      try {
        await state.supabase.from("books").insert({
          family_id: state.familyId,
          title: inputTitle.value.trim(),
          description: inputDesc.value.trim(),
        });
        host.classList.add("hidden"); host.innerHTML = "";
        await loadBooks();
        showToast("Book created");
      } catch {
        showToast("Failed to create book");
      }
    } else {
      if (!state.familyId) {
        showToast("Create/select a family first");
        return;
      }
      const books = lg("pwa.local.books", []);
      const id = genId("book");
      books.unshift({
        id,
        family_id: state.familyId,
        title: inputTitle.value.trim(),
        description: inputDesc.value.trim(),
        created_at: new Date().toISOString(),
      });
      ls("pwa.local.books", books);
      host.classList.add("hidden"); host.innerHTML = "";
      await localLoadAllData();
      showToast("Book created");
    }
  };
}

/* =========================================
   Activities screen
========================================= */
function renderActivitiesScreen() {
  const list = qs("#activitiesList");
  list.innerHTML = "";
  const hasData = (state.activities || []).length > 0;
  const emptyMsg = qs("#activitiesEmpty");
  if (emptyMsg) emptyMsg.classList.toggle("hidden", hasData);
  const term = qs("#activitiesSearchInput")?.value?.toLowerCase() || "";
  const items = (state.activities || []).filter((a) =>
    !term ||
    (a.title?.toLowerCase().includes(term)) ||
    (firstDefined(a, ["description", "details", "desc"]).toLowerCase().includes(term)) ||
    (a.location?.toLowerCase().includes(term))
  );
  if (!items.length && hasData) {
    const empty = el("div", "list-item skeleton");
    empty.textContent = "No activities found";
    list.appendChild(empty);
    return;
  }
  items.forEach((a) => {
    const item = el("div", "list-item");
    const title = el("div", "title");
    title.textContent = a.title;
    const meta = el("div", "meta");
    meta.textContent = `${fmtTime(a.datetime)} ${a.location ? " • " + a.location : ""}`;
    const prev = el("div", "preview");
    prev.textContent = a.description || "";
    item.append(title, meta, prev);
    item.onclick = () => openActivityDetail(a);
    list.appendChild(item);
  });
}
async function openActivityDetail(a) {
  qs("#activityDetail").classList.remove("hidden");
  qs("#activityTitleView").textContent = a.title;
  qs("#activityInfo").textContent = `${fmtTime(a.datetime)} ${a.location ? " • " + a.location : ""}`;
  pushDetailState("activity");
  const linked = qs("#activityLinked");
  linked.innerHTML = "";
  if (state.supabase) {
    const notesRel = await state.supabase
      .from("activity_notes")
      .select("note_id")
      .eq("activity_id", a.id);
    const booksRel = await state.supabase
      .from("activity_books")
      .select("book_id")
      .eq("activity_id", a.id);
    (notesRel.data || []).forEach(({ note_id }) => {
      const n = state.notes.find((x) => x.id === note_id);
      if (!n) return;
      const b = el("button", "drawer-item");
      b.textContent = `Note: ${n.title}`;
      b.onclick = () => {
        setRoute("notes");
        openNoteDetail(n);
      };
      linked.appendChild(b);
    });
    (booksRel.data || []).forEach(({ book_id }) => {
      const bdata = state.books.find((x) => x.id === book_id);
      if (!bdata) return;
      const b = el("button", "drawer-item");
      b.textContent = `Book: ${bdata.title}`;
      b.onclick = () => {
        setRoute("books");
        openBookDetail(bdata);
      };
      linked.appendChild(b);
    });
  } else {
    const ans = lg("pwa.local.activity_notes", []);
    const abs = lg("pwa.local.activity_books", []);
    ans.filter((x) => x.activity_id === a.id).forEach(({ note_id }) => {
      const n = state.notes.find((x) => x.id === note_id);
      if (!n) return;
      const b = el("button", "drawer-item");
      b.textContent = `Note: ${n.title}`;
      b.onclick = () => {
        setRoute("notes");
        openNoteDetail(n);
      };
      linked.appendChild(b);
    });
    abs.filter((x) => x.activity_id === a.id).forEach(({ book_id }) => {
      const bdata = state.books.find((x) => x.id === book_id);
      if (!bdata) return;
      const b = el("button", "drawer-item");
      b.textContent = `Book: ${bdata.title}`;
      b.onclick = () => {
        setRoute("books");
        openBookDetail(bdata);
      };
      linked.appendChild(b);
    });
  }
  qs("#btnCloseActivity").onclick = () => { qs("#activityDetail").classList.add("hidden"); history.back(); };
}
function openCreateActivityModal() {
  const host = qs("#activitiesInlineForm");
  host.classList.remove("hidden");
  host.innerHTML = "";
  const card = el("div", "form-card");
  const rowTop = el("div", "form-row");
  const inputTitle = el("input"); inputTitle.placeholder = "Title";
  const inputDesc = el("input"); inputDesc.placeholder = "Description";
  rowTop.append(inputTitle, inputDesc);
  const rowMid = el("div", "form-row");
  const inputDate = el("input"); inputDate.type = "datetime-local";
  const inputLoc = el("input"); inputLoc.placeholder = "Location (optional)";
  const dateWrap = el("div", "input-with-icon");
  dateWrap.appendChild(inputDate);
  const dateIcon = el("button", "input-icon-btn"); dateIcon.type = "button"; dateIcon.textContent = "📅";
  dateIcon.onclick = () => openNativePicker(inputDate);
  dateWrap.appendChild(dateIcon);
  const quickBtn = el("button", "icon-btn"); quickBtn.textContent = "📅 Quick";
  quickBtn.onclick = () => openCalendarQuickSelect(inputDate);
  rowMid.append(dateWrap, inputLoc, quickBtn);
  const labNotes = el("div", "detail-subtitle"); labNotes.textContent = "Link Notes (Ctrl/Cmd+Click to multi-select)";
  const notePick = el("select"); notePick.multiple = true;
  state.notes.forEach((n) => {
    const opt = el("option"); opt.value = n.id; opt.textContent = n.title;
    notePick.appendChild(opt);
  });
  const labBooks = el("div", "detail-subtitle"); labBooks.textContent = "Link Books";
  const bookPick = el("select"); bookPick.multiple = true;
  state.books.forEach((b) => {
    const opt = el("option"); opt.value = b.id; opt.textContent = b.title;
    bookPick.appendChild(opt);
  });
  const actions = el("div", "form-actions");
  const create = el("button", "primary-btn"); create.textContent = "Create";
  const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
  actions.append(create, cancel);
  card.append(rowTop, rowMid, labNotes, notePick, labBooks, bookPick, actions);
  host.append(card);
  cancel.onclick = () => { host.classList.add("hidden"); host.innerHTML = ""; };
  create.onclick = async () => {
    if (!inputTitle.value.trim() || !inputDate.value) {
      showToast("Title & date/time required");
      return;
    }
    if (state.supabase) {
      try {
        const { data: a, error } = await state.supabase
          .from("activities")
          .insert({
            family_id: state.familyId,
            title: inputTitle.value.trim(),
            description: inputDesc.value.trim(),
            datetime: new Date(inputDate.value).toISOString(),
            location: inputLoc.value.trim(),
          })
          .select()
          .single();
        if (error) throw error;
        const notesSel = Array.from(notePick.selectedOptions).map((o) => o.value);
        const booksSel = Array.from(bookPick.selectedOptions).map((o) => o.value);
        if (notesSel.length) {
          await state.supabase.from("activity_notes").insert(
            notesSel.map((note_id) => ({ activity_id: a.id, note_id }))
          );
        }
        if (booksSel.length) {
          await state.supabase.from("activity_books").insert(
            booksSel.map((book_id) => ({ activity_id: a.id, book_id }))
          );
        }
        host.classList.add("hidden"); host.innerHTML = "";
        await loadActivities();
        openActivityDetail(a);
        showToast("Activity created");
      } catch {
        showToast("Failed to create activity");
      }
    } else {
      const activities = lg("pwa.local.activities", []);
      const id = genId("activity");
      activities.unshift({
        id,
        family_id: state.familyId,
        title: inputTitle.value.trim(),
        description: inputDesc.value.trim(),
        datetime: new Date(inputDate.value).toISOString(),
        location: inputLoc.value.trim(),
        created_at: new Date().toISOString(),
      });
      ls("pwa.local.activities", activities);
      const notesSel = Array.from(notePick.selectedOptions).map((o) => o.value);
      const booksSel = Array.from(bookPick.selectedOptions).map((o) => o.value);
      if (notesSel.length) {
        const ans = lg("pwa.local.activity_notes", []);
        notesSel.forEach((note_id) => ans.push({ activity_id: id, note_id }));
        ls("pwa.local.activity_notes", ans);
      }
      if (booksSel.length) {
        const abs = lg("pwa.local.activity_books", []);
        booksSel.forEach((book_id) => abs.push({ activity_id: id, book_id }));
        ls("pwa.local.activity_books", abs);
      }
      host.classList.add("hidden"); host.innerHTML = "";
      await localLoadAllData();
      const a = activities[0];
      openActivityDetail(a);
      showToast("Activity created");
    }
  };
}

/* =========================================
   Chat screen
========================================= */
function renderChatScreen() {
  const list = qs("#chatList");
  list.innerHTML = "";
  const term = qs("#chatSearchInput")?.value?.toLowerCase() || "";
  const baseMembers = (state.members || []).filter((m) => m.id !== state.user?.id);
  const hasData = baseMembers.length > 0;
  const emptyMsg = qs("#chatEmpty");
  if (emptyMsg) emptyMsg.classList.toggle("hidden", hasData);
  baseMembers
    .filter((m) =>
      !term ||
      (m.display_name?.toLowerCase().includes(term)) ||
      (m.id?.toLowerCase().includes(term))
    )
    .forEach((m) => {
      const item = el("div", "list-item");
      const title = el("div", "title");
      const initials = (m.display_name || "?")
        .split(" ")
        .map((x) => x[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      title.textContent = `${m.display_name || m.id} (${initials})`;
      const prev = el("div", "preview");
      prev.textContent = "—";
      item.append(title, prev);
      item.onclick = () => openConversation(m.id, m.display_name || m.id);
      list.appendChild(item);
      state.supabase
        .from("messages")
        .select("content,created_at")
        .eq("family_id", state.familyId)
        .or(`and(sender_id.eq.${state.user.id},receiver_id.eq.${m.id}),and(sender_id.eq.${m.id},receiver_id.eq.${state.user.id})`)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data[0]) {
            prev.textContent = `${data[0].content} • ${fmtTime(data[0].created_at)}`;
          }
        });
    });
  if (!baseMembers.filter((m) =>
    !term ||
    (m.display_name?.toLowerCase().includes(term)) ||
    (m.id?.toLowerCase().includes(term))
  ).length && hasData) {
    const empty = el("div", "list-item skeleton");
    empty.textContent = "No members found";
    list.appendChild(empty);
  }
}
async function loadConversation(peerId) {
  const { data, error } = await state.supabase
    .from("messages")
    .select("*")
    .eq("family_id", state.familyId)
    .or(`and(sender_id.eq.${state.user.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${state.user.id})`)
    .order("created_at", { ascending: true });
  if (error) {
    const cached = localStorage.getItem(STORAGE_KEYS.cacheMessages(state.familyId, peerId));
    const msgs = cached ? JSON.parse(cached) : [];
    renderConversation(peerId, msgs);
    return;
  }
  localStorage.setItem(STORAGE_KEYS.cacheMessages(state.familyId, peerId), JSON.stringify(data || []));
  renderConversation(peerId, data || []);
}
function renderConversation(peerId, messages) {
  const conv = qs("#conversationView");
  conv.classList.remove("hidden");
  state.chatOpenMemberId = peerId;
  const peer = state.members.find((m) => m.id === peerId);
  qs("#conversationTitle").textContent = peer?.display_name || peerId;
  const area = qs("#messagesArea");
  area.innerHTML = "";
  messages.forEach((msg) => {
    const b = el("div", "bubble");
    if (msg.sender_id === state.user.id) b.classList.add("me");
    b.innerHTML = linkify(msg.content || "");
    const t = el("div", "time");
    t.textContent = fmtTime(msg.created_at);
    b.appendChild(t);
    area.appendChild(b);
  });
  area.scrollTop = area.scrollHeight;
  const latestBtn = qs("#btnScrollLatest");
  if (latestBtn) {
    latestBtn.onclick = () => {
      area.scrollTop = area.scrollHeight;
    };
    area.onscroll = () => {
      const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 40;
      latestBtn.style.display = nearBottom ? "none" : "inline-block";
    };
    latestBtn.style.display = "none";
  }
  qs("#btnCloseConversation").onclick = () => {
    state.chatOpenMemberId = null;
    conv.classList.add("hidden");
  };
}
function openConversation(peerId, name) {
  setRoute("chat");
  pushDetailState("conversation");
  loadConversation(peerId);
}
async function sendMessage() {
  const input = qs("#messageInput");
  const content = input.value.trim();
  if (!content || !state.chatOpenMemberId) return;
  try {
    const { error } = await state.supabase.from("messages").insert({
      family_id: state.familyId,
      sender_id: state.user.id,
      receiver_id: state.chatOpenMemberId,
      content,
    });
    if (error) throw error;
    input.value = "";
    await loadConversation(state.chatOpenMemberId);
  } catch {
    showToast("Failed to send");
  }
}

/* =========================================
   Refresh & export
========================================= */
async function doRefresh() {
  await loadAllData();
  if (state.chatOpenMemberId) {
    await loadConversation(state.chatOpenMemberId);
  }
  showToast("Data refreshed");
}
async function exportProfileData() {
  try {
    const myId = state.user.id;
    const [myNotes, myParagraphs, myMessages, myActivities] = await Promise.all([
      state.supabase.from("notes").select("*").eq("created_by", myId),
      state.supabase.from("paragraphs").select("*").eq("author_id", myId),
      state.supabase.from("messages").select("*").eq("sender_id", myId),
      state.supabase.from("activities").select("*").eq("family_id", state.familyId),
    ]);
    const blob = new Blob(
      [JSON.stringify({
        profile: state.user,
        notesAuthored: myNotes.data || [],
        paragraphsAuthored: myParagraphs.data || [],
        messagesSent: myMessages.data || [],
        activitiesInFamily: myActivities.data || [],
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = "profile-export.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast("Export failed");
  }
}

/* =========================================
   Event bindings
========================================= */
function bindUI() {
  // Tabs
  qsa(".tab").forEach((t) => {
    t.onclick = () => setRoute(t.dataset.route);
  });
  // Tab indicator movement
  function updateTabIndicator() {
    const tabs = qsa(".tab");
    const idx = tabs.findIndex((t) => t.classList.contains("active"));
    const root = qs(".bottom-tabs");
    if (idx >= 0 && root) {
      root.style.setProperty("--tab-x", `${idx * 100}%`);
    }
  }
  updateTabIndicator();
  qsa(".tab").forEach((t) => t.addEventListener("click", updateTabIndicator));
  // Drawer
  qs("#btnDrawer").onclick = openDrawer;
  qs("#btnCloseDrawer").onclick = closeDrawer;
  qs("#drawerBackdrop").onclick = closeDrawer;
  qs("#btnThemeToggle").onclick = () => { toggleTheme(); closeDrawer(); };
  qs("#btnExport").onclick = () => { exportProfileData(); closeDrawer(); };
  qs("#btnRefresh").onclick = () => { doRefresh(); closeDrawer(); };
  qs("#btnHelp").onclick = () => {
    alert("Joint Notes\nCollaborative notes, books, activities, and chat.\nBuilt with Supabase.");
    closeDrawer();
  };
  qs("#btnSupabaseConfig").onclick = () => { showSupabaseConfigModal(); closeDrawer(); };
  qs("#btnFamilySwitcher").onclick = () => { openFamilySwitcher(); closeDrawer(); };
  const shareBtn = qs("#btnShareJoinCode");
  if (shareBtn) shareBtn.onclick = () => { openShareJoinCode(); closeDrawer(); };
  const joinBtn = qs("#btnJoinByCode");
  if (joinBtn) joinBtn.onclick = () => { openJoinByCode(); closeDrawer(); };
  const reviewBtn = qs("#btnReviewRequests");
  if (reviewBtn) reviewBtn.onclick = () => { openAccessRequests(); closeDrawer(); };
  const createFamBtn = qs("#btnCreateFamily");
  if (createFamBtn) createFamBtn.onclick = () => { openCreateFamily(); closeDrawer(); };
  const switchModeBtn = qs("#btnSwitchMode");
  if (switchModeBtn) switchModeBtn.onclick = () => {
    setAuthMode(state.authMode === "member" ? "manager" : "member");
    closeDrawer();
  };
  // Auth
  const loginForm = qs("#authLoginForm");
  if (loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = qs("#authEmail").value.trim();
    const password = qs("#authPassword").value.trim();
    const btn = qs("#btnSignIn");
    btn.disabled = true;
    try {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast("Signed in");
    } catch {
      showToast("Sign in failed");
    } finally {
      btn.disabled = false;
    }
  };
  const registerForm = qs("#authRegisterForm");
  if (registerForm) registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = qs("#regEmail").value.trim();
    const password = qs("#regPassword").value.trim();
    const btn = qs("#btnDoRegister");
    btn.disabled = true;
    if (!email || !password) { showToast("Email & password required"); btn.disabled = false; return; }
    try {
      const { error } = await state.supabase.auth.signUp({ email, password });
      if (error) throw error;
      showToast("Check your email to confirm");
    } catch {
      showToast("Registration failed");
    } finally {
      btn.disabled = false;
    }
  };
  const magicForm = qs("#authMagicForm");
  if (magicForm) magicForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = qs("#magicEmail").value.trim();
    const btn = qs("#btnDoMagic");
    btn.disabled = true;
    if (!email) { showToast("Email required"); btn.disabled = false; return; }
    try {
      const { error } = await state.supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      showToast("Magic link sent");
    } catch {
      showToast("Magic link failed");
    } finally {
      btn.disabled = false;
    }
  };
  const resetForm = qs("#authResetForm");
  if (resetForm) resetForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = qs("#resetEmail").value.trim();
    const btn = qs("#btnDoReset");
    btn.disabled = true;
    if (!email) { showToast("Email required"); btn.disabled = false; return; }
    try {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
      showToast("Reset email sent");
    } catch {
      showToast("Reset failed");
    } finally {
      btn.disabled = false;
    }
  };
  const actionLoginBtn = qs("#authActionLoginBtn");
  const actionRegisterBtn = qs("#authActionRegisterBtn");
  const actionMagicBtn = qs("#authActionMagicBtn");
  const actionResetBtn = qs("#authActionResetBtn");
  function setAuthAction(action) {
    const map = {
      login: "#authLoginForm",
      register: "#authRegisterForm",
      magic: "#authMagicForm",
      reset: "#authResetForm",
    };
    Object.values(map).forEach((sel) => qs(sel).classList.add("hidden"));
    qs(map[action]).classList.remove("hidden");
    actionLoginBtn.classList.toggle("seg-btn--active", action === "login");
    actionRegisterBtn.classList.toggle("seg-btn--active", action === "register");
    actionMagicBtn.classList.toggle("seg-btn--active", action === "magic");
    actionResetBtn.classList.toggle("seg-btn--active", action === "reset");
  }
  actionLoginBtn.onclick = () => setAuthAction("login");
  actionRegisterBtn.onclick = () => setAuthAction("register");
  actionMagicBtn.onclick = () => setAuthAction("magic");
  actionResetBtn.onclick = () => setAuthAction("reset");
  setAuthAction("login");
  // Local auth fallbacks
  function localUsers() {
    try { return JSON.parse(localStorage.getItem("pwa.local.users") || "[]"); } catch { return []; }
  }
  function saveLocalUsers(users) {
    localStorage.setItem("pwa.local.users", JSON.stringify(users));
  }
  function localSignIn(email, password) {
    const users = localUsers();
    const u = users.find((x) => x.email?.toLowerCase() === email.toLowerCase() && x.password === password);
    if (!u) throw new Error("Invalid credentials");
    state.user = { id: u.id, email: u.email, user_metadata: { full_name: u.display_name } };
    state.session = { user: state.user };
    localStorage.setItem("pwa.local.session", JSON.stringify(state.session));
  }
  function localRegister(email, password) {
    const users = localUsers();
    if (users.some((x) => x.email?.toLowerCase() === email.toLowerCase())) throw new Error("Email already exists");
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `u_${Math.random().toString(36).slice(2)}`;
    const display_name = email.split("@")[0];
    users.push({ id, email, password, display_name, is_manager: state.authMode === "manager" });
    saveLocalUsers(users);
  }
  const loginForm2 = qs("#authLoginForm");
  if (loginForm2) {
    const orig = loginForm2.onsubmit;
    loginForm2.onsubmit = async (e) => {
      e.preventDefault();
      const email = qs("#authEmail").value.trim();
      const password = qs("#authPassword").value.trim();
      const btn = qs("#btnSignIn"); btn.disabled = true;
      try {
        if (!state.supabase) {
          localSignIn(email, password);
          showMainApp();
          await postLoginInit();
          showToast("Signed in (local)");
        } else {
          await orig?.(e);
        }
      } catch (err) {
        showToast(err.message || "Sign in failed");
      } finally {
        btn.disabled = false;
      }
    };
  }
  const registerForm2 = qs("#authRegisterForm");
  if (registerForm2) {
    const orig = registerForm2.onsubmit;
    registerForm2.onsubmit = async (e) => {
      e.preventDefault();
      const email = qs("#regEmail").value.trim();
      const password = qs("#regPassword").value.trim();
      const btn = qs("#btnDoRegister"); btn.disabled = true;
      try {
        if (!state.supabase) {
          localRegister(email, password);
          showToast("Registered (local). Please sign in.");
          setAuthAction("login");
          qs("#authEmail").value = email;
        } else {
          await orig?.(e);
        }
      } catch (err) {
        showToast(err.message || "Registration failed");
      } finally {
        btn.disabled = false;
      }
    };
  }
  const magicForm2 = qs("#authMagicForm");
  if (magicForm2) {
    const orig = magicForm2.onsubmit;
    magicForm2.onsubmit = async (e) => {
      e.preventDefault();
      if (!state.supabase) {
        showToast("Magic link not available in local mode");
        return;
      }
      await orig?.(e);
    };
  }
  const resetForm2 = qs("#authResetForm");
  if (resetForm2) {
    const orig = resetForm2.onsubmit;
    resetForm2.onsubmit = async (e) => {
      e.preventDefault();
      if (!state.supabase) {
        showToast("Reset password not available in local mode");
        return;
      }
      await orig?.(e);
    };
  }
  const modeMemberBtn = qs("#authModeMemberBtn");
  const modeManagerBtn = qs("#authModeManagerBtn");
  function reflectMode() {
    modeMemberBtn?.classList.toggle("seg-btn--active", state.authMode === "member");
    modeManagerBtn?.classList.toggle("seg-btn--active", state.authMode === "manager");
  }
  reflectMode();
  modeMemberBtn && (modeMemberBtn.onclick = () => { setAuthMode("member"); reflectMode(); });
  modeManagerBtn && (modeManagerBtn.onclick = () => { setAuthMode("manager"); reflectMode(); });
  // Notes
  qs("#btnNewNote").onclick = openNewNoteModal;
  // Books
  qs("#btnCreateBook").onclick = openCreateBookModal;
  // Activities
  qs("#btnCreateActivity").onclick = openCreateActivityModal;
  // Chat
  qs("#btnSendMessage").onclick = sendMessage;
  // Sync
  qs("#btnSync").onclick = doRefresh;
  // Search
  const ns = qs("#notesSearchInput");
  if (ns) ns.oninput = () => renderNotesScreen(ns.value.trim());
  const bs = qs("#booksSearchInput");
  if (bs) bs.oninput = () => renderBooksScreen(bs.value.trim());
  const as = qs("#activitiesSearchInput");
  if (as) as.oninput = () => renderActivitiesScreen(as.value.trim());
  const cs = qs("#chatSearchInput");
  if (cs) cs.oninput = () => renderChatScreen(cs.value.trim());
  // Header quick actions
  qs("#headerTitle").onclick = () => openFamilySwitcher();
  const qsBtn = qs("#btnQuickSwitch");
  if (qsBtn) qsBtn.onclick = () => openQuickSwitcher();
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openQuickSwitcher();
    }
  });
  // Pull to refresh
  bindPullToRefresh();
}

function openCreateFamily() {
  openOverlay("Create New Family", (content) => {
    const card = el("div", "list-item");
    const nameInput = el("input"); nameInput.placeholder = "Family name";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const create = el("button", "primary-btn"); create.textContent = "Create";
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
    actions.append(create, cancel);
    card.append(nameInput, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    create.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast("Enter a family name"); return; }
      if (!state.user) { showAuthScreen(); showToast("Sign in first"); return; }
      if (state.supabase) {
        try {
          const { data: fam, error } = await state.supabase
            .from("families")
            .insert({ name })
            .select()
            .single();
          if (error) throw error;
          await state.supabase
            .from("family_members")
            .insert({ family_id: fam.id, user_id: state.user.id, role: "owner" });
          state.families.push(fam);
          state.familyId = fam.id;
          updateFamilyBadges();
          closeOverlay(true);
          loadAllData();
          rebindRealtime();
          loadMembershipRole();
        } catch {
          showToast("Failed to create family");
        }
      } else {
        const families = lg("pwa.local.families", []);
        const id = genId("fam");
        const fam = { id, name, join_code: randomCode(10) };
        families.push(fam);
        ls("pwa.local.families", families);
        const mems = lg("pwa.local.family_members", []);
        mems.push({ family_id: id, user_id: state.user.id, role: "owner" });
        ls("pwa.local.family_members", mems);
        state.families = families.filter((f) => mems.some((m) => m.family_id === f.id && m.user_id === state.user.id));
        state.familyId = id;
        updateFamilyBadges();
        closeOverlay(true);
        localLoadAllData();
        loadMembershipRole();
      }
    };
  }, true);
}

function openCalendarQuickSelect(bindInput) {
  openOverlay("Quick Date", (content) => {
    const list = el("div", "list");
    const opts = [];
    const now = new Date();
    const make = (label, setter) => {
      const b = el("button", "drawer-item");
      b.textContent = label;
      b.onclick = () => {
        const d = setter(new Date());
        bindInput.value = formatDateTimeLocal(d);
        closeOverlay(true);
      };
      opts.push(b);
    };
    make("Today 9:00 AM", (d) => { d.setHours(9, 0, 0, 0); return d; });
    make("Today 2:00 PM", (d) => { d.setHours(14, 0, 0, 0); return d; });
    make("Tonight 7:00 PM", (d) => { d.setHours(19, 0, 0, 0); return d; });
    make("Tomorrow 9:00 AM", (d) => { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; });
    const nextDayOfWeek = (base, day) => {
      const d = new Date(base);
      const diff = (day + 7 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    };
    make("Next Saturday 10:00 AM", (d) => { d = nextDayOfWeek(d, 6); d.setHours(10, 0, 0, 0); return d; });
    make("Next Sunday 10:00 AM", (d) => { d = nextDayOfWeek(d, 0); d.setHours(10, 0, 0, 0); return d; });
    opts.forEach((b) => list.appendChild(b));
    const native = el("button", "icon-btn"); native.textContent = "Open Picker";
    native.onclick = () => {
      try { bindInput.showPicker && bindInput.showPicker(); } catch {}
      bindInput.focus();
      closeOverlay(true);
    };
    content.append(list, native);
  }, true);
}

function openNativePicker(inputEl) {
  try {
    if (typeof inputEl.showPicker === "function") {
      inputEl.showPicker();
      return;
    }
  } catch {}
  try { inputEl.focus(); } catch {}
  try { inputEl.click(); } catch {}
}

function setAuthMode(mode) {
  state.authMode = mode;
  localStorage.setItem("pwa.auth.mode", mode);
  updateOwnerControls();
  showToast(`Mode: ${mode}`);
  // If logged in, reflect mode in profile
  upsertProfile();
}

async function upsertProfile() {
  if (!state.user || !state.supabase) return;
  try {
    const display_name =
      state.user.user_metadata?.full_name ||
      (state.user.email ? state.user.email.split("@")[0] : state.user.id);
    const is_manager = state.authMode === "manager";
    await state.supabase
      .from("profiles")
      .upsert({ id: state.user.id, display_name, is_manager }, { onConflict: "id" });
  } catch {
    // ignore failures; profile upsert is best-effort
  }
}
function bindPullToRefresh() {
  let startY = 0;
  let pulling = false;
  let refreshing = false;
  qsa(".screen").forEach((screen) => {
    screen.addEventListener("touchstart", (e) => {
      if (screen.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      } else {
        pulling = false;
      }
    }, { passive: true });
    screen.addEventListener("touchmove", async (e) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 80) {
        refreshing = true;
        showToast("Refreshing…");
        await doRefresh();
        setTimeout(() => { refreshing = false; }, 600);
      }
    }, { passive: true });
    screen.addEventListener("touchend", () => {
      pulling = false;
    }, { passive: true });
  });
}

/* =========================================
   RLS concepts (for reference in code comments)
   - families: enable RLS; policy: members can select/insert families they own or are invited to
   - family_members: RLS; user can select/update their own membership rows
   - books: RLS; using family_id; policy: only users with membership in family_id can select/insert/update/delete
   - notes: RLS; using family_id; policy: membership required; only created_by can update/delete
   - paragraphs: RLS; using family_id; policy: membership required; only author_id can update/delete
   - activities, activity_notes, activity_books: RLS; membership required; owners can modify
   - messages: RLS; family_id membership required; sender can insert; receivers and senders can select
========================================= */

/* =========================================
   Bootstrap
========================================= */
document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "dark");
  bindUI();
  registerServiceWorker();
  window.addEventListener("online", () => { state.online = true; setOfflineBanner(false); });
  window.addEventListener("offline", () => { state.online = false; setOfflineBanner(true); });
  await bootstrapSupabase();
  attemptAuthBootstrap();
  checkJoinLink();
});

async function tryFetchConfig() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return false;
    const cfg = await res.json();
    if (cfg?.url && cfg?.anon) {
      localStorage.setItem(STORAGE_KEYS.supabase, JSON.stringify(cfg));
      state.supabase = supabase.createClient(cfg.url, cfg.anon);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function bootstrapSupabase() {
  if (ensureSupabaseConfigured()) return true;
  const ok = await tryFetchConfig();
  if (ok) return true;
  showAuthScreen();
  showToast("Local mode: sign in without Supabase");
  return false;
}

function attemptLocalBootstrap() {
  try {
    const raw = localStorage.getItem("pwa.local.session");
    const sess = raw ? JSON.parse(raw) : null;
    state.session = sess;
    state.user = sess?.user || null;
    if (state.user) {
      showMainApp();
      postLoginInit();
    } else {
      showAuthScreen();
    }
  } catch {
    showAuthScreen();
  }
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function linkify(text) {
  const safe = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return safe.replace(urlRegex, (url) => {
    const clean = url.replace(/&amp;/g, "&");
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`;
  });
}

function openQuickSwitcher() {
  openOverlay("Quick Switcher", (content) => {
    const input = el("input");
    input.placeholder = "Search notes, books, activities, members…";
    input.style.width = "100%";
    input.style.marginBottom = "8px";
    const list = el("div", "list");
    content.append(input, list);
    function buildItems(term) {
      list.innerHTML = "";
      const t = (term || "").toLowerCase();
      const items = [
        ...(state.notes || []).map((n) => ({ type: "note", title: n.title, item: n })),
        ...(state.books || []).map((b) => ({ type: "book", title: b.title, item: b })),
        ...(state.activities || []).map((a) => ({ type: "activity", title: a.title, item: a })),
        ...(state.members || [])
          .filter((m) => m.id !== state.user?.id)
          .map((m) => ({ type: "member", title: m.display_name || m.id, item: m })),
      ].filter((x) => !t || (x.title?.toLowerCase().includes(t)));
      if (!items.length) {
        const empty = el("div", "list-item skeleton");
        empty.textContent = "No matches";
        list.appendChild(empty);
        return;
      }
      items.slice(0, 20).forEach((x) => {
        const it = el("div", "list-item");
        const ti = el("div", "title");
        ti.textContent = `${x.title}`;
        const me = el("div", "meta");
        me.textContent = x.type;
        it.append(ti, me);
        it.onclick = () => {
          closeOverlay(true);
          if (x.type === "note") {
            setRoute("notes");
            openNoteDetail(x.item);
          } else if (x.type === "book") {
            setRoute("books");
            openBookDetail(x.item);
          } else if (x.type === "activity") {
            setRoute("activities");
            openActivityDetail(x.item);
          } else if (x.type === "member") {
            setRoute("chat");
            openConversation(x.item.id, x.item.display_name || x.item.id);
          }
        };
        list.appendChild(it);
      });
    }
    buildItems("");
    input.oninput = () => buildItems(input.value.trim());
  }, true);
}

async function openShareJoinCode() {
  if (!state.familyId) { openFamilySwitcher(); return; }
  const fam = state.families.find((f) => f.id === state.familyId);
  openOverlay("Share Join Code", (content) => {
    const box = el("div", "list-item");
    const codeView = el("div", "detail-title");
    codeView.textContent = fam?.join_code || "No code yet";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const gen = el("button", "primary-btn"); gen.textContent = "Generate/Rotate Code";
    const copy = el("button", "icon-btn"); copy.textContent = "Copy Link";
    actions.append(gen, copy);
    box.append(codeView, actions);
    content.append(box);
    gen.onclick = async () => {
      try {
        const newCode = randomCode(10);
        const { data, error } = await state.supabase
          .from("families")
          .update({ join_code: newCode })
          .eq("id", state.familyId)
          .select("id, name, join_code")
          .single();
        if (error) throw error;
        const idx = state.families.findIndex((f) => f.id === state.familyId);
        if (idx >= 0) state.families[idx] = data;
        codeView.textContent = data.join_code;
        showToast("Join code updated");
      } catch {
        showToast("Failed to update code");
      }
    };
    copy.onclick = async () => {
      const base = location.origin + location.pathname;
      const link = `${base}?join=${encodeURIComponent(codeView.textContent || "")}`;
      try { await navigator.clipboard.writeText(link); showToast("Link copied"); } catch { showToast("Copy failed"); }
    };
  }, true);
}

function openJoinByCode() {
  openOverlay("Join Family via Code", (content) => {
    const card = el("div", "list-item");
    const input = el("input"); input.placeholder = "Enter join code";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const join = el("button", "primary-btn"); join.textContent = "Join";
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
    actions.append(join, cancel);
    card.append(input, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    join.onclick = async () => {
      if (!input.value.trim()) { showToast("Enter a code"); return; }
      const ok = await joinFamilyByCode(input.value.trim());
      if (ok) closeOverlay(true);
    };
  }, true);
}

function openSetNewPassword() {
  openOverlay("Set New Password", (content) => {
    const card = el("div", "list-item");
    const p1 = el("input"); p1.type = "password"; p1.placeholder = "New password";
    const p2 = el("input"); p2.type = "password"; p2.placeholder = "Confirm new password";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const save = el("button", "primary-btn"); save.textContent = "Save";
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
    actions.append(save, cancel);
    card.append(p1, p2, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    save.onclick = async () => {
      if (!p1.value || p1.value !== p2.value) { showToast("Passwords must match"); return; }
      try {
        const { error } = await state.supabase.auth.updateUser({ password: p1.value });
        if (error) throw error;
        showToast("Password updated");
        closeOverlay(true);
      } catch {
        showToast("Update failed");
      }
    };
  }, true);
}
async function openAccessRequests() {
  if (state.currentRole !== "owner") { showToast("Owner only"); return; }
  const { data, error } = await state.supabase
    .from("family_access_requests")
    .select("*")
    .eq("family_id", state.familyId)
    .order("created_at", { ascending: false });
  const requests = error ? [] : (data || []);
  openOverlay("Join Requests", (content) => {
    const list = el("div", "list");
    if (!requests.length) {
      const empty = el("div", "list-item");
      empty.textContent = "No pending requests";
      list.appendChild(empty);
    } else {
      requests.forEach((r) => {
        const item = el("div", "list-item");
        const title = el("div", "title");
        title.textContent = r.requester_name || r.requester_email || r.requester_id;
        const meta = el("div", "meta");
        meta.textContent = `${r.status || "pending"} • ${fmtTime(r.created_at)}`;
        const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "8px";
        const approve = el("button", "primary-btn"); approve.textContent = "Approve";
        const deny = el("button", "icon-btn"); deny.textContent = "Decline";
        approve.onclick = async () => {
          try {
            const { error: memErr } = await state.supabase
              .from("family_members")
              .insert({ family_id: state.familyId, user_id: r.requester_id, role: "member" });
            if (memErr) throw memErr;
            await state.supabase
              .from("family_access_requests")
              .update({ status: "approved" })
              .eq("id", r.id);
            showToast("Approved");
            closeOverlay(true);
          } catch {
            showToast("Approval failed");
          }
        };
        deny.onclick = async () => {
          try {
            await state.supabase
              .from("family_access_requests")
              .update({ status: "rejected" })
              .eq("id", r.id);
            showToast("Declined");
            closeOverlay(true);
          } catch {
            showToast("Decline failed");
          }
        };
        actions.append(approve, deny);
        item.append(title, meta, actions);
        list.appendChild(item);
      });
    }
    content.append(list);
  }, true);
}
async function joinFamilyByCode(code) {
  try {
    const { data: fam, error } = await state.supabase
      .from("families")
      .select("id,name,join_code")
      .eq("join_code", code)
      .single();
    if (error || !fam) { showToast("Invalid code"); return false; }
    const { error: reqErr } = await state.supabase
      .from("family_access_requests")
      .insert({
        family_id: fam.id,
        requester_id: state.user.id,
        requester_email: state.user.email,
        requester_name: state.user.user_metadata?.full_name || state.user.email,
        code,
        status: "pending",
      });
    if (reqErr) { showToast("Request failed"); return false; }
    showToast("Request sent to owner");
    return true;
  } catch {
    showToast("Join failed");
    return false;
  }
}

async function checkJoinLink() {
  const params = new URLSearchParams(location.search);
  const code = params.get("join");
  if (!code) return;
  if (!state.user) {
    localStorage.setItem("pwa.pendingJoinCode", code);
    return;
  }
  await joinFamilyByCode(code);
  const base = location.origin + location.pathname;
  history.replaceState(null, "", base);
}
