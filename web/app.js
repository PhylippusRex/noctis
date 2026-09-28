/* ---------- Noctis frontend ---------- */
const DATA_URL = "../data/briefing.json";
const ARCHIVE_INDEX_URL = "../data/archive/index.json"; // optional; see README
const ARCHIVE_DIR = "../data/archive/";
const WATCH_KEY = "noctis-watchlist";
const THEME_KEY = "noctis-theme";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- theme ---------- */
function initTheme() {
  const btn = $("#themeBtn");
  btn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });
}

/* ---------- watchlist (localStorage) ---------- */
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch (e) { return []; }
}
function setWatchlist(list) {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) {}
}
function addToWatchlist(ticker) {
  ticker = (ticker || "").trim().toUpperCase();
  if (!ticker) return;
  const list = getWatchlist();
  if (!list.includes(ticker)) { list.push(ticker); setWatchlist(list); }
  renderWatchlist();
  renderMovers();
}
function removeFromWatchlist(ticker) {
  setWatchlist(getWatchlist().filter(t => t !== ticker));
  renderWatchlist();
  renderMovers();
}

/* ---------- state ---------- */
let STATE = null;   // the loaded briefing JSON
let VIEW = "table";
let FILTER = "all";
let SORT = { key: "pct_change", dir: "desc" };

/* ---------- fetch ---------- */
async function loadBriefing(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load " + url);
  return res.json();
}

async function populateDatePicker() {
  const sel = $("#dateSelect");
  try {
    const idx = await loadBriefing(ARCHIVE_INDEX_URL);
    (idx.dates || []).forEach(d => {
      const opt = document.createElement("option");
      opt.value = ARCHIVE_DIR + d + ".json";
      opt.textContent = d;
      sel.appendChild(opt);
    });
  } catch (e) {
    // no archive index yet -- fine, "Latest briefing" still works
  }
  sel.addEventListener("change", () => {
    boot(sel.value || DATA_URL);
  });
}

/* ---------- render: hero ---------- */
function renderHero() {
  const b = STATE.briefing;
  $("#headline").textContent = b.headline || "Briefing unavailable";
  const mood = (b.mood || "mixed").toLowerCase();
  const moodEl = $("#mood");
  moodEl.textContent = mood.replace("-", " ");
  moodEl.className = "mood " + mood;
  const br = b.breadth;
  $("#breadth").textContent = br
    ? `${br.advancers} up · ${br.decliners} down of ${br.core_count} core names · avg ${fmtPct(br.core_avg_pct)}`
    : "";
  $("#summary").textContent = b.summary || "";
  const gen = STATE.generated_at ? new Date(STATE.generated_at) : null;
  $("#meta").textContent = gen ? "Generated " + gen.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  $("#session").textContent = `Window: last ${STATE.window_hours}h since US close`;
  $("#dateLabel").textContent = gen ? "· " + gen.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  $("#marketNote").textContent = STATE.market_note || "";
}

/* ---------- render: while-you-slept timeline ---------- */
function renderTimeline() {
  const core = STATE.core_movers || [];
  const el = $("#tlChart");
  el.innerHTML = "";
  if (!core.length) { $("#tlNote").textContent = ""; return; }
  const w = el.clientWidth || 600, h = 92, pad = 16;
  const vals = core.map(m => m.pct_change);
  const maxAbs = Math.max(1, ...vals.map(v => Math.abs(v)));
  const mid = h / 2;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const line = document.createElementNS(svgNS, "line");
  line.setAttribute("x1", 0); line.setAttribute("x2", w);
  line.setAttribute("y1", mid); line.setAttribute("y2", mid);
  line.setAttribute("stroke", "var(--border)");
  svg.appendChild(line);

  const n = core.length;
  const step = (w - pad * 2) / Math.max(1, n - 1);
  const tip = document.createElement("div");
  tip.className = "tl-tip";
  el.appendChild(tip);

  core.forEach((m, i) => {
    const x = n === 1 ? w / 2 : pad + i * step;
    const y = mid - (m.pct_change / maxAbs) * (mid - 14);
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", 5);
    dot.setAttribute("fill", m.pct_change >= 0 ? "var(--up)" : "var(--down)");
    dot.classList.add("tl-dot");
    dot.addEventListener("mouseenter", () => showTip(tip, x, y, m));
    dot.addEventListener("mouseleave", () => tip.classList.remove("show"));
    dot.addEventListener("click", () => openDetail(m));
    svg.appendChild(dot);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x); label.setAttribute("y", h - 2);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--text-faint)");
    label.textContent = m.ticker;
    svg.appendChild(label);
  });
  el.appendChild(svg);
  $("#tlNote").textContent = `Each point is a core name's move since the last US close. Tap a point for detail.`;
}
function showTip(tip, x, y, m) {
  tip.textContent = `${m.ticker} ${fmtPct(m.pct_change)}`;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
  tip.classList.add("show");
}

/* ---------- render: open outlook + macro ---------- */
function renderOutlook() {
  const b = STATE.briefing;
  $("#outlook").textContent = b.open_outlook || b.other_movers_note || "No outlook available.";
  const chips = $("#todayChips");
  chips.innerHTML = "";
  (b.watchlist_today || []).forEach(t => {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = t;
    chips.appendChild(c);
  });
}
function renderMacro() {
  const el = $("#macro");
  el.innerHTML = "";
  const items = STATE.briefing.macro_context || [];
  if (!items.length) { el.innerHTML = '<p class="empty">No macro items in this briefing.</p>'; return; }
  items.forEach(m => {
    const div = document.createElement("div");
    div.className = "macro-item";
    div.innerHTML = `<h3>${escapeHtml(m.title || "")}</h3><p>${escapeHtml(m.detail || "")}</p>`;
    el.appendChild(div);
  });
}

/* ---------- render: movers (table + heatmap) ---------- */
function moverRows() {
  const CORE = new Set((STATE.core_movers || []).map(m => m.ticker));
  const briefMap = new Map((STATE.briefing.movers || []).map(m => [m.ticker, m]));
  const all = [...(STATE.core_movers || []), ...(STATE.other_movers || [])];
  return all.map(m => ({
    ticker: m.ticker, pct_change: m.pct_change, range_pct: m.range_pct,
    turnover_usdt: m.turnover_usdt, isCore: CORE.has(m.ticker),
    why: briefMap.get(m.ticker)?.why || null,
    confidence: briefMap.get(m.ticker)?.confidence || null,
    watch_today: briefMap.get(m.ticker)?.watch_today || null,
  }));
}
function applyFilterSort(rows) {
  const watch = new Set(getWatchlist());
  let out = rows;
  if (FILTER === "core") out = out.filter(r => r.isCore);
  if (FILTER === "watch") out = out.filter(r => watch.has(r.ticker));
  out = out.slice().sort((a, b) => {
    const dir = SORT.dir === "asc" ? 1 : -1;
    const av = SORT.key === "pct_change" ? Math.abs(a.pct_change) : a[SORT.key];
    const bv = SORT.key === "pct_change" ? Math.abs(b.pct_change) : b[SORT.key];
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  return out;
}
function renderMovers() {
  const rows = applyFilterSort(moverRows());
  const body = $("#moversBody");
  body.innerHTML = "";
  if (!rows.length) { body.innerHTML = '<p class="empty">No movers match this filter.</p>'; return; }
  if (VIEW === "table") body.appendChild(buildTable(rows));
  else body.appendChild(buildHeatmap(rows));
  const others = STATE.other_movers || [];
  $("#otherNote").textContent = others.length
    ? `${others.length} additional non-core movers included below turnover $1M+.`
    : "";
}
function buildTable(rows) {
  const watch = new Set(getWatchlist());
  const table = document.createElement("table");
  table.className = "movers";
  table.innerHTML = `<thead><tr>
      <th data-key="ticker">Ticker</th>
      <th data-key="pct_change">Move</th>
      <th data-key="range_pct">Range</th>
      <th>Confidence</th><th></th>
    </tr></thead>`;
  $$("th[data-key]", table).forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      SORT = { key, dir: SORT.key === key && SORT.dir === "desc" ? "asc" : "desc" };
      renderMovers();
    });
  });
  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.className = "row";
    const up = r.pct_change >= 0;
    tr.innerHTML = `
      <td><span class="tkr">${escapeHtml(r.ticker)}</span>${r.isCore ? "" : '<span class="muted small"> · other</span>'}</td>
      <td class="pct ${up ? "up" : "down"}">${fmtPct(r.pct_change)}</td>
      <td class="muted">${r.range_pct != null ? r.range_pct.toFixed(1) + "%" : "—"}</td>
      <td>${r.confidence ? `<span class="conf">${escapeHtml(r.confidence)}</span>` : '<span class="muted small">—</span>'}</td>
      <td><button class="star ${watch.has(r.ticker) ? "on" : ""}" title="Watch" aria-label="Add ${r.ticker} to watchlist">★</button></td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".star")) return;
      openDetail(r);
    });
    $(".star", tr).addEventListener("click", (e) => {
      e.stopPropagation();
      watch.has(r.ticker) ? removeFromWatchlist(r.ticker) : addToWatchlist(r.ticker);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}
function buildHeatmap(rows) {
  const wrap = document.createElement("div");
  wrap.className = "heat";
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.pct_change)));
  rows.forEach(r => {
    const tile = document.createElement("div");
    tile.className = "heat-tile";
    tile.style.background = heatColor(r.pct_change, maxAbs);
    tile.innerHTML = `<div class="t">${escapeHtml(r.ticker)}</div><div class="p">${fmtPct(r.pct_change)}</div>`;
    tile.addEventListener("click", () => openDetail(r));
    wrap.appendChild(tile);
  });
  return wrap;
}
function heatColor(pct, maxAbs) {
  const t = Math.min(1, Math.abs(pct) / maxAbs);
  const light = 88 - t * 48; // 88% -> 40%
  const hue = pct >= 0 ? 152 : 6;
  return `hsl(${hue} 70% ${light}%)`;
}

/* ---------- detail dialog ---------- */
function openDetail(r) {
  const dlg = $("#detail");
  const body = $("#detailBody");
  const up = r.pct_change >= 0;
  body.innerHTML = `
    <div class="row">
      <h3>${escapeHtml(r.ticker)}</h3>
      <span class="pct ${up ? "up" : "down"}">${fmtPct(r.pct_change)}</span>
      ${r.confidence ? `<span class="conf">${escapeHtml(r.confidence)}</span>` : ""}
    </div>
    <p>${escapeHtml(r.why || "No explanation attached to this ticker in the current briefing.")}</p>
    ${r.watch_today ? `<p><strong>Watch today:</strong> ${escapeHtml(r.watch_today)}</p>` : ""}
    <p class="small muted">Range since close: ${r.range_pct != null ? r.range_pct.toFixed(1) + "%" : "—"} · Turnover: ${r.turnover_usdt ? "$" + Math.round(r.turnover_usdt).toLocaleString() : "—"}</p>`;
  dlg.showModal();
}

/* ---------- watchlist UI ---------- */
function renderWatchlist() {
  const list = getWatchlist();
  const chips = $("#watchChips");
  chips.innerHTML = "";
  list.forEach(t => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${escapeHtml(t)} <button aria-label="Remove ${t}">×</button>`;
    $("button", chip).addEventListener("click", () => removeFromWatchlist(t));
    chips.appendChild(chip);
  });
  const rows = moverRows().filter(r => list.includes(r.ticker));
  const tiles = $("#watchTiles");
  tiles.innerHTML = "";
  if (!list.length) {
    tiles.innerHTML = '<p class="empty">No tickers yet. Add one above to pin it to the top of your movers list.</p>';
  } else {
    rows.forEach(r => {
      const up = r.pct_change >= 0;
      const tile = document.createElement("div");
      tile.className = "wtile";
      tile.innerHTML = `<div class="t">${escapeHtml(r.ticker)}</div><div class="pct ${up ? "up" : "down"}">${fmtPct(r.pct_change)}</div>`;
      tiles.appendChild(tile);
    });
  }
  const dl = $("#tickerList");
  dl.innerHTML = "";
  moverRows().forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.ticker;
    dl.appendChild(opt);
  });
}

/* ---------- evidence ---------- */
function renderEvidence() {
  const b = STATE.briefing;
  const src = $("#sources");
  src.innerHTML = "";
  (b.sources || []).forEach(s => {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = s;
    src.appendChild(c);
  });
  const ev = $("#evidence");
  ev.innerHTML = "";
  const entries = Object.entries(STATE.evidence || {});
  if (!entries.length) {
    ev.innerHTML = '<p class="empty">No raw evidence saved with this briefing.</p>';
  } else {
    entries.forEach(([k, v]) => {
      const d = document.createElement("details");
      d.className = "ev-item";
      d.innerHTML = `<summary>${escapeHtml(k)}</summary><pre>${escapeHtml(v)}</pre>`;
      ev.appendChild(d);
    });
  }
  const cav = $("#caveats");
  cav.innerHTML = "";
  (b.caveats || []).forEach(c => {
    const li = document.createElement("li");
    li.textContent = c;
    cav.appendChild(li);
  });
}

/* ---------- controls wiring ---------- */
function initControls() {
  $$(".seg button[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".seg button[data-filter]").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      FILTER = btn.dataset.filter;
      renderMovers();
    });
  });
  $$(".seg button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".seg button[data-view]").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      VIEW = btn.dataset.view;
      renderMovers();
    });
  });
  $("#watchAdd").addEventListener("click", () => {
    addToWatchlist($("#watchInput").value);
    $("#watchInput").value = "";
  });
  $("#watchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#watchAdd").click(); }
  });
}

/* ---------- helpers ---------- */
function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* ---------- boot ---------- */
async function boot(url) {
  try {
    STATE = await loadBriefing(url || DATA_URL);
  } catch (e) {
    $("#headline").textContent = "Briefing not available yet";
    $("#summary").textContent = "Noctis hasn't published a briefing here yet. Run the nightly job, or check back after the next scheduled run.";
    return;
  }
  renderHero();
  renderTimeline();
  renderOutlook();
  renderMacro();
  renderMovers();
  renderWatchlist();
  renderEvidence();
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initControls();
  populateDatePicker();
  boot(DATA_URL);
  window.addEventListener("resize", () => { if (STATE) renderTimeline(); });
});
