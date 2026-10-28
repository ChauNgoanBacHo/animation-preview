import "./index.css";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { SpineStage } from "./spineStage.js";

const FPS = 20,
  SIZE = 512,
  GIF_ALPHA_THRESHOLD = 96,
  MAX_GIF_BYTES = 512 * 1024,
  app = document.querySelector("#app");
const OBJECT_SIZES = [50, 60, 70, 80, 90, 100];
const savedObjectSize = Number(localStorage.getItem("gif-object-size"));
const state = {
  source: localStorage.getItem("gif-source") || "",
  output: localStorage.getItem("gif-output") || "",
  bakeChecker: localStorage.getItem("gif-bake-checker") !== "false",
  combineSymbols: localStorage.getItem("gif-combine-symbols") === "true",
  objectSize: OBJECT_SIZES.includes(savedObjectSize) ? savedObjectSize : 80,
  cropPadding: Number(localStorage.getItem("gif-crop-padding")) || 8,
  groupPerRow: Number(localStorage.getItem("gif-group-per-row")) || 5,
  files: [],
  configs: new Map(),
  active: "",
  stage: null,
  spine: null,
  previewFrame: 0,
  previewStartedAt: 0,
  previewPaused: false,
  previewPauseTime: 0,
  scanning: false,
  exporting: false,
  progress: 0,
  status: "",
  error: "",
  search: "",
};
const icon = (name) =>
  name === "folder"
    ? '<svg viewBox="0 0 24 24"><path d="M3 8h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 0V5a2 2 0 0 1 2-2h5l2 2h5"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const keyOf = (f, a) => `${f.id}::${a}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v) => `${Number(v || 0).toFixed(2)}s`;
const durationOf = (f, a) =>
  Math.max(
    0,
    Number(f.animationDetails?.find((x) => x.name === a)?.duration) || 0,
  );
function configOf(f, a) {
  const k = keyOf(f, a);
  if (!state.configs.has(k)) {
    const d = durationOf(f, a);
    state.configs.set(k, {
      selected: false,
      skin: f.skins?.[0] || "",
      start: 0,
      end: Math.min(1, d || 1),
    });
  }
  return state.configs.get(k);
}
function items() {
  return state.files.flatMap((file) =>
    file.animations.map((animation) => ({
      file,
      animation,
      config: configOf(file, animation),
    })),
  );
}
function selected() {
  return items().filter((x) => x.config.selected);
}
function visibleFiles() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.files;
  return state.files
    .map((file) => {
      if (file.fileName.toLowerCase().includes(query)) return file;
      return {
        ...file,
        animations: file.animations.filter((animation) =>
          animation.toLowerCase().includes(query),
        ),
      };
    })
    .filter((file) => file.animations.length);
}
function clean(v) {
  return String(v)
    .replace(/\.json$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_");
}

function normalizeGifAlpha(source) {
  const pixels = new Uint8ClampedArray(source);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < GIF_ALPHA_THRESHOLD) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 0;
    } else {
      // GIF only supports 1-bit alpha. Converting edge pixels to opaque here
      // prevents semi-transparent RGB values from becoming cyan palette noise.
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function visiblePixelBounds(canvas) {
  const { width, height } = canvas;
  const pixels = canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, width, height).data;
  const columns = new Uint32Array(width);
  const rows = new Uint32Array(height);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < GIF_ALPHA_THRESHOLD) continue;
      columns[x] += 1;
      rows[y] += 1;
      total += 1;
    }
  }
  if (!total) return null;
  const trim = Math.floor(total * 0.005);
  const quantileEdge = (counts, reverse = false) => {
    let discarded = 0;
    if (reverse) {
      for (let index = counts.length - 1; index >= 0; index -= 1) {
        discarded += counts[index];
        if (discarded > trim) return index;
      }
      return 0;
    }
    for (let index = 0; index < counts.length; index += 1) {
      discarded += counts[index];
      if (discarded > trim) return index;
    }
    return counts.length - 1;
  };
  return {
    left: quantileEdge(columns),
    top: quantileEdge(rows),
    right: quantileEdge(columns, true),
    bottom: quantileEdge(rows, true),
  };
}

function expandCrop(bounds, padding, maxWidth, maxHeight) {
  if (!bounds) return { x: 0, y: 0, width: maxWidth, height: maxHeight };
  const x = Math.max(0, bounds.left - padding);
  const y = Math.max(0, bounds.top - padding);
  const right = Math.min(maxWidth - 1, bounds.right + padding);
  const bottom = Math.min(maxHeight - 1, bounds.bottom + padding);
  return { x, y, width: Math.max(1, right - x + 1), height: Math.max(1, bottom - y + 1) };
}

function framePixelsForExport(
  frameCanvas,
  bakeChecker,
  width = SIZE,
  height = SIZE,
) {
  if (!bakeChecker) {
    return frameCanvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, width, height).data;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cell = 24;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      context.fillStyle =
        (x / cell + y / cell) % 2 === 0 ? "#c8ced8" : "#8f99a8";
      context.fillRect(x, y, cell, cell);
    }
  }
  context.drawImage(frameCanvas, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

function resizedCanvas(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return btoa(binary);
}

async function encodeWithinSize({
  duration,
  width,
  height,
  bakeChecker,
  renderFrame,
  onProgress,
}) {
  const profiles = [
        { scale: 1, fps: 20, colors: 256 },
        { scale: 0.9, fps: 18, colors: 192 },
        { scale: 0.8, fps: 15, colors: 128 },
        { scale: 0.7, fps: 12, colors: 96 },
        { scale: 0.6, fps: 10, colors: 64 },
        { scale: 0.5, fps: 8, colors: 48 },
        { scale: 0.4, fps: 6, colors: 32 },
        { scale: 0.3, fps: 5, colors: 24 },
        { scale: 0.22, fps: 4, colors: 16 },
      ];
  let result = null;
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
    const profile = profiles[profileIndex];
    const outputWidth = Math.max(2, Math.round(width * profile.scale));
    const outputHeight = Math.max(2, Math.round(height * profile.scale));
    const frameCount = Math.max(2, Math.round(duration * profile.fps));
    const gif = GIFEncoder();
    for (let frame = 0; frame < frameCount; frame += 1) {
      const elapsed = (frame / Math.max(1, frameCount - 1)) * duration;
      const rawCanvas = await renderFrame(elapsed);
      const frameCanvas = resizedCanvas(rawCanvas, outputWidth, outputHeight);
      const pixels = normalizeGifAlpha(
        framePixelsForExport(
          frameCanvas,
          bakeChecker,
          outputWidth,
          outputHeight,
        ),
      );
      const palette = quantize(pixels, profile.colors, {
        format: "rgba4444",
        oneBitAlpha: true,
        clearAlpha: true,
        clearAlphaThreshold: 0,
        clearAlphaColor: 0,
      });
      const bitmap = applyPalette(pixels, palette, "rgba4444");
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      if (transparentIndex >= 0) {
        const transparentIndexes = new Set(
          palette
            .map((color, index) => (color[3] === 0 ? index : -1))
            .filter((index) => index >= 0),
        );
        for (let index = 0; index < bitmap.length; index += 1) {
          if (transparentIndexes.has(bitmap[index])) bitmap[index] = transparentIndex;
        }
      }
      gif.writeFrame(bitmap, outputWidth, outputHeight, {
        palette,
        delay: (duration * 1000) / frameCount,
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: 2,
      });
      onProgress?.(frame, frameCount, profileIndex, profiles.length);
      await new Promise(requestAnimationFrame);
    }
    gif.finish();
    const bytes = gif.bytes();
    result = { bytes, ...profile, width: outputWidth, height: outputHeight };
    if (bytes.length <= MAX_GIF_BYTES) break;
  }
  return result;
}

function render() {
  const count = selected().length,
    total = state.files.reduce((n, f) => n + f.animations.length, 0),
    visible = visibleFiles();
  app.innerHTML = `<main><header><div class="brand"><b>S</b><div><h1>Spine GIF Expoter</h1><p>Doc closure batch tool</p></div></div><div class="stats"><span><strong>${state.files.length}</strong> Spine</span><span><strong>${total}</strong> anim</span><span><strong>${count}</strong> selected</span></div></header>
  <section class="toolbar"><label><span>Source folder</span><div><input data-source value="${esc(state.source)}" placeholder="Folder chứa Spine..."><button data-do="source">${icon("folder")}</button></div></label><button class="scan" data-do="scan" ${state.scanning ? "disabled" : ""}>${state.scanning ? "Scanning…" : "Scan Spine"}</button><i></i><label><span>GIF output</span><div><input data-output value="${esc(state.output)}" placeholder="Folder lưu GIF..."><button data-do="output">${icon("folder")}</button></div></label></section>
  ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}${state.status ? `<div class="notice ok">${esc(state.status)}</div>` : ""}
  <section class="batch-tools"><label><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input data-search value="${esc(state.search)}" placeholder="Search Spine hoặc animation..."></label><button class="clear-search ${state.search ? "" : "hidden"}" data-do="clear-search">Clear</button><span></span><button class="check-first" data-do="check-first" ${state.files.length ? "" : "disabled"}>Check first <b>${state.files.filter((file) => file.animations.length).length}</b></button><button class="uncheck-all" data-do="uncheck-all" ${count ? "" : "disabled"}>Uncheck all <b>${count || ""}</b></button></section>
  <section class="workspace"><div class="headrow"><span>Spine asset</span><span>Animations · chọn skin và animation để export</span></div><div class="groups">${visible.length ? visible.map(groupView).join("") : emptyView(Boolean(state.search))}</div></section>
  <footer><div class="progress"><div><span>${state.exporting ? esc(state.status) : `${count} animation ready`}</span><strong>${state.exporting ? `${Math.round(state.progress * 100)}%` : state.combineSymbols ? "GROUP · AUTO OPTIMIZE" : "AUTO CROP · MAX 0.5 MB"}</strong></div><aside><em style="width:${state.exporting ? state.progress * 100 : 0}%"></em></aside></div><label class="export-option"><span>Object size</span><select data-role="object-size">${OBJECT_SIZES.map((value) => `<option value="${value}" ${state.objectSize === value ? "selected" : ""}>${value}%</option>`).join("")}</select></label><label class="export-option"><span>Padding</span><select data-role="crop-padding"><option value="4" ${state.cropPadding === 4 ? "selected" : ""}>4 px</option><option value="8" ${state.cropPadding === 8 ? "selected" : ""}>8 px</option><option value="16" ${state.cropPadding === 16 ? "selected" : ""}>16 px</option><option value="24" ${state.cropPadding === 24 ? "selected" : ""}>24 px</option></select></label>${state.combineSymbols ? `<label class="export-option"><span>Object / row</span><select data-role="group-per-row">${[2, 3, 4, 5, 6].map((value) => `<option value="${value}" ${state.groupPerRow === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>` : ""}<label class="checker-export"><input type="checkbox" data-role="combine-symbols" ${state.combineSymbols ? "checked" : ""}><span>Gộp Anim</span></label><label class="checker-export"><input type="checkbox" data-role="bake-checker" ${state.bakeChecker ? "checked" : ""}><span>Bake nền caro</span></label><button class="export" data-do="export" ${!count || state.exporting ? "disabled" : ""}>${icon("export")} ${state.exporting ? "Exporting…" : state.combineSymbols ? `Export 1 Group GIF` : `Export ${count} GIF${count === 1 ? "" : "s"}`}</button></footer>
  <aside class="preview ${state.active ? "open" : ""}"><div class="preview-title"><div><strong data-preview-name>Preview</strong><span>Loop theo đúng timeframe và skin đã chọn</span></div><div class="preview-actions"><button data-do="toggle-preview" title="Play/Pause">${state.previewPaused ? "▶" : "Ⅱ"}</button><button data-do="close" title="Đóng preview">×</button></div></div><div data-canvas class="canvas"></div>${previewTrimView()}</aside></main>`;
  mountStage();
}
function emptyView(searching = false) {
  return `<div class="empty">${icon("folder")}<h2>${searching ? "Không tìm thấy kết quả" : "Chưa có Spine nào"}</h2><p>${searching ? `Không có Spine hoặc animation khớp với “${esc(state.search)}”.` : "Chọn source folder và scan. Tool sẽ gom asset theo chiều dọc, mỗi Spine là một group animation."}</p></div>`;
}
function groupView(f, i) {
  return `<article class="group"><aside class="file"><small>${String(i + 1).padStart(2, "0")}</small><div><h2>${esc(f.fileName.replace(/\.json$/i, ""))}</h2><strong class="anim-count"><b>${f.animations.length}</b> animations</strong><div class="file-meta"><span>Spine ${esc(f.version)}</span></div></div></aside><section>${f.animations.map((a) => animView(f, a)).join("") || '<p class="none">Không có animation</p>'}</section></article>`;
}
function animView(f, a) {
  const c = configOf(f, a),
    d = durationOf(f, a),
    max = Math.max(d, c.end, 0.01),
    k = keyOf(f, a);
  const skinOptions = f.skins?.length
    ? f.skins
        .map(
          (skin) =>
            `<option value="${esc(skin)}" ${c.skin === skin ? "selected" : ""}>${esc(skin)}</option>`,
        )
        .join("")
    : '<option value="">Default</option>';
  return `<div class="anim ${c.selected ? "selected" : ""} ${state.active === k ? "active" : ""}" data-key="${esc(k)}"><label class="check" title="Chọn animation để export GIF"><input type="checkbox" data-role="select" ${c.selected ? "checked" : ""}><span></span></label><div class="anim-name"><b>◆</b><strong>${esc(a)}</strong></div><label class="skin"><span>Skin</span><select data-role="skin" ${f.skins?.length ? "" : "disabled"}>${skinOptions}</select></label><div class="row-progress" data-trim-editor data-key="${esc(k)}"><div><span>${fmt(c.start)}</span><output>${fmt(c.end)}</output></div><section style="--a:${(c.start / max) * 100}%;--b:${(c.end / max) * 100}%"><i></i><b></b><input type="range" data-role="start" min="0" max="${max}" step=".01" value="${c.start}"><input type="range" data-role="end" min="0" max="${max}" step=".01" value="${c.end}"></section></div><button class="preview-row-btn" data-do="preview">Preview</button></div>`;
}

function previewTrimView() {
  const x = findItem(state.active);
  if (!x) return "";
  const c = x.config,
    max = Math.max(durationOf(x.file, x.animation), c.end, 0.01);
  return `<div class="preview-trim" data-trim-editor data-key="${esc(state.active)}"><div class="preview-trim-head"><span>Timeframe</span><output>${fmt(c.start)} — ${fmt(c.end)} <em>${fmt(c.end - c.start)}</em></output></div><div class="trim"><section style="--a:${(c.start / max) * 100}%;--b:${(c.end / max) * 100}%"><i></i><b></b><input type="range" data-role="start" min="0" max="${max}" step=".01" value="${c.start}"><input type="range" data-role="end" min="0" max="${max}" step=".01" value="${c.end}"></section></div><div class="times"><label>From<input data-role="start-number" type="number" min="0" max="${max}" step=".01" value="${c.start.toFixed(2)}"></label><label>To<input data-role="end-number" type="number" min="0" max="${max}" step=".01" value="${c.end.toFixed(2)}"></label></div></div>`;
}
function findItem(key) {
  return items().find((x) => keyOf(x.file, x.animation) === key);
}

async function scan() {
  if (!state.source.trim()) {
    state.error = "Chọn source folder trước.";
    render();
    return;
  }
  state.scanning = true;
  state.error = "";
  state.status = "";
  render();
  const r = await window.spinePreview.scanFolder(state.source.trim());
  state.scanning = false;
  if (r?.error) {
    state.error = r.error;
    state.files = [];
  } else {
    state.files = r.files || [];
    state.status = `Đã tìm thấy ${state.files.length} Spine asset.`;
    if (!state.output) state.output = state.source;
  }
  localStorage.setItem("gif-source", state.source);
  localStorage.setItem("gif-output", state.output);
  render();
}
function destroyStage() {
  cancelAnimationFrame(state.previewFrame);
  state.previewFrame = 0;
  state.stage?.destroy();
  state.stage = null;
  state.spine = null;
}

function startPreviewLoop(item, startTime = item.config.start) {
  cancelAnimationFrame(state.previewFrame);
  state.previewPaused = false;
  state.previewStartedAt =
    performance.now() - (startTime - item.config.start) * 1000;
  const tick = (now) => {
    if (
      !state.stage ||
      !state.spine ||
      state.active !== keyOf(item.file, item.animation)
    )
      return;
    if (!state.previewPaused) {
      const length = Math.max(0.01, item.config.end - item.config.start);
      const time =
        item.config.start + (((now - state.previewStartedAt) / 1000) % length);
      SpineStage.seek(state.spine, time);
      state.stage.renderOnce();
      state.previewPauseTime = time;
    }
    state.previewFrame = requestAnimationFrame(tick);
  };
  state.previewFrame = requestAnimationFrame(tick);
}
function mountStage() {
  if (state.stage && state.active) {
    const box = document.querySelector("[data-canvas]");
    if (box) {
      state.stage.setContainer(box);
      box.appendChild(state.stage.app.view);
      state.stage.syncViewportSize();
      state.stage.renderOnce();
    }
  }
}
function fit(stage, spine) {
  const b = spine.getLocalBounds(),
    v = stage.app.screen,
    s = Math.min(
      (v.width * 0.8) / Math.max(1, b.width),
      (v.height * 0.8) / Math.max(1, b.height),
    );
  spine.scale.set(clamp(s, 0.05, 8));
  stage.centerSpineAt(spine, v.width / 2, v.height / 2);
}
async function preview(key) {
  const x = findItem(key);
  if (!x) return;
  state.active = key;
  destroyStage();
  render();
  try {
    const box = document.querySelector("[data-canvas]"),
      stage = new SpineStage(box, {
        backgroundColor: 0x000000,
        backgroundAlpha: 0,
        resolution: 1,
      });
    stage.app.ticker.stop();
    const spine = await stage.loadSpine(x.file);
    if (x.config.skin) SpineStage.setSkin(spine, x.config.skin);
    SpineStage.playAnimation(spine, x.animation, false);
    SpineStage.seek(spine, x.config.start);
    fit(stage, spine);
    stage.renderOnce();
    state.stage = stage;
    state.spine = spine;
    startPreviewLoop(x);
    document.querySelector("[data-preview-name]").textContent =
      `${x.file.fileName.replace(/\.json$/i, "")} / ${x.animation}`;
  } catch (e) {
    state.error = e.message;
    destroyStage();
    render();
  }
}
function trim(editor, role, raw) {
  const x = findItem(editor.dataset.key);
  if (!x) return;
  const max = Math.max(durationOf(x.file, x.animation), x.config.end, 0.01),
    v = clamp(Number(raw) || 0, 0, max);
  if (role.startsWith("start"))
    x.config.start = Math.min(v, x.config.end - 0.01);
  else x.config.end = Math.max(v, x.config.start + 0.01);
  document.querySelectorAll("[data-trim-editor]").forEach((linkedEditor) => {
    if (linkedEditor.dataset.key !== editor.dataset.key) return;
    linkedEditor.querySelector("[data-role=start]").value = x.config.start;
    linkedEditor.querySelector("[data-role=end]").value = x.config.end;
    const startNumber = linkedEditor.querySelector("[data-role=start-number]");
    const endNumber = linkedEditor.querySelector("[data-role=end-number]");
    if (startNumber) startNumber.value = x.config.start.toFixed(2);
    if (endNumber) endNumber.value = x.config.end.toFixed(2);
    const output = linkedEditor.querySelector("output");
    if (output) {
      output.innerHTML = linkedEditor.classList.contains("row-progress")
        ? fmt(x.config.end)
        : `${fmt(x.config.start)} — ${fmt(x.config.end)} <em>${fmt(x.config.end - x.config.start)}</em>`;
    }
    const startLabel = linkedEditor.querySelector(".row-progress span");
    if (startLabel) startLabel.textContent = fmt(x.config.start);
    const bar = linkedEditor.querySelector(
      ".trim section, .row-progress section",
    );
    bar.style.setProperty("--a", `${(x.config.start / max) * 100}%`);
    bar.style.setProperty("--b", `${(x.config.end / max) * 100}%`);
  });
  if (state.active === editor.dataset.key && state.spine) {
    SpineStage.seek(
      state.spine,
      role.startsWith("start") ? x.config.start : x.config.end,
    );
    state.stage.renderOnce();
    state.previewStartedAt = performance.now();
  }
}

async function encode(x, n, total) {
  const host = document.createElement("div");
  host.className = "offscreen";
  document.body.append(host);
  const stage = new SpineStage(host, {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    resolution: 1,
  });
  stage.app.ticker.stop();
  try {
    const spine = await stage.loadSpine(x.file);
    if (x.config.skin) SpineStage.setSkin(spine, x.config.skin);
    SpineStage.playAnimation(spine, x.animation, false);
    const frames = Math.max(
        2,
        Math.round((x.config.end - x.config.start) * FPS),
      ),
      samples = [];
    for (let i = 0; i < frames; i++) {
      const time =
        x.config.start +
        (i / Math.max(1, frames - 1)) * (x.config.end - x.config.start);
      SpineStage.seek(spine, time);
      const b = spine.getLocalBounds();
      samples.push({
        time,
        x: b.x,
        y: b.y,
        r: b.x + b.width,
        b: b.y + b.height,
      });
    }
    const u = samples.reduce(
        (q, b) => ({
          x: Math.min(q.x, b.x),
          y: Math.min(q.y, b.y),
          r: Math.max(q.r, b.r),
          b: Math.max(q.b, b.b),
        }),
        { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
      ),
      w = Math.max(1, u.r - u.x),
      h = Math.max(1, u.b - u.y),
      scale = Math.min(
        (SIZE * (state.objectSize / 100)) / w,
        (SIZE * (state.objectSize / 100)) / h,
      );
    spine.scale.set(clamp(scale, 0.05, 8));
    spine.position.set(
      SIZE / 2 - (u.x + w / 2) * spine.scale.x,
      SIZE / 2 - (u.y + h / 2) * spine.scale.y,
    );
    let pixelBounds = null;
    for (const sample of samples) {
      SpineStage.seek(spine, sample.time);
      stage.renderOnce();
      const bounds = visiblePixelBounds(
        stage.extractCanvasRegion(0, 0, SIZE, SIZE),
      );
      if (!bounds) continue;
      pixelBounds = pixelBounds
        ? {
            left: Math.min(pixelBounds.left, bounds.left),
            top: Math.min(pixelBounds.top, bounds.top),
            right: Math.max(pixelBounds.right, bounds.right),
            bottom: Math.max(pixelBounds.bottom, bounds.bottom),
          }
        : bounds;
    }
    const crop = expandCrop(pixelBounds, state.cropPadding, SIZE, SIZE);
    const bakeChecker = state.bakeChecker || x.file.usesAdditiveBlend;
    const duration = Math.max(0.05, x.config.end - x.config.start);
    const encoded = await encodeWithinSize({
      duration,
      width: crop.width,
      height: crop.height,
      bakeChecker,
      renderFrame: async (elapsed) => {
        SpineStage.seek(spine, x.config.start + elapsed);
        stage.renderOnce();
        return stage.extractCanvasRegion(
          crop.x,
          crop.y,
          crop.width,
          crop.height,
        );
      },
      onProgress: (frame, frameCount, profileIndex) => {
        state.progress = (n + (frame + 1) / frameCount) / total;
        state.status = `${profileIndex ? "Optimizing · " : ""}${x.file.fileName.replace(/\.json$/i, "")} / ${x.animation}`;
        updateProgress();
      },
    });
    return {
      fileName: `${clean(x.file.fileName)}_${clean(x.animation)}.gif`,
      dataBase64: bytesToBase64(encoded.bytes),
    };
  } finally {
    stage.destroy();
    host.remove();
  }
}

async function encodeCombined(list) {
  const width = 960,
    height = 540;
  const host = document.createElement("div");
  host.className = "offscreen";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.append(host);
  const stage = new SpineStage(host, {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    resolution: 1,
  });
  stage.app.ticker.stop();
  try {
    const loaded = [];
    const columns = Math.min(state.groupPerRow, list.length);
    const rows = Math.ceil(list.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const spine = await stage.loadSpine(item.file);
      if (item.config.skin) SpineStage.setSkin(spine, item.config.skin);
      SpineStage.playAnimation(spine, item.animation, false);
      SpineStage.seek(spine, item.config.start);
      const bounds = spine.getLocalBounds();
      const scale = Math.min(
        ((cellWidth - state.cropPadding * 2) * (state.objectSize / 100)) /
          Math.max(1, bounds.width),
        ((cellHeight - state.cropPadding * 2) * (state.objectSize / 100)) /
          Math.max(1, bounds.height),
      );
      spine.scale.set(clamp(scale, 0.03, 8));
      const column = index % columns;
      const row = Math.floor(index / columns);
      stage.centerSpineAt(
        spine,
        column * cellWidth + cellWidth / 2,
        row * cellHeight + cellHeight / 2,
      );
      loaded.push({ item, spine });
    }
    const duration = Math.max(
      ...list.map((item) =>
        Math.max(0.05, item.config.end - item.config.start),
      ),
    );
    const frameCount = Math.max(2, Math.round(duration * FPS));
    let pixelBounds = null;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const elapsed = frame / FPS;
      loaded.forEach(({ item, spine }) => {
        const length = Math.max(0.01, item.config.end - item.config.start);
        SpineStage.seek(spine, item.config.start + (elapsed % length));
      });
      stage.renderOnce();
      const bounds = visiblePixelBounds(
        stage.extractCanvasRegion(0, 0, width, height),
      );
      if (!bounds) continue;
      pixelBounds = pixelBounds
        ? {
            left: Math.min(pixelBounds.left, bounds.left),
            top: Math.min(pixelBounds.top, bounds.top),
            right: Math.max(pixelBounds.right, bounds.right),
            bottom: Math.max(pixelBounds.bottom, bounds.bottom),
          }
        : bounds;
    }
    const crop = expandCrop(pixelBounds, state.cropPadding, width, height);
    const bakeChecker =
      state.bakeChecker || list.some((item) => item.file.usesAdditiveBlend);
    const encoded = await encodeWithinSize({
      duration,
      width: crop.width,
      height: crop.height,
      bakeChecker,
      renderFrame: async (elapsed) => {
        loaded.forEach(({ item, spine }) => {
          const length = Math.max(0.01, item.config.end - item.config.start);
          SpineStage.seek(spine, item.config.start + (elapsed % length));
        });
        stage.renderOnce();
        return stage.extractCanvasRegion(
          crop.x,
          crop.y,
          crop.width,
          crop.height,
        );
      },
      onProgress: (frame, count, profileIndex) => {
        state.progress = (frame + 1) / count;
        state.status = `${profileIndex ? "Optimizing" : "Rendering group"} · ${frame + 1}/${count}`;
        updateProgress();
      },
    });
    return {
      fileName: "anim_group.gif",
      dataBase64: bytesToBase64(encoded.bytes),
    };
  } finally {
    stage.destroy();
    host.remove();
  }
}
function updateProgress() {
  const fill = document.querySelector("footer aside em"),
    label = document.querySelector(".progress span"),
    pct = document.querySelector(".progress strong");
  if (fill) fill.style.width = `${state.progress * 100}%`;
  if (label) label.textContent = state.status;
  if (pct) pct.textContent = `${Math.round(state.progress * 100)}%`;
}
async function exportAll() {
  const list = selected();
  if (!list.length) return;
  if (!state.output.trim()) {
    state.error = "Chọn folder output trước.";
    render();
    return;
  }
  state.exporting = true;
  state.error = "";
  state.status = "Đang chuẩn bị…";
  render();
  try {
    const files = [];
    if (state.combineSymbols) {
      files.push(await encodeCombined(list));
    } else {
      for (let i = 0; i < list.length; i++)
        files.push(await encode(list[i], i, list.length));
    }
    const r = await window.spinePreview.saveBatchGifs({
      outputDir: state.output.trim(),
      files,
    });
    if (!r?.ok) throw new Error(r?.error || "Không lưu được GIF.");
    state.status = `Đã export ${r.writtenFiles.length} GIF vào ${state.output}.`;
  } catch (e) {
    state.error = e.message || "Export GIF thất bại.";
    state.status = "";
  }
  state.exporting = false;
  state.progress = 0;
  render();
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-do]");
  if (!b) {
    const row = e.target.closest(".anim");
    const isControl = e.target.closest(
      "input, select, button, label, [data-trim-editor]",
    );
    if (row && !isControl) {
      const item = findItem(row.dataset.key);
      if (item) {
        item.config.selected = !item.config.selected;
        render();
      }
    }
    return;
  }
  const a = b.dataset.do;
  if (a === "source") {
    const v = await window.spinePreview.selectFolder();
    if (v) {
      state.source = v;
      if (!state.output) state.output = v;
      render();
    }
  } else if (a === "output") {
    const v = await window.spinePreview.selectExportFolder();
    if (v) {
      state.output = v;
      localStorage.setItem("gif-output", v);
      render();
    }
  } else if (a === "scan") scan();
  else if (a === "preview") preview(b.closest(".anim").dataset.key);
  else if (a === "toggle-preview") {
    const item = findItem(state.active);
    if (!item || !state.spine) return;
    state.previewPaused = !state.previewPaused;
    if (!state.previewPaused) {
      state.previewStartedAt =
        performance.now() - (state.previewPauseTime - item.config.start) * 1000;
    }
    b.textContent = state.previewPaused ? "▶" : "Ⅱ";
  } else if (a === "close") {
    state.active = "";
    destroyStage();
    render();
  } else if (a === "export") exportAll();
  else if (a === "uncheck-all") {
    items().forEach((item) => {
      item.config.selected = false;
    });
    render();
  } else if (a === "check-first") {
    items().forEach((item) => {
      item.config.selected = false;
    });
    state.files.forEach((file) => {
      const firstAnimation = file.animations[0];
      if (firstAnimation) configOf(file, firstAnimation).selected = true;
    });
    render();
  } else if (a === "clear-search") {
    state.search = "";
    render();
    document.querySelector("[data-search]")?.focus();
  }
});
app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("[data-source]")) state.source = t.value;
  else if (t.matches("[data-search]")) {
    state.search = t.value;
    const visible = visibleFiles();
    const groups = document.querySelector(".groups");
    if (groups) {
      groups.innerHTML = visible.length
        ? visible.map(groupView).join("")
        : emptyView(Boolean(state.search));
    }
    document
      .querySelector(".clear-search")
      ?.classList.toggle("hidden", !state.search);
  }
  else if (t.matches("[data-output]")) {
    state.output = t.value;
    localStorage.setItem("gif-output", t.value);
  } else if (t.matches("[data-role^=start],[data-role^=end]"))
    trim(t.closest("[data-trim-editor]"), t.dataset.role, t.value);
});
app.addEventListener("change", (e) => {
  const t = e.target,
    row = t.closest(".anim");
  if (t.dataset.role === "bake-checker") {
    state.bakeChecker = t.checked;
    localStorage.setItem("gif-bake-checker", String(t.checked));
    return;
  }
  if (t.dataset.role === "combine-symbols") {
    state.combineSymbols = t.checked;
    localStorage.setItem("gif-combine-symbols", String(t.checked));
    render();
    return;
  }
  if (t.dataset.role === "object-size") {
    state.objectSize = Number(t.value) || 80;
    localStorage.setItem("gif-object-size", String(state.objectSize));
    render();
    return;
  }
  if (t.dataset.role === "crop-padding") {
    state.cropPadding = Number(t.value) || 8;
    localStorage.setItem("gif-crop-padding", String(state.cropPadding));
    render();
    return;
  }
  if (t.dataset.role === "group-per-row") {
    state.groupPerRow = clamp(Number(t.value) || 5, 2, 6);
    localStorage.setItem("gif-group-per-row", String(state.groupPerRow));
    render();
    return;
  }
  if (!row) return;
  const x = findItem(row.dataset.key);
  if (t.dataset.role === "select") {
    x.config.selected = t.checked;
    render();
  } else if (t.dataset.role === "skin") {
    x.config.skin = t.value;
    if (state.active === row.dataset.key) preview(row.dataset.key);
  }
});
window.addEventListener("resize", () => {
  if (state.stage) {
    state.stage.syncViewportSize();
    fit(state.stage, state.spine);
    state.stage.renderOnce();
  }
});
render();
if (state.source) scan();
