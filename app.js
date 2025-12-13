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
  pagination: {
    books: { page: 0, pageSize: 20, hasMore: true, term: "" },
    notes: { page: 0, pageSize: 20, hasMore: true, term: "" },
    activities: { page: 0, pageSize: 20, hasMore: true, term: "" },
    conversation: { page: 0, pageSize: 30, hasMore: true },
  },
  conversationMessages: [],
  bookDetailNotes: [],
  bookDetailPagination: { page: 0, pageSize: 20, hasMore: true, bookId: null },
  perf: { logs: [] },
  loadingOlderMessages: false,
  loadingMore: false,
  errors: [],
  longTasks: [],
  usage: { booksCreated: 0, notesCreated: 0, activitiesCreated: 0 },
  filters: { notesTags: [], booksTags: [], activitiesTags: [] },
  typingPeers: {},
  presenceChannels: {},
};

const STORAGE_KEYS = {
  theme: "pwa.theme",
  supabase: "pwa.supabase.config",
  cacheNotes: (familyId) => `pwa.cache.notes.${familyId}`,
  cacheBooks: (familyId) => `pwa.cache.books.${familyId}`,
  cacheActivities: (familyId) => `pwa.cache.activities.${familyId}`,
  cacheMembers: (familyId) => `pwa.cache.members.${familyId}`,
  cacheMessages: (familyId, peerId) => `pwa.cache.messages.${familyId}.${peerId}`,
  lastFamily: "pwa.last.family",
  pinsNotes: (familyId) => `pwa.pins.notes.${familyId}`,
  pinsBooks: (familyId) => `pwa.pins.books.${familyId}`,
  pinsActivities: (familyId) => `pwa.pins.activities.${familyId}`,
  queueMessages: (familyId, userId) => `pwa.queue.messages.${familyId}.${userId}`,
  tagsNotes: (familyId) => `pwa.tags.notes.${familyId}`,
  tagsBooks: (familyId) => `pwa.tags.books.${familyId}`,
  tagsActivities: (familyId) => `pwa.tags.activities.${familyId}`,
  rsvpActivity: (familyId, activityId) => `pwa.rsvp.${familyId}.${activityId}`,
  remindersActivities: (familyId) => `pwa.reminders.activities.${familyId}`,
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
function isStandalone() {
  return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

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
  if (!state.user && name !== "auth") {
    showAuthScreen();
    return;
  }
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
  updatePagerBar();
  preloadRoutes();
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
    state.supabase = supabase.createClient(cfg.url, cfg.anon, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
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
  if (state.supabase) {
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
      startSessionPoll();
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
        startSessionPoll();
      } else {
        showAuthScreen();
      }
    });
  } else {
    const localSess = getLocalSession();
    if (localSess?.user) {
      state.session = localSess;
      state.user = localSess.user;
      showMainApp();
      await postLoginInit();
    } else {
      showAuthScreen();
    }
  }
}

/* =========================================
   Family management and post-login init
========================================= */
async function postLoginInit() {
  await ensureFamilyContext();
  await loadAllData();
  bindRealtime();
  await checkRouteLink();
  preloadRoutes();
}
async function ensureFamilyContext() {
  try {
    const { data: memRows, error: memErr } = await state.supabase
      .from("family_members")
      .select("family_id")
      .eq("user_id", state.user.id);
    if (memErr) throw memErr;
    const ids = (memRows || []).map((x) => x.family_id);
    state.debug = state.debug || {};
    state.debug.membershipIds = ids;
    let families = [];
    if (ids.length > 0) {
      const { data, error } = await state.supabase
        .from("families")
        .select("id,name")
        .in("id", ids);
      if (error) throw error;
      families = data || [];
    } else {
      try {
        const { data } = await state.supabase
          .from("families")
          .select("id,name")
          .order("name", { ascending: true })
          .limit(50);
        families = data || [];
      } catch {
        families = [];
      }
    }
    state.families = families || [];
    const last = localStorage.getItem(STORAGE_KEYS.lastFamily);
    const urlFam = new URLSearchParams(location.search).get("family");
    state.debug.lastFamilyKey = last;
    state.debug.urlFamilyParam = urlFam;
    if (!state.familyId) {
      const hasUrl = urlFam && state.families.some((f) => String(f.id) === String(urlFam));
      const hasLast = last && state.families.some((f) => String(f.id) === String(last));
      state.familyId = hasUrl ? urlFam : hasLast ? last : (state.families[0]?.id || null);
    }
    if (state.familyId) localStorage.setItem(STORAGE_KEYS.lastFamily, state.familyId);
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
        localStorage.setItem(STORAGE_KEYS.lastFamily, fam.id);
        updateFamilyBadges();
        closeOverlay(true);
        loadAllData();
        rebindRealtime();
        loadMembershipRole();
      };
      list.appendChild(item);
    });
    const idRow = el("div"); idRow.style.display = "grid"; idRow.style.gap = "8px"; idRow.style.marginTop = "8px";
    const idInput = el("input"); idInput.placeholder = "Enter family ID";
    const setBtn = el("button", "primary-btn"); setBtn.textContent = "Set Current Family";
    const reloadBtn = el("button", "icon-btn"); reloadBtn.textContent = "Reload List";
    setBtn.onclick = async () => {
      const id = idInput.value.trim();
      if (!id) { showToast("Enter an ID"); return; }
      let fam = (state.families || []).find((f) => String(f.id) === String(id));
      if (!fam && state.supabase) {
        try {
          const { data } = await state.supabase.from("families").select("id,name,join_code").eq("id", id).single();
          if (data) {
            fam = data;
            if (!(state.families || []).some((f) => String(f.id) === String(id))) {
              state.families.push(data);
            }
          }
        } catch {}
      }
      state.familyId = id;
      localStorage.setItem(STORAGE_KEYS.lastFamily, id);
      updateFamilyBadges();
      closeOverlay(true);
      await loadAllData();
      rebindRealtime();
      await loadMembershipRole();
      showToast("Family set");
    };
    reloadBtn.onclick = async () => {
      await ensureFamilyContext();
      closeOverlay(true);
      openFamilySwitcher();
    };
    idRow.append(idInput, setBtn, reloadBtn);
    const createRow = el("div"); createRow.style.display = "grid"; createRow.style.gap = "8px";
    const nameInput = el("input"); nameInput.placeholder = "New family name";
    const createBtn = el("button", "primary-btn"); createBtn.textContent = "Create New Family";
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast("Enter a family name"); return; }
      if (!state.user) { showAuthScreen(); showToast("Sign in first"); return; }
      if (state.supabase) {
        try {
          const famId = newUuid();
          const payload = { id: famId, name, owner_id: state.user.id };
          const { error } = await state.supabase
            .from("families")
            .insert(payload, { returning: "minimal" });
          if (error) throw error;
          const { error: memberErr } = await state.supabase
            .from("family_members")
            .insert({ family_id: famId, user_id: state.user.id, role: "owner" });
          if (memberErr) throw memberErr;
          state.families.push({ id: famId, name });
          state.familyId = famId;
          localStorage.setItem(STORAGE_KEYS.lastFamily, famId);
          updateFamilyBadges();
          closeOverlay(true);
          loadAllData();
          rebindRealtime();
          loadMembershipRole();
        } catch (e) {
          console.error(e);
          showToast(e.message || "Failed to create family");
        }
      }
    };
    createRow.append(nameInput, createBtn);
    card.append(list, idRow, createRow);
    content.append(card);
  }, true);
}

async function loadMembershipRole() {
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
  if (!state.supabase || !state.familyId) {
    state.books = [];
    state.notes = [];
    state.activities = [];
    state.members = [];
    renderBooksScreen();
    renderNotesScreen();
    renderActivitiesScreen();
    renderChatScreen();
    return;
  }
  resetPagination();
  await Promise.all([
    loadBooks({ replace: true }),
    loadNotes({ replace: true }),
    loadActivities({ replace: true }),
    loadMembers(),
  ]);
}
async function safeFetch(fn, cacheKey) {
  try {
    const res = await fn();
    setOfflineBanner(false);
    if (cacheKey) {
      try { localStorage.setItem(cacheKey, JSON.stringify(res || [])); } catch {}
    }
    return res || [];
  } catch (e) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    setOfflineBanner(offline);
    if (!offline) showToast("Failed to load data");
    if (cacheKey) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return [];
  }
}
async function loadBooks(opts = {}) {
  const p = state.pagination.books;
  if (typeof opts.page === "number") p.page = opts.page;
  const offset = p.page * p.pageSize;
  const t0 = performance.now();
  const books = await safeFetch(async () => {
    let query = state.supabase
      .from("books")
      .select("id,title,description,family_id,created_at")
      .eq("family_id", state.familyId)
      .order("id", { ascending: false })
      .range(offset, offset + p.pageSize - 1);
    if (p.term) {
      const t = `%${p.term}%`;
      query = query.or(`ilike(title,${t}),ilike(description,${t})`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheBooks(state.familyId));
  if (opts.replace) {
    state.books = books || [];
  } else {
    state.books = [...(state.books || []), ...(books || [])];
  }
  p.hasMore = (books || []).length >= p.pageSize;
  try { state.perf.logs.push({ op: "loadBooks", count: (books || []).length, ms: Math.round(performance.now() - t0), when: Date.now() }); } catch {}
  renderBooksScreen();
}
async function loadNotes(opts = {}) {
  const p = state.pagination.notes;
  if (typeof opts.page === "number") p.page = opts.page;
  const offset = p.page * p.pageSize;
  const t0 = performance.now();
  const notes = await safeFetch(async () => {
    let query = state.supabase
      .from("notes")
      .select("id,title,book_id,family_id,created_at,created_by")
      .eq("family_id", state.familyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + p.pageSize - 1);
    if (p.term) {
      const t = `%${p.term}%`;
      query = query.ilike("title", t);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheNotes(state.familyId));
  if (opts.replace) {
    state.notes = notes || [];
  } else {
    state.notes = [...(state.notes || []), ...(notes || [])];
  }
  p.hasMore = (notes || []).length >= p.pageSize;
  try { state.perf.logs.push({ op: "loadNotes", count: (notes || []).length, ms: Math.round(performance.now() - t0), when: Date.now() }); } catch {}
  renderNotesScreen();
}
async function loadActivities(opts = {}) {
  const p = state.pagination.activities;
  if (typeof opts.page === "number") p.page = opts.page;
  const offset = p.page * p.pageSize;
  const t0 = performance.now();
  const items = await safeFetch(async () => {
    let query = state.supabase
      .from("activities")
      .select("id,title,description,datetime,location,family_id,created_at")
      .eq("family_id", state.familyId)
      .order("datetime", { ascending: false })
      .range(offset, offset + p.pageSize - 1);
    if (p.term) {
      const t = `%${p.term}%`;
      query = query.or(`ilike(title,${t}),ilike(description,${t}),ilike(location,${t})`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }, STORAGE_KEYS.cacheActivities(state.familyId));
  if (opts.replace) {
    state.activities = items || [];
  } else {
    state.activities = [...(state.activities || []), ...(items || [])];
  }
  p.hasMore = (items || []).length >= p.pageSize;
  try { state.perf.logs.push({ op: "loadActivities", count: (items || []).length, ms: Math.round(performance.now() - t0), when: Date.now() }); } catch {}
  renderActivitiesScreen();
}
async function loadMembers() {
  if (!state.supabase || !state.familyId) {
    state.members = [];
    renderChatScreen();
    return;
  }
  const rel = await state.supabase
    .from("family_members")
    .select("user_id")
    .eq("family_id", state.familyId);
  const ids = rel.error ? [] : (rel.data || []).map((x) => x.user_id);
  if (!ids.length) {
    state.members = [];
    renderChatScreen();
    return;
  }
  const members = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .in("id", ids);
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

async function subscribeChatPresence(peerId) {
  try {
    const key = `chat-${state.familyId}-${peerId}`;
    if (state.presenceChannels[key]) return;
    const ch = state.supabase.channel(key, { config: { presence: { key: state.user.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const s = ch.presenceState();
      const typing = Object.values(s || {}).some((arr) => (arr || []).some((u) => u.typing));
      qs("#typingIndicator").textContent = typing ? "Typing…" : "";
    });
    const resp = await ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.track({ typing: false, online_at: new Date().toISOString() });
      }
    });
    state.presenceChannels[key] = ch;
    const input = qs("#messageInput");
    if (input) {
      input.oninput = () => {
        const val = input.value.trim();
        ch.track({ typing: !!val, online_at: new Date().toISOString() });
      };
    }
  } catch {}
}
async function subscribeNotePresence(noteId) {
  try {
    const key = `note-${state.familyId}-${noteId}`;
    if (state.presenceChannels[key]) return;
    const ch = state.supabase.channel(key, { config: { presence: { key: state.user.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const s = ch.presenceState();
      const count = Object.keys(s || {}).length;
      const fam = state.families.find((f) => f.id === state.familyId)?.name || "—";
      const bc = qs("#noteBreadcrumbs"); if (bc) bc.textContent = `Family: ${fam} • Notes • Viewing: ${count}`;
    });
    await ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.track({ viewing: true, at: new Date().toISOString() });
      }
    });
    state.presenceChannels[key] = ch;
  } catch {}
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
function getPins(kind) {
  if (!state.familyId) return new Set();
  const key = kind === "notes" ? STORAGE_KEYS.pinsNotes(state.familyId) : kind === "books" ? STORAGE_KEYS.pinsBooks(state.familyId) : STORAGE_KEYS.pinsActivities(state.familyId);
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function togglePin(kind, id) {
  if (!state.familyId) return;
  const key = kind === "notes" ? STORAGE_KEYS.pinsNotes(state.familyId) : kind === "books" ? STORAGE_KEYS.pinsBooks(state.familyId) : STORAGE_KEYS.pinsActivities(state.familyId);
  const pins = getPins(kind);
  if (pins.has(id)) pins.delete(id); else pins.add(id);
  try { localStorage.setItem(key, JSON.stringify(Array.from(pins))); } catch {}
}
function getTags(kind) {
  if (!state.familyId) return new Map();
  const key = kind === "notes" ? STORAGE_KEYS.tagsNotes(state.familyId) : kind === "books" ? STORAGE_KEYS.tagsBooks(state.familyId) : STORAGE_KEYS.tagsActivities(state.familyId);
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(key) || "{}"))); } catch { return new Map(); }
}
function saveTags(kind, map) {
  if (!state.familyId) return;
  const key = kind === "notes" ? STORAGE_KEYS.tagsNotes(state.familyId) : kind === "books" ? STORAGE_KEYS.tagsBooks(state.familyId) : STORAGE_KEYS.tagsActivities(state.familyId);
  try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(map))); } catch {}
}
function allTags(kind) {
  const map = getTags(kind);
  const set = new Set();
  Array.from(map.values()).forEach((arr) => (arr || []).forEach((t) => set.add(t)));
  return Array.from(set).sort();
}
function openEditTags(kind, id, title) {
  openOverlay(`Tags • ${title}`, (content) => {
    const map = getTags(kind);
    const cur = new Set(map.get(String(id)) || []);
    try {
      const src = kind === "notes" ? state.notes.find((x) => String(x.id) === String(id))
        : kind === "books" ? state.books.find((x) => String(x.id) === String(id))
        : state.activities.find((x) => String(x.id) === String(id));
      if (src && Array.isArray(src.tags)) {
        src.tags.forEach((t) => cur.add(t));
      }
    } catch {}
    const list = el("div", "list");
    const chips = el("div", "chip-row");
    allTags(kind).forEach((t) => {
      const c = el("button", "chip"); c.textContent = t;
      c.classList.toggle("chip--active", cur.has(t));
      c.onclick = () => { if (cur.has(t)) cur.delete(t); else cur.add(t); c.classList.toggle("chip--active"); };
      chips.appendChild(c);
    });
    const input = el("input"); input.placeholder = "Add new tag";
    const add = el("button", "icon-btn"); add.textContent = "Add";
    add.onclick = () => {
      const t = input.value.trim(); if (!t) return;
      cur.add(t); input.value = "";
      const c = el("button", "chip"); c.textContent = t; c.classList.add("chip--active");
      c.onclick = () => { if (cur.has(t)) cur.delete(t); else cur.add(t); c.classList.toggle("chip--active"); };
      chips.appendChild(c);
    };
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "8px";
    const save = el("button", "primary-btn"); save.textContent = "Save";
    save.onclick = () => {
      map.set(String(id), Array.from(cur));
      saveTags(kind, map);
      closeOverlay(true);
      if (kind === "notes") renderNotesScreen();
      if (kind === "books") renderBooksScreen();
      if (kind === "activities") renderActivitiesScreen();
    };
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel"; cancel.onclick = () => closeOverlay(true);
    actions.append(save, cancel);
    list.append(chips, input, add, actions);
    content.append(list);
  }, true);
}
function restoreDraft(noteId) {
  try {
    const raw = localStorage.getItem(`pwa.draft.note.${noteId}`);
    if (raw) qs("#editorInput").innerHTML = raw;
    qs("#editorInput").oninput = () => {
      try { localStorage.setItem(`pwa.draft.note.${noteId}`, qs("#editorInput").innerHTML); } catch {}
    };
  } catch {}
}
function clearDraft(noteId) {
  try { localStorage.removeItem(`pwa.draft.note.${noteId}`); } catch {}
}
function updateNoteBreadcrumbs(note) {
  const fam = state.families.find((f) => f.id === state.familyId)?.name || "—";
  const bc = qs("#noteBreadcrumbs"); if (bc) bc.textContent = `Family: ${fam} • Notes`;
}
function updateBookBreadcrumbs(book) {
  const fam = state.families.find((f) => f.id === state.familyId)?.name || "—";
  const bc = qs("#bookBreadcrumbs"); if (bc) bc.textContent = `Family: ${fam} • Books`;
}
function updateActivityBreadcrumbs(a) {
  const fam = state.families.find((f) => f.id === state.familyId)?.name || "—";
  const bc = qs("#activityBreadcrumbs"); if (bc) bc.textContent = `Family: ${fam} • Activities`;
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
function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const s = []; const hex = "0123456789abcdef";
  for (let i = 0; i < 36; i++) s[i] = hex[Math.floor(Math.random() * 16)];
  s[14] = "4";
  s[19] = hex[(parseInt(s[19], 16) & 0x3) | 0x8];
  s[8] = s[13] = s[18] = s[23] = "-";
  return s.join("");
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
  renderTagChips("notes");
  const term = qs("#notesSearchInput")?.value?.toLowerCase() || "";
  const pins = getPins("notes");
  const tagFilters = state.filters.notesTags || [];
  const items = (state.notes || []).filter((n) =>
    !term ||
    (n.title?.toLowerCase().includes(term))
  ).sort((a, b) => {
    const ap = pins.has(a.id) ? 1 : 0;
    const bp = pins.has(b.id) ? 1 : 0;
    return bp - ap;
  }).filter((n) => {
    if (!tagFilters.length) return true;
    const map = getTags("notes"); const arr = map.get(String(n.id)) || [];
    return tagFilters.every((t) => arr.includes(t));
  });
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
    const pin = el("button", "icon-btn");
    pin.textContent = pins.has(note.id) ? "★" : "☆";
    pin.onclick = (e) => { e.stopPropagation(); togglePin("notes", note.id); renderNotesScreen(); };
    const tagBtn = el("button", "icon-btn"); tagBtn.textContent = "Tags";
    tagBtn.onclick = (e) => { e.stopPropagation(); openEditTags("notes", note.id, note.title); };
    const actionsBar = el("div", "list-item-actions");
    const editBtn = el("button", "icon-btn"); editBtn.textContent = "Edit";
    const deleteBtn = el("button", "icon-btn"); deleteBtn.textContent = "Delete";
    editBtn.onclick = (e) => { e.stopPropagation(); openNoteEditModal(note); };
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteNote(note); };
    actionsBar.append(editBtn, deleteBtn, tagBtn, pin);
    const tagsRow = el("div", "chip-row");
    const map = getTags("notes"); const arr = map.get(String(note.id)) || [];
    arr.forEach((t) => { const c = el("button", "chip"); c.textContent = t; tagsRow.appendChild(c); });
    item.append(title, meta, preview, tagsRow, actionsBar);
    let startX = 0; let dx = 0; let swiped = false;
    item.addEventListener("touchstart", (ev) => { startX = ev.touches[0].clientX; dx = 0; swiped = false; }, { passive: true });
    item.addEventListener("touchmove", (ev) => { dx = ev.touches[0].clientX - startX; }, { passive: true });
    item.addEventListener("touchend", () => {
      if (Math.abs(dx) > 40) {
        swiped = true;
        if (dx < 0) {
          actionsBar.innerHTML = "";
          const del = el("button", "primary-btn"); del.textContent = "Delete"; del.onclick = (e) => { e.stopPropagation(); deleteNote(note); };
          actionsBar.append(del);
        } else {
          actionsBar.innerHTML = "";
          const edit = el("button", "primary-btn"); edit.textContent = "Edit"; edit.onclick = (e) => { e.stopPropagation(); openNoteEditModal(note); };
          const tags = el("button", "icon-btn"); tags.textContent = "Tags"; tags.onclick = (e) => { e.stopPropagation(); openEditTags("notes", note.id, note.title); };
          actionsBar.append(edit, tags);
        }
      }
    }, { passive: true });
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
  updatePagerBar();
}
async function deleteNote(note) {
  try {
    const { error } = await state.supabase
      .from("notes")
      .delete()
      .eq("id", note.id)
      .eq("created_by", state.user.id);
    if (error) throw error;
    showToast("Note deleted");
    await loadNotes({ replace: true });
  } catch (e) {
    console.error(e);
    showToast(e.message || "Permission denied or failed");
  }
}
function openNoteEditModal(note) {
  openOverlay("Edit Note", (content) => {
    const card = el("div", "list-item");
    const input = el("input"); input.value = note.title; input.placeholder = "Title";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const save = el("button", "primary-btn"); save.textContent = "Save";
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
    actions.append(save, cancel);
    card.append(input, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    save.onclick = async () => {
      const title = input.value.trim();
      if (!title) { showToast("Title required"); return; }
      try {
        const { error } = await state.supabase
          .from("notes")
          .update({ title })
          .eq("id", note.id)
          .eq("created_by", state.user.id);
        if (error) throw error;
        closeOverlay(true);
        showToast("Note updated");
        await loadNotes({ replace: true });
      } catch (e) {
        console.error(e);
        showToast(e.message || "Permission denied or failed");
      }
    };
  }, true);
}
async function openNoteDetail(note, opts = {}) {
  qs("#noteDetail").classList.remove("hidden");
  const showTitle = opts.showTitle !== false;
  qs("#noteTitleView").textContent = note.title;
  qs("#noteTitleView").style.display = showTitle ? "" : "none";
  updateNoteBreadcrumbs(note);
  qs("#editorInput").innerHTML = "";
  restoreDraft(note.id);
  const ed = qs("#noteDetail .editor");
  ed.style.display = opts.readonly ? "none" : "";
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
  subscribeNotePresence(note.id);
  const nf = qs("#noteFileInput");
  if (nf) {
    nf.onchange = async () => {
      if (!nf.files || !nf.files[0]) return;
      const file = nf.files[0];
      await uploadNoteAttachment(note.id, file);
      nf.value = "";
    };
  }
}
async function loadParagraphs(noteId) {
  const box = qs("#paragraphs");
  box.innerHTML = "";
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
  } catch (e) {
    console.error(e);
    showToast(e.message || "Failed to load paragraphs");
  }
}
async function saveParagraph(noteId) {
  const html = qs("#editorInput").innerHTML.trim();
  if (!html) {
    showToast("Write something first");
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
    clearDraft(noteId);
    await loadParagraphs(noteId);
    showToast("Paragraph added");
  } catch (e) {
    console.error(e);
    showToast(e.message || "Failed to save paragraph");
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
      } catch (e) {
        console.error(e);
        showToast(e.message || "Permission denied or failed");
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
    const { count } = await state.supabase
      .from("paragraphs")
      .select("id", { count: "exact", head: true })
      .eq("note_id", p.note_id);
    if (!count || count === 0) {
      try {
        const { error: delNoteErr } = await state.supabase
          .from("notes")
          .delete()
          .eq("id", p.note_id)
          .eq("created_by", state.user.id);
        if (!delNoteErr) {
          showToast("Note deleted");
          await loadNotes({ replace: true });
          qs("#noteDetail").classList.add("hidden");
          return;
        }
      } catch {}
    }
    await loadParagraphs(p.note_id);
  } catch (e) {
    console.error(e);
    showToast(e.message || "Permission denied or failed");
  }
}

/* =========================================
   New Note flow
========================================= */
async function openNewNoteModal() {
  const host = qs("#notesInlineForm");
  host.classList.remove("hidden");
  host.innerHTML = "";
  if (state.supabase) {
    try { await loadBooks(); } catch {}
  }
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
      try { state.usage.notesCreated = (state.usage.notesCreated || 0) + 1; localStorage.setItem("pwa.usage", JSON.stringify(state.usage)); } catch {}
    } catch (e) {
      console.error(e);
      showToast(e.message || "Failed to create note");
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
  renderTagChips("books");
  const term = qs("#booksSearchInput")?.value?.toLowerCase() || "";
  const pins = getPins("books");
  const tagFilters = state.filters.booksTags || [];
  const items = (state.books || []).filter((b) =>
    !term ||
    (b.title?.toLowerCase().includes(term)) ||
    (firstDefined(b, ["description", "desc", "summary"]).toLowerCase().includes(term))
  ).sort((a, b) => {
    const ap = pins.has(a.id) ? 1 : 0;
    const bp = pins.has(b.id) ? 1 : 0;
    return bp - ap;
  }).filter((b) => {
    if (!tagFilters.length) return true;
    const map = getTags("books"); const arr = map.get(String(b.id)) || [];
    return tagFilters.every((t) => arr.includes(t));
  });
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
    const pin = el("button", "icon-btn");
    pin.textContent = pins.has(book.id) ? "★" : "☆";
    pin.onclick = (e) => { e.stopPropagation(); togglePin("books", book.id); renderBooksScreen(); };
    const tagBtn = el("button", "icon-btn"); tagBtn.textContent = "Tags";
    tagBtn.onclick = (e) => { e.stopPropagation(); openEditTags("books", book.id, book.title); };
    const actionsBar = el("div", "list-item-actions");
    const editBtn = el("button", "icon-btn"); editBtn.textContent = "Edit";
    const deleteBtn = el("button", "icon-btn"); deleteBtn.textContent = "Delete";
    editBtn.onclick = (e) => { e.stopPropagation(); openBookEditModal(book); };
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteBook(book); };
    actionsBar.append(editBtn, deleteBtn, tagBtn, pin);
    const tagsRow = el("div", "chip-row");
    const map = getTags("books"); const arr = map.get(String(book.id)) || [];
    arr.forEach((t) => { const c = el("button", "chip"); c.textContent = t; tagsRow.appendChild(c); });
    item.append(title, meta, stat, tagsRow, actionsBar);
    let startX = 0; let dx = 0;
    item.addEventListener("touchstart", (ev) => { startX = ev.touches[0].clientX; dx = 0; }, { passive: true });
    item.addEventListener("touchmove", (ev) => { dx = ev.touches[0].clientX - startX; }, { passive: true });
    item.addEventListener("touchend", () => {
      if (Math.abs(dx) > 40) {
        if (dx < 0) {
          actionsBar.innerHTML = "";
          const del = el("button", "primary-btn"); del.textContent = "Delete"; del.onclick = (e) => { e.stopPropagation(); deleteBook(book); };
          actionsBar.append(del);
        } else {
          actionsBar.innerHTML = "";
          const edit = el("button", "primary-btn"); edit.textContent = "Edit"; edit.onclick = (e) => { e.stopPropagation(); openBookEditModal(book); };
          const tags = el("button", "icon-btn"); tags.textContent = "Tags"; tags.onclick = (e) => { e.stopPropagation(); openEditTags("books", book.id, book.title); };
          actionsBar.append(edit, tags);
        }
      }
    }, { passive: true });
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
  updatePagerBar();
}
function openBookEditModal(book) {
  openOverlay("Edit Book", (content) => {
    const card = el("div", "list-item");
    const inputTitle = el("input"); inputTitle.value = book.title; inputTitle.placeholder = "Title";
    const inputDesc = el("input"); inputDesc.value = firstDefined(book, ["description", "desc", "summary"]) || ""; inputDesc.placeholder = "Description (optional)";
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
    const save = el("button", "primary-btn"); save.textContent = "Save";
    const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel";
    actions.append(save, cancel);
    card.append(inputTitle, inputDesc, actions);
    content.append(card);
    cancel.onclick = () => closeOverlay(true);
    save.onclick = async () => {
      const title = inputTitle.value.trim();
      const description = inputDesc.value.trim();
      if (!title) { showToast("Title required"); return; }
      try {
        const { error } = await state.supabase
          .from("books")
          .update({ title, description })
          .eq("id", book.id)
          .eq("family_id", state.familyId);
        if (error) throw error;
        closeOverlay(true);
        showToast("Book updated");
        await loadBooks();
      } catch (e) {
        console.error(e);
        showToast(e.message || "Update failed");
      }
    };
  }, true);
}
async function deleteBook(book) {
  if (!confirm("Delete this book?")) return;
  try {
    const { error } = await state.supabase
      .from("books")
      .delete()
      .eq("id", book.id)
      .eq("family_id", state.familyId);
    if (error) throw error;
    showToast("Book deleted");
    await loadBooks();
  } catch (e) {
    console.error(e);
    showToast(e.message || "Delete failed");
  }
}
function openBookDetail(book) {
  qs("#bookDetail").classList.remove("hidden");
  qs("#bookTitleView").textContent = book.title;
  qs("#bookDescriptionView").textContent = firstDefined(book, ["description", "desc", "summary"]) || "";
  pushDetailState("book");
  state.bookDetailPagination = { page: 0, pageSize: 20, hasMore: true, bookId: book.id };
  state.bookDetailNotes = [];
  renderBookDetailNotes();
  loadBookNotes({ replace: true });
  qs("#btnCloseBook").onclick = () => qs("#bookDetail").classList.add("hidden");
  qs("#btnCloseBook").onclick = () => { qs("#bookDetail").classList.add("hidden"); history.back(); };
}

async function loadBookNotes(opts = {}) {
  const p = state.bookDetailPagination;
  const offset = p.page * p.pageSize;
  const rows = await safeFetch(async () => {
    const { data, error } = await state.supabase
      .from("notes")
      .select("id,title,created_at")
      .eq("family_id", state.familyId)
      .eq("book_id", p.bookId)
      .order("created_at", { ascending: false })
      .range(offset, offset + p.pageSize - 1);
    if (error) throw error;
    return data;
  }, null);
  if (opts.replace) {
    state.bookDetailNotes = rows || [];
  } else {
    state.bookDetailNotes = [...(state.bookDetailNotes || []), ...(rows || [])];
  }
  p.hasMore = (rows || []).length >= p.pageSize;
  renderBookDetailNotes();
}

function renderBookDetailNotes() {
  const list = qs("#bookNotesList");
  list.innerHTML = "";
  (state.bookDetailNotes || []).forEach((note) => {
    const item = el("div", "list-item");
    const title = el("div", "title");
    title.textContent = note.title;
    const prev = el("div", "preview");
    prev.textContent = "Loading preview…";
    item.append(title, prev);
    list.appendChild(item);
    let page = 0;
    const fetchChunk = async () => {
      const { data } = await state.supabase
      .from("paragraphs")
      .select("content_html")
      .eq("note_id", note.id)
      .order("created_at", { ascending: true })
      .range(page * 10, page * 10 + 9);
      const join = (data || []).map((p) => truncateLines(p.content_html || "", 5)).join("\n");
      if (page === 0) {
        prev.textContent = join || "No content yet";
      } else {
        prev.textContent = [prev.textContent, join].filter(Boolean).join("\n");
      }
      return data || [];
    };
    fetchChunk().catch(() => { prev.textContent = "Preview unavailable"; });
    const more = el("button", "icon-btn");
    more.textContent = "Load more content";
    more.onclick = async () => {
      page += 1;
      const rows = await fetchChunk();
      if (rows.length < 10) {
        more.disabled = true;
      }
    };
    item.appendChild(more);
    item.onclick = () => openNoteDetail(note);
  });
  const p = state.bookDetailPagination;
  if (p.hasMore) {
    const more = el("button", "drawer-item");
    more.textContent = "Load more notes";
    more.onclick = async () => {
      p.page += 1;
      await loadBookNotes();
    };
    list.appendChild(more);
  }
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
    try {
      await state.supabase.from("books").insert({
        family_id: state.familyId,
        title: inputTitle.value.trim(),
        description: inputDesc.value.trim(),
      });
      host.classList.add("hidden"); host.innerHTML = "";
      await loadBooks();
      showToast("Book created");
      try { state.usage.booksCreated = (state.usage.booksCreated || 0) + 1; localStorage.setItem("pwa.usage", JSON.stringify(state.usage)); } catch {}
    } catch (e) {
      console.error(e);
      showToast(e.message || "Failed to create book");
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
  renderTagChips("activities");
  const term = qs("#activitiesSearchInput")?.value?.toLowerCase() || "";
  const pins = getPins("activities");
  const tagFilters = state.filters.activitiesTags || [];
  const items = (state.activities || []).filter((a) =>
    !term ||
    (a.title?.toLowerCase().includes(term)) ||
    (firstDefined(a, ["description", "details", "desc"]).toLowerCase().includes(term)) ||
    (a.location?.toLowerCase().includes(term))
  ).sort((a, b) => {
    const ap = pins.has(a.id) ? 1 : 0;
    const bp = pins.has(b.id) ? 1 : 0;
    return bp - ap;
  }).filter((a) => {
    if (!tagFilters.length) return true;
    const map = getTags("activities"); const arr = map.get(String(a.id)) || [];
    return tagFilters.every((t) => arr.includes(t));
  });
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
    const pin = el("button", "icon-btn");
    pin.textContent = pins.has(a.id) ? "★" : "☆";
    pin.onclick = (e) => { e.stopPropagation(); togglePin("activities", a.id); renderActivitiesScreen(); };
    const tagBtn = el("button", "icon-btn"); tagBtn.textContent = "Tags";
    tagBtn.onclick = (e) => { e.stopPropagation(); openEditTags("activities", a.id, a.title); };
    item.append(title, meta, prev, pin, tagBtn);
    item.onclick = () => openActivityDetail(a);
    list.appendChild(item);
  });
  updatePagerBar();
}
async function openActivityDetail(a) {
  qs("#activityDetail").classList.remove("hidden");
  qs("#activityTitleView").textContent = a.title;
  qs("#activityInfo").textContent = `${fmtTime(a.datetime)} ${a.location ? " • " + a.location : ""}`;
  pushDetailState("activity");
  const linked = qs("#activityLinked");
  linked.innerHTML = "";
  const rsvpBar = el("div", "reaction-bar");
  const going = el("button", "icon-btn"); going.textContent = "Going";
  const maybe = el("button", "icon-btn"); maybe.textContent = "Maybe";
  const notgo = el("button", "icon-btn"); notgo.textContent = "Not going";
  const counts = el("div", "detail-subtitle"); counts.textContent = "RSVP: —";
  const remind = el("button", "icon-btn"); remind.textContent = "Add reminder";
  const refreshCounts = async () => {
    try {
      const { data } = await state.supabase
        .from("activity_rsvps")
        .select("status")
        .eq("activity_id", a.id);
      const stats = { going: 0, maybe: 0, not: 0 };
      (data || []).forEach((r) => { if (r.status === "going") stats.going++; else if (r.status === "maybe") stats.maybe++; else stats.not++; });
      counts.textContent = `RSVP: Going ${stats.going} • Maybe ${stats.maybe} • Not ${stats.not}`;
    } catch {
      const local = getLocalRSVP(a.id);
      counts.textContent = `RSVP: ${local ? local.status : "—"}`;
    }
  };
  const doRSVP = async (status) => {
    try {
      const payload = { activity_id: a.id, user_id: state.user.id, status };
      const { error } = await state.supabase.from("activity_rsvps").upsert(payload, { onConflict: "activity_id,user_id" });
      if (error) throw error;
      showToast("RSVP saved");
    } catch {
      saveLocalRSVP(a.id, { user_id: state.user.id, status });
      showToast("RSVP saved locally");
    }
    refreshCounts();
  };
  const openReminderPicker = () => {
    openOverlay("Reminder", (content) => {
      const when = el("input"); when.type = "datetime-local"; when.value = formatDateTimeLocal(new Date());
      const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px";
      const save = el("button", "primary-btn"); save.textContent = "Save";
      save.onclick = () => { saveReminder(a.id, new Date(when.value).toISOString()); closeOverlay(true); showToast("Reminder set"); };
      const cancel = el("button", "icon-btn"); cancel.textContent = "Cancel"; cancel.onclick = () => closeOverlay(true);
      actions.append(save, cancel);
      content.append(when, actions);
    }, true);
  };
  going.onclick = () => doRSVP("going");
  maybe.onclick = () => doRSVP("maybe");
  notgo.onclick = () => doRSVP("not");
  remind.onclick = openReminderPicker;
  rsvpBar.append(going, maybe, notgo, remind);
  linked.append(rsvpBar, counts);
  refreshCounts();
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
  const inputDate = el("input"); inputDate.type = "datetime-local"; inputDate.value = formatDateTimeLocal(new Date());
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
      try { state.usage.activitiesCreated = (state.usage.activitiesCreated || 0) + 1; localStorage.setItem("pwa.usage", JSON.stringify(state.usage)); } catch {}
    } catch (e) {
      console.error(e);
      showToast(e.message || "Failed to create activity");
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
async function loadConversation(peerId, opts = {}) {
  const p = state.pagination.conversation;
  if (typeof opts.page === "number") p.page = opts.page;
  const offset = p.page * p.pageSize;
  const { data, error } = await state.supabase
    .from("messages")
    .select("*")
    .eq("family_id", state.familyId)
    .or(`and(sender_id.eq.${state.user.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${state.user.id})`)
    .order("created_at", { ascending: false })
    .range(offset, offset + p.pageSize - 1);
  if (error) {
    state.conversationMessages = [];
  } else {
    const fetchedAsc = (data || []).slice().reverse();
    if (opts.replace) {
      state.conversationMessages = fetchedAsc;
    } else {
      state.conversationMessages = [...fetchedAsc, ...(state.conversationMessages || [])];
    }
    state.pagination.conversation.hasMore = (data || []).length >= p.pageSize;
  }
  renderConversation(peerId);
}
function renderConversation(peerId) {
  const conv = qs("#conversationView");
  conv.classList.remove("hidden");
  state.chatOpenMemberId = peerId;
  const peer = state.members.find((m) => m.id === peerId);
  qs("#conversationTitle").textContent = peer?.display_name || peerId;
  const fam = state.families.find((f) => f.id === state.familyId)?.name || "—";
  const bc = qs("#conversationBreadcrumbs"); if (bc) bc.textContent = `Family: ${fam} • Chat`;
  const area = qs("#messagesArea");
  area.innerHTML = "";
  const messages = state.conversationMessages || [];
  const loadOlder = el("button", "icon-btn"); loadOlder.textContent = "Load older";
  loadOlder.style.marginBottom = "8px";
  loadOlder.onclick = async () => {
    const p = state.pagination.conversation;
    await loadConversation(peerId, { page: p.page + 1 });
    area.scrollTop = 0;
  };
  if (state.pagination.conversation.hasMore) {
    area.appendChild(loadOlder);
  }
  const typingRow = el("div", "detail-subtitle"); typingRow.id = "typingIndicator";
  area.appendChild(typingRow);
  messages.forEach((msg) => {
    const b = el("div", "bubble");
    if (msg.sender_id === state.user.id) b.classList.add("me");
    b.innerHTML = linkify(msg.content || "");
    const t = el("div", "time");
    t.textContent = fmtTime(msg.created_at);
    b.appendChild(t);
    area.appendChild(b);
  });
  const pend = (state.pendingMessages || {})[peerId] || [];
  pend.forEach((msg) => {
    const b = el("div", "bubble"); b.classList.add("me");
    b.innerHTML = linkify(msg.content || "");
    const t = el("div", "time"); t.textContent = "Pending";
    b.appendChild(t);
    area.appendChild(b);
  });
  subscribeChatPresence(peerId);
  const cf = qs("#chatFileInput");
  if (cf) {
    cf.onchange = async () => {
      if (!cf.files || !cf.files[0]) return;
      const file = cf.files[0];
      await uploadChatAttachment(peerId, file);
      cf.value = "";
    };
  }
  area.scrollTop = area.scrollHeight;
  const latestBtn = qs("#btnScrollLatest");
  if (latestBtn) {
    latestBtn.onclick = () => {
      area.scrollTop = area.scrollHeight;
    };
    area.onscroll = async () => {
      const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 40;
      latestBtn.style.display = nearBottom ? "none" : "inline-block";
      const nearTop = area.scrollTop < 20;
      if (nearTop && state.pagination.conversation.hasMore && !state.loadingOlderMessages) {
        state.loadingOlderMessages = true;
        const p = state.pagination.conversation;
        await loadConversation(peerId, { page: p.page + 1 });
        state.loadingOlderMessages = false;
      }
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
  state.pagination.conversation = { page: 0, pageSize: 30, hasMore: true };
  loadConversation(peerId, { replace: true, page: 0 });
}
async function sendMessage() {
  const input = qs("#messageInput");
  const content = input.value.trim();
  if (!content || !state.chatOpenMemberId) return;
  try {
    if (!state.online || !state.supabase) {
      enqueueMessage(state.chatOpenMemberId, content);
      input.value = "";
      renderConversation(state.chatOpenMemberId);
      showToast("Queued");
    } else {
      const { error } = await state.supabase.from("messages").insert({
        family_id: state.familyId,
        sender_id: state.user.id,
        receiver_id: state.chatOpenMemberId,
        content,
      });
      if (error) throw error;
      input.value = "";
      await loadConversation(state.chatOpenMemberId, { replace: true, page: 0 });
    }
  } catch {
    enqueueMessage(state.chatOpenMemberId, content);
    input.value = "";
    renderConversation(state.chatOpenMemberId);
    showToast("Queued");
  }
}

async function uploadNoteAttachment(noteId, file) {
  if (!state.supabase) { showToast("Storage not configured"); return; }
  try {
    const path = `${state.familyId}/notes/${noteId}/${Date.now()}_${file.name}`;
    const { error } = await state.supabase.storage.from("attachments").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = state.supabase.storage.from("attachments").getPublicUrl(path);
    const url = data?.publicUrl || "";
    const html = `<p><a href="${url}" target="_blank" rel="noopener">Attachment: ${file.name}</a></p>`;
    const { error: err2 } = await state.supabase.from("paragraphs").insert({
      note_id: noteId, family_id: state.familyId, author_id: state.user.id,
      author_name: state.user.user_metadata?.full_name || state.user.email,
      content_html: html,
    });
    if (err2) throw err2;
    await loadParagraphs(noteId);
    showToast("Attachment added");
  } catch {
    showToast("Upload failed");
  }
}
async function uploadChatAttachment(peerId, file) {
  if (!state.supabase) { showToast("Storage not configured"); return; }
  try {
    const path = `${state.familyId}/chat/${state.user.id}/${Date.now()}_${file.name}`;
    const { error } = await state.supabase.storage.from("attachments").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = state.supabase.storage.from("attachments").getPublicUrl(path);
    const url = data?.publicUrl || "";
    const content = `[Attachment] ${file.name} ${url}`;
    const { error: err2 } = await state.supabase.from("messages").insert({
      family_id: state.familyId, sender_id: state.user.id, receiver_id: peerId, content,
    });
    if (err2) throw err2;
    await loadConversation(peerId, { replace: true, page: 0 });
    showToast("Attachment sent");
  } catch {
    showToast("Upload failed");
  }
}

/* =========================================
   Refresh & export
========================================= */
async function doRefresh() {
  await ensureFamilyContext();
  await loadAllData();
  if (state.chatOpenMemberId) {
    await loadConversation(state.chatOpenMemberId);
  }
  showToast("Data refreshed");
}

function resetPagination() {
  state.pagination = {
    books: { page: 0, pageSize: 20, hasMore: true, term: "" },
    notes: { page: 0, pageSize: 20, hasMore: true, term: "" },
    activities: { page: 0, pageSize: 20, hasMore: true, term: "" },
    conversation: { page: 0, pageSize: 30, hasMore: true },
  };
}

function updatePagerBar() {
  const bar = qs("#pagerBar");
  const btn = qs("#btnLoadMore");
  if (!bar || !btn) return;
  const route = state.route;
  let hasMore = false;
  if (route === "books") hasMore = !!state.pagination.books.hasMore;
  else if (route === "notes") hasMore = !!state.pagination.notes.hasMore;
  else if (route === "activities") hasMore = !!state.pagination.activities.hasMore;
  else hasMore = false;
  bar.classList.toggle("hidden", !hasMore);
}

function preloadRoutes() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 350));
  idle(async () => {
    if (!state.supabase || !state.familyId) return;
    try {
      if (state.route !== "books" && state.pagination.books.page === 0 && (state.books || []).length === 0) {
        await loadBooks({ replace: true, page: 0 });
      }
      if (state.route !== "notes" && state.pagination.notes.page === 0 && (state.notes || []).length === 0) {
        await loadNotes({ replace: true, page: 0 });
      }
      if (state.route !== "activities" && state.pagination.activities.page === 0 && (state.activities || []).length === 0) {
        await loadActivities({ replace: true, page: 0 });
      }
    } catch {}
  });
}

function initSendQueue() {
  state.pendingMessages = {};
  const key = state.user && state.familyId ? STORAGE_KEYS.queueMessages(state.familyId, state.user.id) : null;
  try {
    if (key) {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.forEach((m) => {
        if (!state.pendingMessages[m.peerId]) state.pendingMessages[m.peerId] = [];
        state.pendingMessages[m.peerId].push(m);
      });
    }
  } catch {}
}

function initReminderWatcher() {
  setInterval(() => {
    if (!state.familyId) return;
    try {
      const key = STORAGE_KEYS.remindersActivities(state.familyId);
      const map = JSON.parse(localStorage.getItem(key) || "{}");
      const now = Date.now();
      Object.entries(map).forEach(([aid, when]) => {
        const ts = Date.parse(when);
        if (ts && ts <= now && !map[`done_${aid}`]) {
          map[`done_${aid}`] = true;
          localStorage.setItem(key, JSON.stringify(map));
          const a = (state.activities || []).find((x) => String(x.id) === String(aid));
          showToast(`Reminder: ${a?.title || "Activity"}`);
        }
      });
    } catch {}
  }, 30000);
}
function saveSendQueue() {
  const key = state.user && state.familyId ? STORAGE_KEYS.queueMessages(state.familyId, state.user.id) : null;
  if (!key) return;
  const arr = [];
  Object.entries(state.pendingMessages || {}).forEach(([peerId, msgs]) => {
    msgs.forEach((m) => arr.push({ peerId, content: m.content, created_at: m.created_at }));
  });
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
}
function enqueueMessage(peerId, content) {
  if (!state.pendingMessages) state.pendingMessages = {};
  if (!state.pendingMessages[peerId]) state.pendingMessages[peerId] = [];
  state.pendingMessages[peerId].push({ content, created_at: new Date().toISOString() });
  saveSendQueue();
}
async function flushSendQueue() {
  if (!state.online || !state.supabase || !state.user || !state.familyId) return;
  const keys = Object.keys(state.pendingMessages || {});
  for (const peerId of keys) {
    const msgs = state.pendingMessages[peerId] || [];
    const remain = [];
    for (const m of msgs) {
      try {
        const { error } = await state.supabase.from("messages").insert({
          family_id: state.familyId,
          sender_id: state.user.id,
          receiver_id: peerId,
          content: m.content,
        });
        if (error) { remain.push(m); } else {
        }
      } catch {
        remain.push(m);
      }
    }
    state.pendingMessages[peerId] = remain;
    saveSendQueue();
    if (peerId === state.chatOpenMemberId) {
      await loadConversation(peerId, { replace: true, page: 0 });
    }
  }
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

async function doLogout() {
  try {
    if (state.supabase) {
      await state.supabase.auth.signOut();
    }
  } catch {}
  try {
    state.subscriptions.forEach((c) => c.unsubscribe && c.unsubscribe());
  } catch {}
  state.subscriptions = [];
  localStorage.removeItem("pwa.local.session");
  state.session = null;
  state.user = null;
  state.familyId = null;
  state.families = [];
  state.books = [];
  state.notes = [];
  state.activities = [];
  state.members = [];
  state.currentRole = null;
  showAuthScreen();
  showToast("Signed out");
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
    openOverlay("Help / About", (content) => {
      const card = el("div", "list-item");
      const title = el("div", "detail-title"); title.textContent = "Mobile Testing Guide";
      const steps = el("div", "list");
      const s1 = el("div", "list-item"); s1.textContent = "Open DevTools: F12 or Ctrl+Shift+I";
      const s2 = el("div", "list-item"); s2.textContent = "Toggle Device Mode: Ctrl+Shift+M";
      const s3 = el("div", "list-item"); s3.textContent = "Pick a device: iPhone 14 Pro / Pixel 7";
      const s4 = el("div", "list-item"); s4.textContent = "Rotate the device and test long titles";
      const s5 = el("div", "list-item"); s5.textContent = "Use Network throttling to simulate 3G";
      steps.append(s1, s2, s3, s4, s5);
      const card2 = el("div", "list-item");
      const t2 = el("div", "detail-title"); t2.textContent = "Compact Mode (In-App)";
      const p2 = el("div", "preview"); p2.textContent = "Use Drawer → Toggle Compact Mode to emulate a narrow viewport quickly.";
      card.append(title, steps);
      card2.append(t2, p2);
      content.append(card, card2);
    }, true);
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
  const healthBtn = qs("#btnHealth");
  if (healthBtn) healthBtn.onclick = () => { openHealthCheck(); closeDrawer(); };
  const switchModeBtn = qs("#btnSwitchMode");
  if (switchModeBtn) switchModeBtn.onclick = () => {
    setAuthMode(state.authMode === "member" ? "manager" : "member");
    closeDrawer();
  };
  const compactBtn = qs("#btnCompactMode");
  if (compactBtn) compactBtn.onclick = () => { document.body.classList.toggle("compact-mode"); closeDrawer(); };
  const installBtn = qs("#btnInstall");
  if (installBtn) installBtn.onclick = async () => {
    closeDrawer();
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      showToast(choice.outcome === "accepted" ? "Install started" : "Install dismissed");
    } else {
      openOverlay("Install App", (content) => {
        const card = el("div", "list-item");
        const p = el("div", "preview");
        p.textContent = "On iOS: Safari → Share → Add to Home Screen. On Android/Desktop (Chrome/Edge): Use the browser menu or the install icon in the address bar.";
        card.append(p);
        content.append(card);
      }, true);
    }
  };
  const logoutBtn = qs("#btnLogout");
  if (logoutBtn) logoutBtn.onclick = async () => { await doLogout(); closeDrawer(); };
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
      reset: "#authResetForm",
    };
    Object.values(map).forEach((sel) => qs(sel).classList.add("hidden"));
    qs(map[action]).classList.remove("hidden");
    if (actionLoginBtn) actionLoginBtn.classList.toggle("seg-btn--active", action === "login");
    if (actionRegisterBtn) actionRegisterBtn.classList.toggle("seg-btn--active", action === "register");
    if (actionMagicBtn) actionMagicBtn.classList.toggle("seg-btn--active", action === "magic");
    if (actionResetBtn) actionResetBtn.classList.toggle("seg-btn--active", action === "reset");
  }
  if (actionLoginBtn) actionLoginBtn.onclick = () => setAuthAction("login");
  if (actionRegisterBtn) actionRegisterBtn.onclick = () => setAuthAction("register");
  if (actionMagicBtn) actionMagicBtn.onclick = () => setAuthAction("magic");
  if (actionResetBtn) actionResetBtn.onclick = () => setAuthAction("reset");
  ["#authLoginForm", "#authRegisterForm", "#authResetForm"].forEach((sel) => qs(sel).classList.add("hidden"));
  // Local auth fallbacks
  function localUsers() {
    try { return JSON.parse(localStorage.getItem("pwa.local.users") || "[]"); } catch { return []; }
  }
  function saveLocalUsers(users) {
    localStorage.setItem("pwa.local.users", JSON.stringify(users));
  }
  function getLocalSession() {
    try { return JSON.parse(localStorage.getItem("pwa.local.session") || "null"); } catch { return null; }
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
    showRoleInfo();
  }
  reflectMode();
  modeMemberBtn && (modeMemberBtn.onclick = () => { setAuthMode("member"); reflectMode(); });
  modeManagerBtn && (modeManagerBtn.onclick = () => { setAuthMode("manager"); reflectMode(); });
  const forgotBtn = qs("#btnForgotPassword");
  if (forgotBtn) forgotBtn.onclick = () => setAuthAction("reset");
  function showRoleInfo() {
    const title = state.authMode === "manager" ? "Manager" : "Member";
    const desc = state.authMode === "manager"
      ? "Managers can create families, approve join requests, and manage shared content."
      : "Members can join a family and collaborate on notes, books, activities, and chat.";
    const info = qs("#authRoleInfo");
    const t = qs("#authRoleTitle");
    const d = qs("#authRoleDesc");
    const actionToggle = qs("#authActionToggle");
    ["#authLoginForm", "#authRegisterForm", "#authResetForm"].forEach((sel) => qs(sel).classList.add("hidden"));
    actionToggle.classList.add("hidden");
    t.textContent = title;
    d.textContent = desc;
    info.classList.remove("hidden");
    const contBtn = qs("#authRoleContinueBtn");
    contBtn.onclick = () => {
      info.classList.add("hidden");
      actionToggle.classList.remove("hidden");
      setAuthAction("login");
    };
  }
  // Notes
  qs("#btnNewNote").onclick = openNewNoteModal;
  // Books
  qs("#btnCreateBook").onclick = openCreateBookModal;
  // Activities
  qs("#btnCreateActivity").onclick = openCreateActivityModal;
  const calBtn = qs("#btnOpenCalendar");
  if (calBtn) calBtn.onclick = openCalendarView;
  // Chat
  qs("#btnSendMessage").onclick = sendMessage;
  // Sync
  qs("#btnSync").onclick = doRefresh;
  // Search
  const ns = qs("#notesSearchInput");
  if (ns) ns.oninput = async () => {
    state.pagination.notes.term = ns.value.trim().toLowerCase();
    state.pagination.notes.page = 0;
    await loadNotes({ replace: true, page: 0 });
  };
  const bs = qs("#booksSearchInput");
  if (bs) bs.oninput = async () => {
    state.pagination.books.term = bs.value.trim().toLowerCase();
    state.pagination.books.page = 0;
    await loadBooks({ replace: true, page: 0 });
  };
  const as = qs("#activitiesSearchInput");
  if (as) as.oninput = async () => {
    state.pagination.activities.term = as.value.trim().toLowerCase();
    state.pagination.activities.page = 0;
    await loadActivities({ replace: true, page: 0 });
  };
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
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      openPerformanceMetrics();
    }
  });
  // Pull to refresh
  bindPullToRefresh();
  const loadMoreBtn = qs("#btnLoadMore");
  if (loadMoreBtn) {
    loadMoreBtn.onclick = async () => {
      if (state.loadingMore) return;
      state.loadingMore = true;
      loadMoreBtn.disabled = true;
      try {
        if (state.route === "books") {
          const p = state.pagination.books;
          await loadBooks({ page: p.page + 1 });
        } else if (state.route === "notes") {
          const p = state.pagination.notes;
          await loadNotes({ page: p.page + 1 });
        } else if (state.route === "activities") {
          const p = state.pagination.activities;
          await loadActivities({ page: p.page + 1 });
        }
      } finally {
        loadMoreBtn.disabled = false;
        state.loadingMore = false;
        updatePagerBar();
      }
    };
  }
  // Tag chips initial render
  renderTagChips("notes");
  renderTagChips("books");
  renderTagChips("activities");
}

function renderTagChips(kind) {
  const chipsRoot = qs(kind === "notes" ? "#notesTagChips" : kind === "books" ? "#booksTagChips" : "#activitiesTagChips");
  if (!chipsRoot) return;
  chipsRoot.innerHTML = "";
  const tags = allTags(kind);
  const selected = kind === "notes" ? (state.filters.notesTags || []) : kind === "books" ? (state.filters.booksTags || []) : (state.filters.activitiesTags || []);
  tags.forEach((t) => {
    const c = el("button", "chip"); c.textContent = t;
    c.classList.toggle("chip--active", selected.includes(t));
    c.onclick = () => {
      const arr = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
      if (kind === "notes") state.filters.notesTags = arr;
      if (kind === "books") state.filters.booksTags = arr;
      if (kind === "activities") state.filters.activitiesTags = arr;
      if (kind === "notes") renderNotesScreen();
      if (kind === "books") renderBooksScreen();
      if (kind === "activities") renderActivitiesScreen();
    };
    chipsRoot.appendChild(c);
  });
  const clear = el("button", "chip"); clear.textContent = "Clear";
  clear.onclick = () => {
    if (kind === "notes") state.filters.notesTags = [];
    if (kind === "books") state.filters.booksTags = [];
    if (kind === "activities") state.filters.activitiesTags = [];
    if (kind === "notes") renderNotesScreen();
    if (kind === "books") renderBooksScreen();
    if (kind === "activities") renderActivitiesScreen();
  };
  chipsRoot.appendChild(clear);
}

function openCalendarView() {
  openOverlay("Calendar", (content) => {
    const rangeDays = 35;
    const start = new Date(); start.setHours(0,0,0,0);
    const items = (state.activities || []).slice().sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
    const days = [];
    for (let i=0;i<rangeDays;i++) {
      const d = new Date(start); d.setDate(d.getDate()+i);
      const label = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      const dayItems = items.filter((a) => {
        const ad = new Date(a.datetime);
        return ad.getFullYear()===d.getFullYear() && ad.getMonth()===d.getMonth() && ad.getDate()===d.getDate();
      });
      days.push({ d, label, dayItems });
    }
    const list = el("div", "list");
    days.forEach(({ label, dayItems }) => {
      const it = el("div", "list-item");
      const ti = el("div", "title"); ti.textContent = label;
      const me = el("div", "meta"); me.textContent = dayItems.length ? `${dayItems.length} activities` : "—";
      it.append(ti, me);
      if (dayItems.length) {
        dayItems.forEach((a) => {
          const row = el("div", "preview");
          row.textContent = `${fmtTime(a.datetime)} ${a.title}${a.location ? " • " + a.location : ""}`;
          row.onclick = (e) => { e.stopPropagation(); setRoute("activities"); openActivityDetail(a); closeOverlay(true); };
          it.appendChild(row);
        });
      }
      list.appendChild(it);
    });
    content.append(list);
  }, true);
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
          const famId = newUuid();
          const payload = { id: famId, name, owner_id: state.user.id };
          const { error } = await state.supabase
            .from("families")
            .insert(payload, { returning: "minimal" });
          if (error) throw error;
          const { error: memberErr } = await state.supabase
            .from("family_members")
            .insert({ family_id: famId, user_id: state.user.id, role: "owner" });
          if (memberErr) throw memberErr;
          state.families.push({ id: famId, name });
          state.familyId = famId;
          localStorage.setItem(STORAGE_KEYS.lastFamily, famId);
          updateFamilyBadges();
          closeOverlay(true);
          loadAllData();
          rebindRealtime();
          loadMembershipRole();
        } catch (e) {
          console.error(e);
          showToast(e?.message || "Failed to create family");
        }
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
  try { const raw = localStorage.getItem("pwa.usage"); if (raw) state.usage = JSON.parse(raw); } catch {}
  window.addEventListener("error", (e) => { state.errors.push({ kind: "error", message: e.message, source: e.filename, line: e.lineno, col: e.colno, when: Date.now() }); if (state.errors.length > 100) state.errors.shift(); });
  window.addEventListener("unhandledrejection", (e) => { state.errors.push({ kind: "rejection", message: String(e.reason || ""), when: Date.now() }); if (state.errors.length > 100) state.errors.shift(); });
  initPerformanceObserver();
  initSendQueue();
  window.addEventListener("online", flushSendQueue);
  initReminderWatcher();
  await bootstrapSupabase();
  attemptAuthBootstrap();
  checkJoinLink();
  setOfflineBanner(false);
});

let sessionPollInterval;
function startSessionPoll() {
  if (sessionPollInterval) clearInterval(sessionPollInterval);
  sessionPollInterval = setInterval(async () => {
    if (!state.supabase) return;
    try {
      const { data } = await state.supabase.auth.getSession();
      const sess = data.session || null;
      if (sess) {
        state.session = sess;
        state.user = sess.user || null;
      }
    } catch {}
  }, 600000);
}

async function tryFetchConfig() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return false;
    const cfg = await res.json();
    if (cfg?.url && cfg?.anon) {
      localStorage.setItem(STORAGE_KEYS.supabase, JSON.stringify(cfg));
      state.supabase = supabase.createClient(cfg.url, cfg.anon, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
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
  return false;
}

/* local bootstrap removed */

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
      let items = [
        ...(state.notes || []).map((n) => ({ type: "note", title: n.title, item: n })),
        ...(state.books || []).map((b) => ({ type: "book", title: b.title, item: b })),
        ...(state.activities || []).map((a) => ({ type: "activity", title: a.title, item: a })),
        ...(state.members || [])
          .filter((m) => m.id !== state.user?.id)
          .map((m) => ({ type: "member", title: m.display_name || m.id, item: m })),
      ].filter((x) => !t || (x.title?.toLowerCase().includes(t)));
      const pinsN = getPins("notes"); const pinsB = getPins("books"); const pinsA = getPins("activities");
      items = items.map((x) => {
        const title = x.title?.toLowerCase() || "";
        const exact = title === t ? 3 : title.startsWith(t) ? 2 : title.includes(t) ? 1 : 0;
        const pin = x.type === "note" ? pinsN.has(x.item.id) : x.type === "book" ? pinsB.has(x.item.id) : x.type === "activity" ? pinsA.has(x.item.id) : false;
        const typeBoost = x.type === "note" ? 1.0 : x.type === "book" ? 0.8 : x.type === "activity" ? 0.9 : 0.6;
        const score = exact * 10 + (pin ? 5 : 0) + typeBoost;
        return { ...x, score };
      }).sort((a,b) => b.score - a.score);
      if (!items.length) {
        const empty = el("div", "list-item skeleton");
        empty.textContent = "No matches";
        list.appendChild(empty);
        return;
      }
      items.slice(0, 24).forEach((x) => {
        const it = el("div", "list-item");
        const ti = el("div", "title");
        const icon = x.type === "note" ? "📝" : x.type === "book" ? "📚" : x.type === "activity" ? "📅" : "👤";
        ti.textContent = `${icon} ${x.title}`;
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

function openPerformanceMetrics() {
  openOverlay("Performance", (content) => {
    const list = el("div", "list");
    const logs = (state.perf.logs || []).slice(-50).reverse();
    if (!logs.length) {
      const empty = el("div", "list-item");
      empty.textContent = "No metrics yet";
      list.appendChild(empty);
    } else {
      logs.forEach((l) => {
        const it = el("div", "list-item");
        const ti = el("div", "title");
        ti.textContent = `${l.op} • ${l.count} rows`;
        const me = el("div", "meta");
        me.textContent = `${l.ms} ms • ${new Date(l.when).toLocaleTimeString()}`;
        it.append(ti, me);
        list.appendChild(it);
      });
    }
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "8px";
    const clear = el("button", "icon-btn"); clear.textContent = "Clear";
    clear.onclick = () => { state.perf.logs = []; closeOverlay(true); };
    actions.append(clear);
    content.append(list, actions);
  }, true);
}
function openHealthCheck() {
  openOverlay("Client Health", (content) => {
    const list = el("div", "list");
    const caches = [];
    try {
      if (localStorage.getItem(STORAGE_KEYS.cacheNotes(state.familyId))) caches.push("notes");
      if (localStorage.getItem(STORAGE_KEYS.cacheBooks(state.familyId))) caches.push("books");
      if (localStorage.getItem(STORAGE_KEYS.cacheActivities(state.familyId))) caches.push("activities");
      if (localStorage.getItem(STORAGE_KEYS.cacheMembers(state.familyId))) caches.push("members");
    } catch {}
    const status = [
      { k: "Online", v: String(state.online) },
      { k: "Session", v: String(!!state.session) },
      { k: "User", v: state.user?.email || state.user?.id || "—" },
      { k: "Family", v: state.familyId || "—" },
      { k: "FamiliesLoaded", v: String((state.families || []).length) },
      { k: "MembershipCount", v: String((state.debug?.membershipIds || []).length) },
      { k: "LastFamilyKey", v: String(state.debug?.lastFamilyKey || "—") },
      { k: "URLFamilyParam", v: String(state.debug?.urlFamilyParam || "—") },
      { k: "Caches", v: caches.join(", ") || "none" },
      { k: "Errors", v: String((state.errors || []).length) },
      { k: "LongTasks", v: String((state.longTasks || []).length) },
      { k: "Usage", v: `books:${state.usage.booksCreated} notes:${state.usage.notesCreated} activities:${state.usage.activitiesCreated}` },
    ];
    status.forEach((s) => {
      const it = el("div", "list-item");
      const ti = el("div", "title"); ti.textContent = s.k;
      const me = el("div", "meta"); me.textContent = s.v;
      it.append(ti, me);
      list.appendChild(it);
    });
    const errorsTitle = el("div", "detail-subtitle"); errorsTitle.textContent = "Recent Errors";
    list.appendChild(errorsTitle);
    (state.errors || []).slice(-10).reverse().forEach((e) => {
      const it = el("div", "list-item");
      const ti = el("div", "title"); ti.textContent = e.message || String(e);
      const me = el("div", "meta"); me.textContent = new Date(e.when).toLocaleTimeString();
      it.append(ti, me);
      list.appendChild(it);
    });
    const actions = el("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "8px";
    const copy = el("button", "icon-btn"); copy.textContent = "Copy Report";
    copy.onclick = async () => {
      const rpt = { status, errors: state.errors.slice(-50), perf: state.perf.logs.slice(-50) };
      const text = JSON.stringify(rpt, null, 2);
      try { await navigator.clipboard.writeText(text); showToast("Copied"); } catch { showToast("Copy failed"); }
    };
    const close = el("button", "icon-btn"); close.textContent = "Close";
    close.onclick = () => closeOverlay(true);
    actions.append(copy, close);
    content.append(list, actions);
  }, true);
}
function initPerformanceObserver() {
  try {
    const po = new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        state.longTasks.push({ duration: Math.round(e.duration), start: e.startTime, when: Date.now() });
        if (state.longTasks.length > 200) state.longTasks.shift();
      });
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch {}
}
function saveReminder(activityId, whenIso) {
  if (!state.familyId) return;
  try {
    const key = STORAGE_KEYS.remindersActivities(state.familyId);
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[String(activityId)] = whenIso;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}
function getLocalRSVP(activityId) {
  if (!state.familyId) return null;
  try {
    const key = STORAGE_KEYS.rsvpActivity(state.familyId, activityId);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveLocalRSVP(activityId, payload) {
  if (!state.familyId) return;
  try {
    const key = STORAGE_KEYS.rsvpActivity(state.familyId, activityId);
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {}
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
    const copyCode = el("button", "icon-btn"); copyCode.textContent = "Copy Code";
    const copy = el("button", "icon-btn"); copy.textContent = "Copy Link";
    const hasCode = !!fam?.join_code;
    copy.disabled = !hasCode;
    copyCode.disabled = !hasCode;
    actions.append(gen, copyCode, copy);
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
        copy.disabled = false;
        copyCode.disabled = false;
        showToast("Join code updated");
      } catch {
        showToast("Failed to update code");
      }
    };
    copyCode.onclick = async () => {
      const code = codeView.textContent || "";
      if (!code || code === "No code yet") { showToast("Generate a code first"); return; }
      try { await navigator.clipboard.writeText(code); showToast("Code copied"); } catch { showToast("Copy failed"); }
    };
    copy.onclick = async () => {
      const base = location.origin + location.pathname;
      const code = codeView.textContent || "";
      if (!code || code === "No code yet") { showToast("Generate a code first"); return; }
      const link = `${base}?join=${encodeURIComponent(code)}`;
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

async function checkRouteLink() {
  const params = new URLSearchParams(location.search);
  const r = params.get("route");
  const id = params.get("id");
  const mode = params.get("mode");
  if (!r) return;
  if (!state.user || !state.familyId) return;
  if (r === "notes") {
    setRoute("notes");
    if (id) {
      const n = (state.notes || []).find((x) => String(x.id) === String(id));
      if (n) await openNoteDetail(n, { showTitle: true, readonly: mode === "view" });
    }
  } else if (r === "books") {
    setRoute("books");
    if (id) {
      const b = (state.books || []).find((x) => String(x.id) === String(id));
      if (b) openBookDetail(b);
    }
  } else if (r === "activities") {
    setRoute("activities");
    if (id) {
      const a = (state.activities || []).find((x) => String(x.id) === String(id));
      if (a) openActivityDetail(a);
    }
  } else if (r === "chat") {
    setRoute("chat");
    if (id) {
      openConversation(id, id);
    }
  }
  const base = location.origin + location.pathname;
  history.replaceState(null, "", base);
}
