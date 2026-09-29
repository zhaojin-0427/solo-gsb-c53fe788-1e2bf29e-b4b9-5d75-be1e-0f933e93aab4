/* 藏品光照轮换台 —— 原生 JavaScript 前端 */
"use strict";

const STORAGE = -1;

/* 8 件藏品的区分色（时间轴/表格/库房点统一） */
const ITEM_COLORS = [
  "#2b6cb0", "#c05621", "#2f855a", "#9d174d",
  "#6d28d9", "#0e7490", "#b45309", "#4b5563",
];
/* 展位标签点颜色 */
const BOOTH_COLORS = ["#1f5f8b", "#c28a2e", "#5a7d3a"];

const els = {};
let state = { config: sampleConfig(), result: null };

/* ---------------- 示例数据 ---------------- */
function sampleConfig() {
  return {
    slots: 24,
    booths: [{ lux: 500 }, { lux: 1500 }, { lux: 3000 }],
    items: [
      { name: "《青绿山水图》", budget: 120000, priority: 10, min_hours: 8 },
      { name: "青铜饕餮纹鼎", budget: 300000, priority: 6, min_hours: 6 },
      { name: "唐代丝绸残片", budget: 24000, priority: 9, min_hours: 4 },
      { name: "彩陶侍女俑", budget: 720000, priority: 3, min_hours: 0 },
    ],
    locks: [
      { item: 0, slot: 0, location: 1 },
      { item: 1, slot: 0, location: 0 },
      { item: 2, slot: 3, location: STORAGE },
    ],
  };
}

/* ---------------- 初始化 ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  for (const id of [
    "slotsInput", "slotsHint", "boothEditor", "addBoothBtn",
    "itemTable", "addItemBtn", "lockItem", "lockSlot", "lockLocation",
    "addLockBtn", "lockList", "solveBtn", "loadSampleBtn",
    "statusBanner", "metrics", "mWeighted", "mSwitches", "mTime",
    "saveName", "saveBtn", "timelineWrap", "ruler", "boothRows",
    "storageRow", "itemRows", "doseWrap", "doseTable", "emptyHint",
    "savedTable",
  ]) {
    els[id] = document.getElementById(id);
  }

  renderEditors();
  refreshSaved();

  els.slotsInput.addEventListener("change", onSlotsChange);
  els.addBoothBtn.addEventListener("click", () => {
    if (state.config.booths.length >= 3) return;
    state.config.booths.push({ lux: 2000 });
    pruneLocks();
    renderEditors();
  });
  els.addItemBtn.addEventListener("click", () => {
    if (state.config.items.length >= 8) return;
    state.config.items.push({
      name: `藏品 ${state.config.items.length + 1}`,
      budget: 100000, priority: 5, min_hours: 0,
    });
    renderEditors();
  });
  els.addLockBtn.addEventListener("click", addLock);
  els.solveBtn.addEventListener("click", solve);
  els.saveBtn.addEventListener("click", saveSchedule);
  els.loadSampleBtn.addEventListener("click", () => {
    state = { config: sampleConfig(), result: null };
    renderEditors();
    renderResult(null);
  });
});

/* ---------------- 编辑器渲染 ---------------- */
function renderEditors() {
  const cfg = state.config;

  els.slotsInput.value = cfg.slots;
  els.slotsHint.textContent =
    `覆盖第 1 ～ ${cfg.slots} 时段，共 ${cfg.slots} 小时`;
  els.lockSlot.max = cfg.slots;

  // 展位
  els.boothEditor.innerHTML = "";
  cfg.booths.forEach((b, j) => {
    const row = document.createElement("div");
    row.className = "booth-row";
    row.innerHTML = `
      <b><span class="swatch" style="background:${BOOTH_COLORS[j]}"></span>展位 ${j + 1}</b>
      <input type="number" min="1" max="10000" step="1" value="${b.lux}" aria-label="展位${j + 1}照度" />
      <button class="del-btn" type="button" title="删除展位" ${cfg.booths.length <= 1 ? "disabled" : ""}>×</button>`;
    const input = row.querySelector("input");
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      if (Number.isInteger(v)) cfg.booths[j].lux = v;
    });
    row.querySelector(".del-btn").addEventListener("click", () => {
      cfg.booths.splice(j, 1);
      pruneLocks();
      renderEditors();
    });
    els.boothEditor.appendChild(row);
  });
  els.addBoothBtn.disabled = cfg.booths.length >= 3;

  // 藏品表
  const tbody = els.itemTable.querySelector("tbody");
  tbody.innerHTML = "";
  cfg.items.forEach((it, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" maxlength="40" value="${escapeAttr(it.name)}" /></td>
      <td><input type="number" min="0" max="720000" step="1" value="${it.budget}" /></td>
      <td><input type="number" min="1" max="10" step="1" value="${it.priority}" /></td>
      <td><input type="number" min="0" max="72" step="1" value="${it.min_hours}" /></td>
      <td><button class="del-btn" type="button" title="删除藏品"
            ${cfg.items.length <= 1 ? "disabled" : ""}>×</button></td>`;
    const [nameI, budgetI, prioI, minI] = tr.querySelectorAll("input");
    nameI.addEventListener("input", () => { cfg.items[i].name = nameI.value; });
    budgetI.addEventListener("input", () => {
      const v = parseInt(budgetI.value, 10);
      if (Number.isInteger(v)) cfg.items[i].budget = v;
    });
    prioI.addEventListener("input", () => {
      const v = parseInt(prioI.value, 10);
      if (Number.isInteger(v)) cfg.items[i].priority = v;
    });
    minI.addEventListener("input", () => {
      const v = parseInt(minI.value, 10);
      if (Number.isInteger(v)) cfg.items[i].min_hours = v;
    });
    tr.querySelector(".del-btn").addEventListener("click", () => {
      cfg.items.splice(i, 1);
      pruneLocks();
      renderEditors();
    });
    tbody.appendChild(tr);
  });
  els.addItemBtn.disabled = cfg.items.length >= 8;

  renderLockUi();
}

function onSlotsChange() {
  let v = parseInt(els.slotsInput.value, 10);
  if (!Number.isInteger(v)) v = state.config.slots;
  v = Math.min(72, Math.max(1, v));
  state.config.slots = v;
  els.slotsInput.value = v;
  pruneLocks();
  renderEditors();
}

function pruneLocks() {
  const { slots: T, booths, items, locks } = state.config;
  state.config.locks = locks.filter(
    (l) =>
      l.item < items.length &&
      l.slot < T &&
      (l.location === STORAGE || l.location < booths.length)
  );
}

/* ---------------- 锁定 UI ---------------- */
function renderLockUi() {
  const cfg = state.config;

  els.lockItem.innerHTML = "";
  cfg.items.forEach((it, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = it.name;
    els.lockItem.appendChild(o);
  });

  els.lockLocation.innerHTML = "";
  const storeOpt = document.createElement("option");
  storeOpt.value = STORAGE;
  storeOpt.textContent = "库房（不耗光照）";
  els.lockLocation.appendChild(storeOpt);
  cfg.booths.forEach((b, j) => {
    const o = document.createElement("option");
    o.value = j;
    o.textContent = `展位 ${j + 1}（${b.lux} lx）`;
    els.lockLocation.appendChild(o);
  });

  els.lockList.innerHTML = "";
  if (cfg.locks.length === 0) {
    const li = document.createElement("li");
    li.style.background = "transparent";
    li.style.border = "none";
    li.textContent = "（无锁定）";
    els.lockList.appendChild(li);
    return;
  }
  cfg.locks
    .slice()
    .sort((a, b) => a.slot - b.slot || a.item - b.item)
    .forEach((l, idx) => {
      const realIdx = cfg.locks.indexOf(l);
      const li = document.createElement("li");
      const where =
        l.location === STORAGE
          ? "库房"
          : `展位 ${l.location + 1}（${cfg.booths[l.location].lux} lx）`;
      li.innerHTML =
        `<span class="chip" style="width:9px;height:9px;background:${ITEM_COLORS[l.item % 8]}"></span>` +
        `${escapeHtml(cfg.items[l.item].name)} · 第 ${l.slot + 1} 时段 → ${where}`;
      const x = document.createElement("button");
      x.className = "x";
      x.type = "button";
      x.textContent = "×";
      x.title = "删除锁定";
      x.addEventListener("click", () => {
        cfg.locks.splice(realIdx, 1);
        renderLockUi();
      });
      li.appendChild(x);
      els.lockList.appendChild(li);
    });
}

function addLock() {
  const item = parseInt(els.lockItem.value, 10);
  const slot = parseInt(els.lockSlot.value, 10) - 1; // UI 1 起，内部 0 起
  const location = parseInt(els.lockLocation.value, 10);
  const T = state.config.slots;
  if (!Number.isInteger(slot) || slot < 0 || slot >= T) {
    alert(`请输入 1 ～ ${T} 之间的时段编号。`);
    return;
  }
  if (state.config.locks.some((l) => l.item === item && l.slot === slot)) {
    alert("该藏品在该时段已有锁定，请先删除原锁定。");
    return;
  }
  state.config.locks.push({ item, slot, location });
  els.lockSlot.value = "";
  renderLockUi();
}

/* ---------------- 收集并校验输入 ---------------- */
function gatherConfig() {
  const cfg = state.config;
  const slots = parseInt(els.slotsInput.value, 10);
  if (!Number.isInteger(slots) || slots < 1 || slots > 72)
    return "时段数必须是 1～72 的整数。";

  const boothEls = els.boothEditor.querySelectorAll(".booth-row");
  const booths = [];
  for (const row of boothEls) {
    const lux = parseInt(row.querySelector("input").value, 10);
    if (!Number.isInteger(lux) || lux < 1 || lux > 10000)
      return `展位 ${booths.length + 1} 的照度必须是 1～10000 lx。`;
    booths.push({ lux });
  }

  const rows = els.itemTable.querySelectorAll("tbody tr");
  const items = [];
  for (const tr of rows) {
    const [nameI, budgetI, prioI, minI] = tr.querySelectorAll("input");
    const name = nameI.value.trim();
    const budget = parseInt(budgetI.value, 10);
    const priority = parseInt(prioI.value, 10);
    const min_hours = parseInt(minI.value, 10);
    if (!name) return `第 ${items.length + 1} 件藏品需要填写名称。`;
    if (!Number.isInteger(budget) || budget < 0 || budget > 720000)
      return `${name} 的预算必须是 0～720000 lx·h。`;
    if (!Number.isInteger(priority) || priority < 1 || priority > 10)
      return `${name} 的优先级必须是 1～10。`;
    if (!Number.isInteger(min_hours) || min_hours < 0 || min_hours > 72)
      return `${name} 的最低展出时数必须是 0～72 小时。`;
    if (min_hours > slots)
      return `${name} 的最低展出时数超过总时段数 ${slots}。`;
    items.push({ name, budget, priority, min_hours });
  }
  if (items.length < 1 || items.length > 8) return "藏品数量必须为 1～8 件。";

  pruneLocks();
  return { slots, booths, items, locks: cfg.locks };
}

/* ---------------- 求解 ---------------- */
async function solve() {
  const gathered = gatherConfig();
  if (typeof gathered === "string") {
    showBanner("error", "输入有误", gathered);
    return;
  }
  state.config = gathered;

  els.solveBtn.disabled = true;
  els.solveBtn.textContent = "求解中…（限时 10 秒）";
  try {
    const resp = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.config),
    });
    const data = await resp.json();
    if (!resp.ok) {
      state.result = null;
      renderResult(null);
      let detail = data.detail || "输入数据不合法。";
      if (Array.isArray(detail)) {
        detail = detail
          .map((e) => {
            const loc = (e.loc || []).filter((x) => x !== "body").join(" / ");
            return loc ? `${loc}：${e.msg}` : e.msg;
          })
          .join("；");
      }
      showBanner("error", "请求被拒绝（422）", detail);
      return;
    }
    state.result = data;
    renderResult(data);
  } catch (err) {
    state.result = null;
    renderResult(null);
    showBanner("error", "请求失败", `无法连接求解服务：${err.message}`);
  } finally {
    els.solveBtn.disabled = false;
    els.solveBtn.textContent = "开始求解排班";
  }
}

/* ---------------- 结果渲染 ---------------- */
const STATUS_META = {
  optimal: {
    cls: "banner-optimal",
    title: "✓ 已求得并证明最优方案",
    hint: "在限时内证明：加权展出小时已最大、出入库次数已最少。",
  },
  feasible: {
    cls: "banner-feasible",
    title: "◐ 可行但未证明最优",
    hint: "10 秒限时内找到可行方案，但未能证明最优；可调整规模后重试。",
  },
  infeasible: {
    cls: "banner-infeasible",
    title: "✕ 无解",
    hint: "最低时数、锁定与预算互相冲突。请放宽最低展出时数、调整锁定或提高预算。",
  },
  unknown: {
    cls: "banner-unknown",
    title: "⏱ 超时未找到方案",
    hint: "10 秒内未找到任何可行方案，请放宽约束（如锁定、最低时数）后重试。",
  },
};

function showBanner(kind, title, detail) {
  const b = els.statusBanner;
  b.className = `banner ${kind === "error" ? "banner-error" : STATUS_META[kind].cls}`;
  b.classList.remove("hidden");
  b.innerHTML = `<b>${escapeHtml(title)}</b>${escapeHtml(detail || "")}`;
}

function renderResult(r) {
  const hasPlan = r && (r.status === "optimal" || r.status === "feasible");

  els.statusBanner.classList.add("hidden");
  els.metrics.classList.toggle("hidden", !hasPlan);
  els.timelineWrap.classList.toggle("hidden", !hasPlan);
  els.doseWrap.classList.toggle("hidden", !hasPlan);
  els.emptyHint.classList.toggle("hidden", !!r);

  if (!r) return;

  const meta = STATUS_META[r.status] || {
    cls: "banner-unknown", title: r.status_text || "未知状态", hint: "",
  };
  let detail = `${r.status_text}　·　耗时 ${r.wall_time ?? "–"} s`;
  if (r.status === "infeasible" || r.status === "unknown") detail += "　" + meta.hint;
  showBanner(r.status, meta.title, detail);
  if (!hasPlan) return;

  els.mWeighted.textContent = r.weighted_hours;
  els.mSwitches.textContent = r.transitions;
  els.mTime.textContent = r.wall_time;
  els.saveName.value = "";

  renderTimeline(r);
  renderDoseTable(r);
}

function renderTimeline(r) {
  const cfg = r.config;
  const T = cfg.slots;

  // 时段标尺
  els.ruler.style.gridTemplateColumns = "";
  els.ruler.innerHTML = "";
  for (let t = 0; t < T; t++) {
    const s = document.createElement("span");
    s.textContent = t + 1;
    els.ruler.appendChild(s);
  }

  // 展位行
  els.boothRows.innerHTML = "";
  r.booth_slots.forEach((slotItems, j) => {
    const segs = runs(slotItems).filter((s) => s.value !== STORAGE);
    const label =
      `<span class="dot" style="background:${BOOTH_COLORS[j]}"></span>` +
      `展位 ${j + 1}<br/><span class="hint">${cfg.booths[j].lux} lx</span>`;
    els.boothRows.appendChild(
      buildRow(label, T, segs.map((s) => ({
        ...s,
        color: ITEM_COLORS[s.value % 8],
        text: s.length >= 3 ? cfg.items[s.value].name : "",
        title: `${cfg.items[s.value].name}｜第 ${s.start + 1}～${s.end + 1} 时段（${s.length} h）`,
      }))),
    );
  });

  // 库房行：每格一个虚线小格，内存藏品用色点表示
  els.storageRow.innerHTML =
    `<div class="row-label"><span class="dot" style="background:var(--storage)"></span>库房</div>`;
  const storeTrack = document.createElement("div");
  storeTrack.className = "track";
  r.storage_slots.forEach((ids) => {
    const cell = document.createElement("div");
    cell.className = "store-cell";
    ids.forEach((i) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.style.background = ITEM_COLORS[i % 8];
      c.title = cfg.items[i].name;
      cell.appendChild(c);
    });
    storeTrack.appendChild(cell);
  });
  els.storageRow.appendChild(storeTrack);

  // 逐件行
  els.itemRows.innerHTML = "";
  r.items.forEach((it, i) => {
    const segs = it.segments.map((s) => {
      const isStore = s.location === STORAGE;
      const len = s.end - s.start + 1;
      const pos = isStore ? "库房" : `展位 ${s.location + 1}`;
      // 宽度太窄的格子只显示色块，文字留给 tooltip
      const text = isStore ? (len >= 2 ? pos : "") : len >= 3 ? pos : "";
      return {
        start: s.start,
        end: s.end,
        length: len,
        storage: isStore,
        color: isStore ? null : ITEM_COLORS[i % 8],
        text,
        title:
          `${it.name}｜${pos}｜第 ${s.start + 1}～${s.end + 1} 时段` +
          `（${len} h）${isStore ? "" : "，本展段剂量 " + fmt(s.dose) + " lx·h"}`,
      };
    });
    const label =
      `<span class="dot" style="background:${ITEM_COLORS[i % 8]}"></span>` +
      `<span title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</span>`;
    els.itemRows.appendChild(buildRow(label, T, segs));
  });
}

/* 把每格值数组合并成连续段 */
function runs(values) {
  const out = [];
  let start = 0;
  for (let t = 1; t <= values.length; t++) {
    if (t === values.length || values[t] !== values[start]) {
      out.push({ value: values[start], start, end: t - 1, length: t - start });
      start = t;
    }
  }
  return out;
}

function buildRow(labelHtml, T, segs) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("div");
  label.className = "row-label";
  label.innerHTML = labelHtml;
  const track = document.createElement("div");
  track.className = "track";
  track.style.setProperty("--cells", T);

  segs.forEach((s) => {
    const seg = document.createElement("div");
    const left = (s.start / T) * 100;
    const width = (s.length / T) * 100;
    seg.className = "seg" + (s.storage ? " seg-storage" : "");
    seg.style.left = left + "%";
    seg.style.width = width + "%";
    if (s.color) seg.style.background = s.color;
    seg.title = s.title;
    const lenNote = s.length > 1 ? ` <i>${s.length}h</i>` : "";
    seg.innerHTML = `${escapeHtml(s.text || "")}${s.text ? lenNote : ""}`;
    track.appendChild(seg);
  });

  row.appendChild(label);
  row.appendChild(track);
  return row;
}

function renderDoseTable(r) {
  const tbody = els.doseTable.querySelector("tbody");
  tbody.innerHTML = "";
  r.items.forEach((it, i) => {
    const pct = it.budget > 0 ? (it.dose / it.budget) * 100 : 0;
    const fillColor =
      pct >= 95 ? "#b3362f" : pct >= 70 ? "#c28a2e" : "#2e7d4f";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="chip" style="display:inline-block;background:${ITEM_COLORS[i % 8]}"></span>
          ${escapeHtml(it.name)}</td>
      <td>${it.priority}</td>
      <td>${it.hours} <span class="hint">/ ≥ ${it.min_hours}</span></td>
      <td>${it.min_hours}</td>
      <td>${fmt(it.dose)}</td>
      <td>${fmt(it.budget)}</td>
      <td><b>${fmt(it.remaining)}</b></td>
      <td><div class="pct"><div class="pct-bar">
            <div class="pct-fill" style="width:${Math.min(100, pct).toFixed(1)}%;background:${fillColor}"></div>
          </div><span class="pct-num">${pct.toFixed(1)}%</span></div></td>
      <td>${it.transitions}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------------- 保存 / 读取 / 删除 ---------------- */
async function saveSchedule() {
  if (!state.result) return;
  let name = els.saveName.value.trim();
  if (!name) {
    const d = new Date();
    name = `排班 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  els.saveBtn.disabled = true;
  try {
    const resp = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        config: state.result.config,
        result: state.result,
        status: state.result.status,
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert("保存失败：" + (data.detail || resp.status));
      return;
    }
    els.saveName.value = "";
    await refreshSaved();
  } catch (err) {
    alert("保存失败：" + err.message);
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function refreshSaved() {
  const tbody = els.savedTable.querySelector("tbody");
  try {
    const resp = await fetch("/api/schedules");
    const list = await resp.json();
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="hint center">尚未保存排班</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    list.forEach((row) => {
      const tr = document.createElement("tr");
      const tag =
        row.status === "optimal"
          ? '<span class="status-tag tag-optimal">最优</span>'
          : '<span class="status-tag tag-feasible">可行</span>';
      tr.innerHTML = `
        <td>${row.id}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${tag}</td>
        <td class="hint">${escapeHtml(row.created_at)}</td>
        <td>
          <button class="btn btn-mini load-btn" type="button">查看</button>
          <button class="btn btn-mini btn-danger del-btn2" type="button">删除</button>
        </td>`;
      tr.querySelector(".load-btn").addEventListener("click", () => loadSchedule(row.id));
      tr.querySelector(".del-btn2").addEventListener("click", async () => {
        if (!confirm(`确定删除「${row.name}」？`)) return;
        await fetch(`/api/schedules/${row.id}`, { method: "DELETE" });
        refreshSaved();
      });
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="hint center">无法读取已保存排班：${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadSchedule(id) {
  const resp = await fetch(`/api/schedules/${id}`);
  if (!resp.ok) {
    alert("加载失败");
    return;
  }
  const data = await resp.json();
  state.config = data.config;
  state.result = data.result;
  renderEditors();
  renderResult(state.result);
  document.querySelector(".panel-result").scrollIntoView({ behavior: "smooth" });
}

/* ---------------- 工具 ---------------- */
function fmt(n) {
  return Number(n).toLocaleString("zh-CN");
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
function escapeAttr(s) {
  return escapeHtml(s);
}
