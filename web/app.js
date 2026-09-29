/* ---------- Noctis frontend ---------- */
const DATA_URL = "data/briefing.json";
const ARCHIVE_INDEX_URL = "data/archive/index.json";
const ARCHIVE_DIR = "data/archive/";
const WATCH_KEY = "noctis-watchlist";
const THEME_KEY = "noctis-theme";
const STALE_HOURS = 30;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function initTheme() {
  const btn = $("#themeBtn");
  btn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });
}

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

let STATE = null;
let VIEW = "table";
let FILTER = "all";
let SORT = { key: "pct_change", dir: "desc" };

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
  } catch (e) {}
  sel.addEventListener("change", () => boot(sel.value || DATA_URL));
}

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

  const badge = $("#staleBadge");
  if (badge) {
    if (gen) {
      const hours = (Date.now() - gen.getTime()) / 3600000;
      if (hours > STALE_HOURS) {
        badge.hidden = false;
        badge.title = `Generated about ${Math.round(hours)}h ago`;
      } else {
        badge.hidden = true;
      }
    } else {
      badge.hidden = true;
    }
  }
}

// Stems run from the yellow baseline straight into the ticker chip -- the
// chip IS the tip of the stem, scattered up (gain, green) or down (loss,
// red) by how large the move was. No separate dots, no fixed row.
function renderTimeline() {
  const core = STATE.core_movers || [];
  const el = $("#tlChart");
  el.innerHTML = "";
  if (!core.length) { $("#tlNote").textContent = ""; return; }

  const H = 140, padX = 30, chipHalfH = 14;
  const w = el.clientWidth || 600;
  const vals = core.map(m => m.pct_change);
  const maxAbs = Math.max(1, ...vals.map(v => Math.abs(v)));
  const mid = H / 2;
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${H}`);

  const baseline = document.createElementNS(svgNS, "line");
  baseline.setAttribute("x1", 0); baseline.setAttribute("x2", w);
  baseline.setAttribute("y1", mid); baseline.setAttribute("y2", mid);
  baseline.setAttribute("stroke", "var(--baseline)");
  baseline.setAttribute("stroke-width", "1");
  svg.appendChild(baseline);

  const n = core.length;
  const step = (w - padX * 2) / Math.max(1, n - 1);

  const tip = document.createElement("div");
  tip.className = "tl-tip";

  core.forEach((m, i) => {
    const x = n === 1 ? w / 2 : padX + i * step;
    let y = mid - (m.pct_change / maxAbs) * (mid - chipHalfH - 6);
    y = Math.max(chipHalfH + 2, Math.min(H - chipHalfH - 2, y));
    const up = m.pct_change >= 0;
    const color = up ? "var(--up)" : "var(--down)";

    if (Math.abs(y - mid) > 2) {
      const stem = document.createElementNS(svgNS, "line");
      stem.setAttribute("x1", x); stem.setAttribute("x2", x);
      stem.setAttribute("y1", mid); stem.setAttribute("y2", y);
      stem.setAttribute("stroke", color);
      stem.setAttribute("stroke-width", "1.5");
      stem.setAttribute("stroke-linecap", "round");
      svg.appendChild(stem);
    }

    const chip = document.createElement("span");
    chip.className = "tl-chip " + (up ? "up" : "down");
    chip.textContent = m.ticker;
    chip.style.left = x + "px";
    chip.style.top = y + "px";
    chip.addEventListener("mouseenter", () => showTip(tip, x, y, m));
    chip.addEventListener("mouseleave", () => tip.classList.remove("show"));
    chip.addEventListener("click", () => openDetail(m));
    el.appendChild(chip);
  });

  el.appendChild(svg);
  el.appendChild(tip);
  $("#tlNote").textContent = `Each ticker sits where its move puts it -- above the line for gains, below for losses. Tap one for detail.`;
}
function showTip(tip, x, y, m) {
  tip.textContent = `${m.ticker} ${fmtPct(m.pct_change)}`;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
  tip.classList.add("show");
}

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
    const av = a[SORT.key], bv = b[SORT.key];
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
  rows.forEach(r => {
    const tile = document.createElement("div");
    tile.className = "heat-tile";
    const weight = Math.sqrt(Math.max(1, r.turnover_usdt || 1));
    tile.style.flex = `${weight} 1 92px`;
    tile.style.background = heatColor(r.pct_change);
    tile.innerHTML = `<div class="t">${escapeHtml(r.ticker)}</div><div class="p">${fmtPct(r.pct_change)}</div>`;
    tile.addEventListener("click", () => openDetail(r));
    wrap.appendChild(tile);
  });
  return wrap;
}
function heatColor(pct) {
  const CAP = 3;
  const t = Math.min(1, Math.abs(pct) / CAP);
  const light = 60 - t * 24;
  const sat = 58 + t * 18;
  const hue = pct >= 0 ? 152 : 358;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

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

function renderEvidence() {
  const b = STATE.briefing;
  const src = $("#sources");
  src.innerHTML = "";
  const sources = (b.sources || []).map(niceSourceName);
  if (!sources.length) {
    src.innerHTML = '<p class="empty">No sources logged for this briefing.</p>';
  } else {
    sources.forEach(s => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = s;
      src.appendChild(c);
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
function niceSourceName(key) {
  const [kind, rest] = String(key).split(":");
  const map = {
    news: rest ? `${rest} news headlines` : "News headlines",
    underlying: rest ? `${rest} real-stock price` : "Real-stock price",
    rates: "Interest rates & bond yields",
    sentiment: "Market sentiment index",
    "fed-news": "Federal Reserve news",
  };
  return map[kind] || key;
}

function initFooterFade() {
  const foot = $("#siteFooter");
  if (!foot || !("IntersectionObserver" in window)) { if (foot) foot.classList.add("visible"); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => foot.classList.toggle("visible", e.isIntersecting));
  }, { threshold: 0.15 });
  io.observe(foot);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  words.forEach(word => {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

async function shareBriefing() {
  if (!STATE) return;
  const b = STATE.briefing;
  const W = 1080, H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const isLight = document.documentElement.dataset.theme === "light";
  const bg = isLight ? "#faf9f6" : "#0a0a0c";
  const text = isLight ? "#14140f" : "#f2f2f0";
  const dim = isLight ? "#56564f" : "#9c9ca0";
  const up = "#35d399", down = "#ff5c5c";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = text;
  ctx.font = "700 28px 'Space Grotesk', sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("NOCTIS", 60, 60);

  ctx.fillStyle = dim;
  ctx.font = "600 20px 'JetBrains Mono', monospace";
  const gen = STATE.generated_at ? new Date(STATE.generated_at) : new Date();
  ctx.fillText(gen.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }), 60, 102);

  const mood = (b.mood || "mixed").toLowerCase();
  const moodColor = mood === "risk-on" ? up : mood === "risk-off" ? down : dim;
  ctx.fillStyle = moodColor;
  ctx.beginPath();
  ctx.arc(64, 165, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "700 18px 'JetBrains Mono', monospace";
  ctx.fillText(mood.replace("-", " ").toUpperCase(), 82, 156);

  ctx.fillStyle = text;
  ctx.font = "700 42px 'Space Grotesk', sans-serif";
  const headLines = wrapText(ctx, b.headline || "", W - 120);
  let y = 206;
  headLines.slice(0, 4).forEach(line => { ctx.fillText(line, 60, y); y += 52; });

  const rows = moverRows().slice().sort((a, c) => c.pct_change - a.pct_change);
  const top = [...rows.slice(0, 3), ...rows.slice(-2)];
  y += 30;
  ctx.font = "700 20px 'JetBrains Mono', monospace";
  ctx.fillStyle = dim;
  ctx.fillText("TOP MOVERS", 60, y);
  y += 42;
  top.forEach(r => {
    const rowUp = r.pct_change >= 0;
    ctx.fillStyle = text;
    ctx.font = "700 28px 'JetBrains Mono', monospace";
    ctx.fillText(r.ticker, 60, y);
    ctx.fillStyle = rowUp ? up : down;
    ctx.textAlign = "right";
    ctx.fillText(fmtPct(r.pct_change), W - 60, y);
    ctx.textAlign = "left";
    y += 44;
  });

  ctx.fillStyle = dim;
  ctx.font = "600 18px Inter, sans-serif";
  ctx.fillText("noctis · analysis, not financial advice", 60, H - 70);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], "noctis-briefing.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Noctis briefing", text: b.headline || "" });
        return;
      } catch (e) {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "noctis-briefing.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

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
  $("#shareBtn").addEventListener("click", shareBriefing);
}

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
  initFooterFade();
  populateDatePicker();
  boot(DATA_URL);
  window.addEventListener("resize", () => { if (STATE) renderTimeline(); });
});
