import { app } from "../../scripts/app.js";

const DEFAULT_THRESHOLD = 5;
const STORAGE_KEY = "kk_guardian_threshold";
const BTN_ID = "kk-guardian-btn";
const PANEL_ID = "kk-guardian-panel";
const MSG_ID = "kk-guardian-msg";
const INDEX_URL = "/extensions/ComfyUI_KK_Guardian/model_index.json";

const loadThreshold = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  const num = Number(raw || DEFAULT_THRESHOLD);
  return [5, 10, 15].includes(num) ? num : DEFAULT_THRESHOLD;
};

const saveThreshold = (v) => {
  localStorage.setItem(STORAGE_KEY, String(v));
};

const normalize = (s) => String(s || "").toLowerCase().replace(/\.[^.]+$/, "").replace(/[\W_]+/g, "");
const sortChars = (s) => normalize(s).split("").sort().join("");
const tokenize = (s) => String(cleanBase(s || "")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const cleanBase = (s) => {
  const text = String(s || "").replace(/\\/g, "/");
  const seg = text.split("/").pop() || text;
  return seg.replace(/\.[^.]+$/, "");
};
const isDarkTheme = () => {
  try {
    if (document.documentElement.classList.contains("dark")) return true;
    if (document.body.classList.contains("dark")) return true;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

const kindMap = {
  checkpoint: ["checkpoint", "generic"],
  unet: ["unet", "generic"],
  vae: ["vae", "generic"],
  lora: ["lora", "generic"],
  controlnet: ["controlnet", "generic"],
  clip: ["clip", "generic"],
  generic: ["generic", "checkpoint", "unet", "vae", "lora", "controlnet", "clip"]
};

const uiMsg = (text, ok = true) => {
  let msg = document.getElementById(MSG_ID);
  if (!msg) {
    msg = document.createElement("div");
    msg.id = MSG_ID;
    msg.style.cssText = "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:24px;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;box-shadow:0 10px 26px rgba(0,0,0,.24);";
    document.body.appendChild(msg);
  }
  msg.textContent = text;
  msg.style.background = ok ? "#2563eb" : "#dc2626";
  msg.style.opacity = "1";
  setTimeout(() => { if (msg) msg.style.opacity = "0"; }, 2400);
};

const kindFromWidget = (node, widget) => {
  const n = String(node?.type || node?.title || "").toLowerCase();
  const w = String(widget?.name || "").toLowerCase();
  if (w.includes("ckpt") || n.includes("checkpoint")) return "checkpoint";
  if (w.includes("unet") || n.includes("unet") || n.includes("diffusion")) return "unet";
  if (w.includes("vae") || n.includes("vae")) return "vae";
  if (w.includes("lora") || n.includes("lora")) return "lora";
  if (w.includes("control") || n.includes("controlnet")) return "controlnet";
  if (w.includes("clip") || n.includes("clip") || n.includes("text")) return "clip";
  return "generic";
};

const isModelWidget = (widget) => {
  const n = String(widget?.name || "").toLowerCase();
  if (!n) return false;
  return ["ckpt", "model", "unet", "vae", "lora", "control", "clip"].some((k) => n.includes(k));
};

const charCommon = (a, b) => {
  const m = {};
  for (const c of a) m[c] = (m[c] || 0) + 1;
  let cnt = 0;
  for (const c of b) {
    if (m[c] > 0) {
      cnt += 1;
      m[c] -= 1;
    }
  }
  return cnt;
};

const weakTokens = new Set(["model", "models", "ckpt", "checkpoint", "safetensors", "vae", "unet", "lora", "clip", "fp8", "fp16", "bf16", "v1", "v2", "sd", "sdxl"]);

const scoreItem = (source, item, kindHint = "") => {
  const a = normalize(cleanBase(source));
  const b = item.normalized || normalize(String(item.relativePath || item.file || ""));
  if (!a || !b) return { score: -1e9, common: 0 };
  const common = charCommon(a, b);
  let score = common * 2 - Math.abs(a.length - b.length) * 0.6;
  if (a === b) score += 120;
  if (a.includes(b) || b.includes(a)) score += 55;
  if (sortChars(source) === item.sorted) score += 45;
  const srcSet = new Set(tokenize(source));
  const dstSet = new Set(tokenize(String(item.relativePath || item.file || b)));
  let matchedTokens = 0;
  let matchedImportant = 0;
  for (const token of srcSet) {
    if (!dstSet.has(token)) continue;
    matchedTokens += 1;
    if (token.length >= 2 && !weakTokens.has(token)) matchedImportant += 1;
  }
  score += matchedTokens * 18 + matchedImportant * 34;
  if (matchedImportant === 0 && matchedTokens <= 1) score -= 40;
  if (["vae", "unet", "lora", "clip"].includes(String(kindHint || "")) && matchedImportant === 0) score -= 55;
  if (String(kindHint || "") === "vae") {
    if ((srcSet.has("image") && dstSet.has("image")) || (srcSet.has("z") && dstSet.has("z"))) score += 28;
    if (dstSet.has("audio") && !srcSet.has("audio")) score -= 42;
    if (dstSet.has("video") && !srcSet.has("video")) score -= 26;
  }
  return { score, common, matchedImportant };
};

const chooseFromWidgetOptions = (widget, source, threshold, kindHint = "") => {
  const values = Array.isArray(widget?.options?.values) ? widget.options.values : [];
  if (!values.length) return null;
  const src = cleanBase(source);
  let best = null;
  for (const v of values) {
    const s = scoreItem(src, { normalized: normalize(cleanBase(v)), sorted: sortChars(cleanBase(v)), relativePath: String(v), file: cleanBase(v) }, kindHint);
    if (s.common < Number(threshold || 10) && Number(s.matchedImportant || 0) === 0) continue;
    if (!best || s.score > best.score) best = { value: v, score: s.score, common: s.common };
  }
  return best;
};

const resolveValue = (widget, item) => {
  const values = widget?.options?.values;
  const rel = String(item.relativePath || "");
  const file = String(item.file || "");
  if (Array.isArray(values) && values.length) {
    return values.find((v) => String(v) === rel)
      || values.find((v) => String(v).replace(/\\/g, "/") === rel)
      || values.find((v) => String(cleanBase(v)).toLowerCase() === file.toLowerCase())
      || values.find((v) => normalize(String(v)) === item.normalized)
      || null;
  }
  return rel || file || null;
};

const runSmartMatch = async (threshold) => {
  const graph = app?.graph || (window.app && window.app.graph) || (window.graphcanvas && window.graphcanvas.graph);
  if (!graph || !Array.isArray(graph._nodes)) {
    uiMsg("未找到工作流节点", false);
    return;
  }
  let indexData;
  try {
    const res = await fetch(INDEX_URL + "?ts=" + Date.now());
    if (!res.ok) throw new Error("模型索引读取失败");
    indexData = await res.json();
  } catch {
    uiMsg("模型索引加载失败", false);
    return;
  }
  const items = Array.isArray(indexData?.items) ? indexData.items : [];
  if (!items.length) {
    uiMsg("未检索到可用模型文件", false);
    return;
  }
  let updated = 0;
  let found = 0;
  let visited = 0;
  for (const node of graph._nodes) {
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    for (const widget of widgets) {
      if (!isModelWidget(widget)) continue;
      visited += 1;
      const current = String(widget?.value || "").trim();
      if (!current) continue;
      const kind = kindFromWidget(node, widget);
      const direct = chooseFromWidgetOptions(widget, current, threshold, kind);
      if (direct && direct.value) {
        found += 1;
        if (String(direct.value) !== String(widget.value)) {
          widget.value = direct.value;
          updated += 1;
        }
        continue;
      }
      const kinds = kindMap[kind] || kindMap.generic;
      let best = null;
      for (const item of items) {
        if (!kinds.includes(String(item.kind || "generic"))) continue;
        const s = scoreItem(current, item, kind);
        if (s.common < Number(threshold || 10) && Number(s.matchedImportant || 0) === 0) continue;
        if (!best || s.score > best.score) best = { item, score: s.score };
      }
      if (!best) continue;
      const nextValue = resolveValue(widget, best.item);
      if (!nextValue) continue;
      found += 1;
      if (String(nextValue) === String(widget.value)) continue;
      widget.value = nextValue;
      updated += 1;
    }
  }
  if (graph.change) graph.change();
  if (updated > 0) {
    if (graph.setDirtyCanvas) graph.setDirtyCanvas(true, true);
    uiMsg("智能匹配完成，已更新 " + updated + " 个模型项", true);
  } else if (found > 0) {
    uiMsg("智能匹配完成，已命中 " + found + " 项，当前已是最佳匹配", true);
  } else if (visited > 0) {
    uiMsg("已扫描 " + visited + " 个加载器，未找到可匹配模型", false);
  } else {
    uiMsg("未找到可替换的模型项", false);
  }
};

const mountUi = () => {
  if (document.getElementById(BTN_ID)) return;
  const btn = document.createElement("div");
  btn.id = BTN_ID;
  btn.textContent = "K";
  btn.style.cssText = "position:fixed;z-index:2147483646;width:46px;height:46px;border-radius:999px;right:24px;bottom:120px;background:#2563eb;box-shadow:0 12px 24px rgba(37,99,235,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:900;cursor:grab;user-select:none;";

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;z-index:2147483645;display:none;align-items:center;gap:8px;padding:10px;min-width:320px;border-radius:12px;background:#fff;color:#111827;box-shadow:0 18px 36px rgba(0,0,0,.2);";

  const title = document.createElement("div");
  title.textContent = "智能模型匹配";
  title.style.cssText = "font-size:12px;font-weight:800;white-space:nowrap;";
  const select = document.createElement("select");
  select.style.cssText = "height:34px;border-radius:8px;padding:0 8px;font-size:12px;font-weight:700;outline:none;";
  [["5","同名>5"],["10","同名>10"],["15","同名>15"]].forEach(([v,t])=>{const op=document.createElement("option");op.value=v;op.textContent=t;select.appendChild(op);});
  select.value = String(loadThreshold());
  select.onchange = () => saveThreshold(Number(select.value || DEFAULT_THRESHOLD));

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.textContent = "开始匹配";
  startBtn.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:800;cursor:pointer;";
  startBtn.onclick = () => runSmartMatch(Number(select.value || DEFAULT_THRESHOLD));

  panel.appendChild(title);
  panel.appendChild(select);
  panel.appendChild(startBtn);
  document.body.appendChild(panel);
  document.body.appendChild(btn);

  const applyTheme = () => {
    const dark = isDarkTheme();
    panel.style.background = dark ? "#1f2937" : "#ffffff";
    panel.style.color = dark ? "#f9fafb" : "#111827";
    title.style.color = dark ? "#f3f4f6" : "#1f2937";
    select.style.background = dark ? "#111827" : "#ffffff";
    select.style.color = dark ? "#f9fafb" : "#111827";
    select.style.border = dark ? "1px solid #374151" : "1px solid #d1d5db";
    select.style.colorScheme = dark ? "dark" : "light";
    Array.from(select.options).forEach((op) => {
      op.style.backgroundColor = dark ? "#111827" : "#ffffff";
      op.style.color = dark ? "#f9fafb" : "#111827";
    });
  };
  applyTheme();
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (media?.addEventListener) media.addEventListener("change", applyTheme);
  const observer = new MutationObserver(applyTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

  let open = false;
  let dragging = false;
  let sx = 0;
  let sy = 0;
  let sl = 0;
  let st = 0;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const locatePanel = () => {
    if (!open) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "flex";
    const r = btn.getBoundingClientRect();
    panel.style.left = (r.left - panel.offsetWidth - 12) + "px";
    panel.style.top = (r.top + (r.height - panel.offsetHeight) / 2) + "px";
    if (panel.getBoundingClientRect().left < 8) {
      panel.style.left = (r.right + 12) + "px";
    }
  };

  btn.onpointerdown = (e) => {
    dragging = true;
    btn.setPointerCapture(e.pointerId);
    sx = e.clientX;
    sy = e.clientY;
    const r = btn.getBoundingClientRect();
    sl = r.left;
    st = r.top;
    btn.style.cursor = "grabbing";
  };
  btn.onpointermove = (e) => {
    if (!dragging) return;
    const nx = clamp(sl + e.clientX - sx, 8, window.innerWidth - btn.offsetWidth - 8);
    const ny = clamp(st + e.clientY - sy, 8, window.innerHeight - btn.offsetHeight - 8);
    btn.style.left = nx + "px";
    btn.style.top = ny + "px";
    btn.style.right = "";
    btn.style.bottom = "";
    locatePanel();
  };
  btn.onpointerup = (e) => {
    if (!dragging) return;
    btn.releasePointerCapture(e.pointerId);
    const moved = Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 8;
    dragging = false;
    btn.style.cursor = "grab";
    if (!moved) {
      open = !open;
      locatePanel();
    }
  };
  window.addEventListener("resize", locatePanel);
};

app.registerExtension({
  name: "kk.launcher.guardian",
  setup() {
    mountUi();
    setTimeout(mountUi, 1000);
    setTimeout(mountUi, 3000);
  }
});

