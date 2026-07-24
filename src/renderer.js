import './index.css';
import { SpineStage } from './spineStage.js';
import { toAssetUrl } from './shared/assetUrl.js';
import previewBackgroundUrl from './background.jpg';

const ZOOM_STEP = 1.2;
const FRAME_STEP = 1 / 60;
const LOADING_SCREEN_MAX_DURATION_MS = 2000;
const READY_FADE_DURATION_MS = 320;
const SOUND_FEATURE_ENABLED = false;
const EXPORT_FEATURE_ENABLED = false;

const CONTROL_TABS = [
  { id: 'playback', label: 'Playback' },
  { id: 'export', label: 'Sprite Frame Export' },
];

const CHECKER_BG =
  'repeating-conic-gradient(#9aa3ad 0% 25%, #cdd4db 0% 50%) 50% / 24px 24px';

const SCENE_IMAGE_BG = `url('${previewBackgroundUrl}') center / cover no-repeat`;

const BACKGROUND_PRESETS = [
  { id: 'scene', label: 'Scene', value: 'transparent', swatch: 'transparent' },
  { id: 'checker', label: 'Checker', value: SCENE_IMAGE_BG, swatch: CHECKER_BG },
];

function backgroundCssValue(background) {
  if (!background || background === 'scene') {
    return 'transparent';
  }
  const preset = BACKGROUND_PRESETS.find((item) => item.id === background);
  if (preset) {
    return preset.value;
  }
  // Custom hex color
  return background;
}

let resizeFrameId = 0;
let previewResizeObserver = null;
let previewInstanceIdSeed = 0;

const state = {
  folderPath: '',
  soundFolderPath: '',
  files: [],
  soundFiles: [],
  fileSearch: '',
  currentIndex: -1,
  theme: 'dark',
  background: 'scene',
  uiMode: 'preview',
  controlTab: 'playback',
  contextMenu: { open: false, x: 0, y: 0, instanceId: '' },
  loading: true,
  readyAnimating: false,
  scanning: false,
  soundScanning: false,
  error: '',
  success: '',
  preview: {
    stage: null,
    spine: null,
    activeInstanceId: '',
    isLoading: false,
    error: '',
    paused: false,
    loop: true,
    currentAnimation: '',
    currentSkin: '',
    speed: 1,
    elapsed: 0,
    duration: 0,
    zoom: 1,
    sequence: [],
    sequenceLoopLast: true,
    sequenceRunning: false,
    sequenceDurations: null,
    sequenceStep: 0,
    sequenceCleanup: null,
    expanded: false,
    playWithSound: false,
    soundOffsetMs: 0,
    soundAudio: null,
    selectedSoundId: '',
    animationListOpen: true,
    animationListPos: 'left',
    animationListXY: null,
    instances: [],
  },
  export: {
    outputDir: '',
    anchorX: '0.5',
    anchorY: '0.5',
    selectedFileIds: [],
    isExporting: false,
    lastSummary: '',
    lastOutputDir: '',
    frameQueue: [],
  },
  draggingFileId: '',
  previewRequestId: 0,
};

const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatSeconds(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatSoundOffset(valueMs) {
  return `${(valueMs / 1000).toFixed(1)}s`;
}

function formatAnimationDuration(value) {
  return `${formatSeconds(value)}s`;
}

function playbackToggleIconMarkup() {
  if (state.preview.paused || hasReachedAnimationEnd()) {
    return `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none" />
      </svg>
    `;
  }

  return `
    <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </svg>
  `;
}

function snapToFrame(value) {
  return Math.round(value / FRAME_STEP) * FRAME_STEP;
}

function updateFolder(value) {
  state.folderPath = value;
  localStorage.setItem('spine-preview-folder', value);
}

function updateSoundFolder(value) {
  state.soundFolderPath = value;
  localStorage.setItem('spine-preview-sound-folder', value);
}

function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem('spine-preview-theme', state.theme);
  render();
}

function applyPreviewBackground() {
  const css = backgroundCssValue(state.background);
  document.querySelectorAll('[data-preview-bg-target]').forEach((node) => {
    node.style.background = css;
  });

  // Sync swatch active state + custom swatch color without re-rendering,
  // so the native color popup stays open while the user is still picking.
  const isCustom = !BACKGROUND_PRESETS.some((preset) => preset.id === state.background);
  document.querySelectorAll('[data-background]').forEach((node) => {
    node.classList.toggle('active', node.dataset.background === state.background);
  });
  const customSwatch = document.querySelector('.bg-swatch-custom');
  if (customSwatch) {
    customSwatch.classList.toggle('active', isCustom);
    if (isCustom) {
      customSwatch.style.setProperty('--swatch', state.background);
    }
  }
}

function setBackground(background) {
  state.background = background;
  localStorage.setItem('spine-preview-background', background);
  render();
}

// Live update for the color picker: changes the background and persists it
// WITHOUT re-rendering, so the native color popup stays open while picking.
function setBackgroundLive(background) {
  state.background = background;
  localStorage.setItem('spine-preview-background', background);
  applyPreviewBackground();
}

function updateStatus(error = '') {
  state.error = error;
  if (error) {
    state.success = '';
  }
  render();
}

function updateSuccess(message = '') {
  state.success = message;
  if (message) {
    state.error = '';
  }
  render();
}

function setUiMode(mode) {
  if (!EXPORT_FEATURE_ENABLED) {
    state.uiMode = 'preview';
    render();
    return;
  }

  state.uiMode = mode === 'export' ? 'export' : 'preview';
  render();
}

function syncDefaultExportOutputDir() {
  if (!state.folderPath.trim()) {
    return;
  }

  if (!state.export.outputDir.trim()) {
    state.export.outputDir = state.folderPath.trim();
  }
}

function getCurrentFile() {
  return state.files[state.currentIndex] ?? null;
}

function getFileById(fileId) {
  return state.files.find((file) => file.id === fileId) ?? null;
}

function isExportFileSelected(fileId) {
  return state.export.selectedFileIds.includes(fileId);
}

function spineDisplayName(file) {
  return String(file?.fileName ?? '')
    .replace(/\.json$/i, '')
    .trim();
}

function createPreviewInstance(fileId) {
  return {
    id: `preview-instance-${previewInstanceIdSeed += 1}`,
    fileId,
    spine: null,
    currentAnimation: '',
    currentSkin: '',
    loop: true,
    paused: false,
    speed: 1,
    elapsed: 0,
    duration: 0,
    zoom: 1,
    position: { x: 0, y: 0 },
    sequence: [],
    sequenceLoopLast: true,
    sequenceRunning: false,
    sequenceDurations: null,
    sequenceStep: 0,
    sequenceCleanup: null,
    exportCanvasMode: 'auto',
    exportCanvasSize: { width: 0, height: 0 },
    // Per-animation-name cache: each animation gets one fixed reference box
    // (captured at its first frame) and one pixel anchor offset, so the
    // canvas never chases the animated pose and switching back to an
    // animation always shows the same canvas without re-locking it.
    canvasBoundsByAnim: {},
    canvasAnchorByAnim: {},
    appliedCanvasAnchor: { x: 0, y: 0 },
  };
}

function getPreviewInstanceById(instanceId) {
  return state.preview.instances.find((instance) => instance.id === instanceId) ?? null;
}

function getPreviewInstanceBySpine(spine) {
  return state.preview.instances.find((instance) => instance.spine === spine) ?? null;
}

function getActivePreviewInstance() {
  return getPreviewInstanceById(state.preview.activeInstanceId);
}

function getPreviewFile(instance) {
  return instance ? getFileById(instance.fileId) : null;
}

function syncPreviewInstances() {
  const validIds = new Set(state.files.map((file) => file.id));
  state.preview.instances = state.preview.instances.filter(
    (instance) => validIds.has(instance.fileId),
  );
  if (!getActivePreviewInstance()) {
    state.preview.activeInstanceId = state.preview.instances[0]?.id ?? '';
  }
}

function normalizeFileBaseName(name) {
  return String(name ?? '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase();
}

function getCurrentSoundFile() {
  if (!SOUND_FEATURE_ENABLED) {
    return null;
  }

  if (!state.soundFiles.length) {
    return null;
  }

  if (state.preview.selectedSoundId) {
    return state.soundFiles.find((sound) => sound.id === state.preview.selectedSoundId) ?? null;
  }

  const current = getCurrentFile();
  if (!current) {
    return null;
  }

  const candidates = [
    normalizeFileBaseName(current.fileName),
    normalizeFileBaseName(current.relativeName.split('/').pop() ?? ''),
    normalizeFileBaseName(state.preview.currentAnimation),
  ].filter(Boolean);

  return (
    state.soundFiles.find((sound) => candidates.includes(sound.baseName)) ??
    state.soundFiles.find((sound) => candidates.some((name) => sound.baseName.includes(name) || name.includes(sound.baseName))) ??
    null
  );
}

function getFilteredFiles() {
  const query = state.fileSearch.trim().toLowerCase();
  if (!query) {
    return state.files;
  }

  return state.files.filter((file) => {
    const name = `${file.relativeName} ${file.fileName}`.toLowerCase();
    return name.includes(query);
  });
}

function getFilteredIndex() {
  const current = getCurrentFile();
  if (!current) {
    return -1;
  }

  return getFilteredFiles().findIndex((file) => file.id === current.id);
}

function clampIndex(index) {
  if (state.files.length === 0) {
    return -1;
  }
  return Math.max(0, Math.min(index, state.files.length - 1));
}

function setCurrentIndex(index) {
  const nextIndex = clampIndex(index);
  if (nextIndex === -1 || nextIndex === state.currentIndex) {
    state.currentIndex = nextIndex;
    render();
    return;
  }

  state.currentIndex = nextIndex;
  render();
}

function setCurrentFileById(fileId) {
  const index = state.files.findIndex((file) => file.id === fileId);
  if (index >= 0) {
    setCurrentIndex(index);
  }
}

function normalizeSearchValue(value) {
  return value.trim().toLowerCase();
}

function maybeSelectFileFromSearch() {
  const query = normalizeSearchValue(state.fileSearch);
  if (!query) {
    return false;
  }

  const exactMatch = state.files.find(
    (file) => file.relativeName.toLowerCase() === query || file.fileName.toLowerCase() === query,
  );

  if (exactMatch) {
    state.fileSearch = '';
    setCurrentFileById(exactMatch.id);
    return true;
  }

  return false;
}

function clearFileSearch() {
  state.fileSearch = '';
  render();

  const searchInput = document.querySelector('[data-file-search]');
  if (searchInput instanceof HTMLInputElement) {
    searchInput.focus();
  }
}

function clampAnchorValue(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, next));
}

function getExportAnchor() {
  return {
    x: clampAnchorValue(state.export.anchorX),
    y: clampAnchorValue(state.export.anchorY),
  };
}

function setExportSelection(fileIds) {
  const validIds = fileIds.filter((fileId) => getFileById(fileId));
  state.export.selectedFileIds = [...new Set(validIds)];
}

function toggleExportFileSelection(fileId) {
  if (!getFileById(fileId)) {
    return;
  }

  if (isExportFileSelected(fileId)) {
    state.export.selectedFileIds = state.export.selectedFileIds.filter((id) => id !== fileId);
  } else {
    state.export.selectedFileIds = [...state.export.selectedFileIds, fileId];
  }
}

function syncExportSelection() {
  const validIds = new Set(state.files.map((file) => file.id));
  setExportSelection(state.export.selectedFileIds.filter((fileId) => validIds.has(fileId)));
}

function createOffscreenExportRoot() {
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.position = 'fixed';
  root.style.left = '-100000px';
  root.style.top = '0';
  root.style.width = '64px';
  root.style.height = '64px';
  root.style.pointerEvents = 'none';
  root.style.opacity = '0';
  document.body.appendChild(root);
  return root;
}

async function renderSpinePoseToCanvas(file, options = {}) {
  const root = createOffscreenExportRoot();
  const stage = new SpineStage(root, {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    // Force 1:1 pixels — PIXI's extract multiplies by renderer.resolution,
    // so leaving this at devicePixelRatio would make the exported PNG bigger
    // than the width/height we just computed on any HiDPI display.
    resolution: 1,
  });

  try {
    const spine = await stage.loadSpine({
      jsonPath: file.jsonPath,
      atlasPath: file.atlasPath,
    });

    if (file.skins.length) {
      const skin = options.skinName && file.skins.includes(options.skinName)
        ? options.skinName
        : (file.skins.includes('default') ? 'default' : file.skins[0]);
      SpineStage.setSkin(spine, skin);
    }

    const animation = options.animationName || getDefaultAnimation(file);
    if (animation) {
      SpineStage.playAnimation(spine, animation, false);
      if (Number.isFinite(options.elapsedTime) && options.elapsedTime > 0) {
        SpineStage.seek(spine, options.elapsedTime);
      }
    }

    spine.update(0);
    await waitForNextFrame();

    // A lockedBounds override anchors every frame in a queue to the same
    // reference box (see ensureCanvasAnchorBounds) instead of each frame
    // cropping to its own current pose — so exported frames stay aligned.
    // anchorOffset shifts the character inside that fixed canvas, matching
    // the preview overlay's anchorX/anchorY nudge. The canvas grows by twice
    // the offset (same as naturalExportSize) so the nudge can't push the
    // character past the edge and get clipped.
    const bounds = options.lockedBounds ?? spine.getLocalBounds();
    const anchorOffset = options.anchorOffset ?? { x: 0, y: 0 };
    const minX = bounds.x;
    const minY = bounds.y;
    const marginX = Math.abs(anchorOffset.x);
    const marginY = Math.abs(anchorOffset.y);
    const width = Math.max(2, Math.round(bounds.width + marginX * 2));
    const height = Math.max(2, Math.round(bounds.height + marginY * 2));
    stage.app.renderer.resize(width, height);
    spine.position.set(
      marginX - minX + anchorOffset.x,
      marginY - minY + anchorOffset.y,
    );
    stage.renderOnce();

    // extract.canvas(stage) with no frame auto-crops to content bounds,
    // discarding the padding/anchor margin we just sized the renderer to —
    // extractCanvasRegion forces it to capture the full computed rect.
    const canvas = stage.extractCanvasRegion(0, 0, width, height);
    return { canvas, bounds, logicalWidth: width, logicalHeight: height };
  } finally {
    stage.destroy();
    root.remove();
  }
}

async function exportFileToSpinePackageData(file, anchor, options = {}) {
  const { canvas, bounds, logicalWidth, logicalHeight } = await renderSpinePoseToCanvas(file, options);
  const actualWidth = canvas.width || logicalWidth;
  const actualHeight = canvas.height || logicalHeight;
  const scaleX = actualWidth / logicalWidth;
  const scaleY = actualHeight / logicalHeight;
  const basePath = String(file.relativeName || file.fileName).replace(/\.json$/i, '');

  return {
    pngDataUrl: canvas.toDataURL('image/png'),
    width: actualWidth,
    height: actualHeight,
    pivotX: bounds.width * anchor.x * scaleX,
    pivotY: bounds.height * anchor.y * scaleY,
    spineVersion: file.version,
    relativeBasePath: `${basePath}_${options.suffix || 'pivot'}`,
  };
}

// Resizes the canvas to exactly the requested size, keeping the character
// centered (anchor is always canvas-center). A size smaller than the
// natural render crops evenly from all sides instead of being ignored —
// canvasWidth/Height of 0 (or blank) means "auto" (use the natural render).
function fitCanvasToSize(canvas, canvasWidth, canvasHeight) {
  const requestedWidth = Math.round(canvasWidth) || 0;
  const requestedHeight = Math.round(canvasHeight) || 0;
  const outWidth = Math.max(1, requestedWidth > 0 ? requestedWidth : canvas.width);
  const outHeight = Math.max(1, requestedHeight > 0 ? requestedHeight : canvas.height);

  if (outWidth === canvas.width && outHeight === canvas.height) {
    return canvas;
  }

  const output = document.createElement('canvas');
  output.width = outWidth;
  output.height = outHeight;
  output.getContext('2d').drawImage(
    canvas,
    Math.round((outWidth - canvas.width) / 2),
    Math.round((outHeight - canvas.height) / 2),
  );
  return output;
}

async function captureSpriteFramePng(file, options = {}) {
  const { canvas } = await renderSpinePoseToCanvas(file, options);
  const size = options.canvasSize ?? { width: 0, height: 0 };
  const fitted = fitCanvasToSize(canvas, size.width, size.height);
  return fitted.toDataURL('image/png');
}

function dedupeFileNames(names) {
  const counts = new Map();
  return names.map((name) => {
    const count = counts.get(name) ?? 0;
    counts.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

async function handleSelectExportFolder() {
  const selectExportFolder = window.spinePreview.selectExportFolder
    ?? window.spinePreview.selectFolder;
  if (typeof selectExportFolder !== 'function') {
    updateStatus('Không tìm thấy API chọn folder export. Restart app giúp mình nhé.');
    return;
  }

  const folder = await selectExportFolder();
  if (folder) {
    state.export.outputDir = folder;
    state.export.lastSummary = '';
    updateSuccess('');
    render();
  }
}

async function handleBatchExportPng() {
  syncExportSelection();
  const files = state.export.selectedFileIds
    .map((fileId) => getFileById(fileId))
    .filter(Boolean);

  if (!files.length) {
    updateStatus('Chọn ít nhất một Spine file để export PNG.');
    return;
  }

  if (!state.export.outputDir.trim()) {
    updateStatus('Chọn folder output trước khi export PNG.');
    return;
  }

  state.export.isExporting = true;
  state.export.lastSummary = '';
  updateStatus('');
  render();

  try {
    const anchor = getExportAnchor();
    const payloadFiles = [];

    for (const file of files) {
      const packageData = await exportFileToSpinePackageData(file, anchor);
      payloadFiles.push(packageData);
    }

    const saveBatchSpineExport = window.spinePreview.saveBatchSpineExport
      ?? window.spinePreview.saveBatchPng;
    if (typeof saveBatchSpineExport !== 'function') {
      updateStatus('Không tìm thấy API export Spine package. Restart app giúp mình nhé.');
      return;
    }

    const result = await saveBatchSpineExport({
      outputDir: state.export.outputDir.trim(),
      files: payloadFiles,
    });

    if (!result?.ok) {
      updateStatus(result?.error || 'Không thể export PNG.');
      return;
    }

    state.export.lastSummary = `${result.writtenFiles.length} spine packages exported.`;
    updateSuccess(state.export.lastSummary);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : 'Không thể export PNG.');
  } finally {
    state.export.isExporting = false;
    render();
  }
}

function sanitizeForFileName(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function canRegisterFrame() {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !instance.paused || !instance.currentAnimation) {
    return false;
  }

  return Number.isFinite(instance.elapsed) && instance.elapsed >= 0;
}

function registerFrameExport() {
  if (!canRegisterFrame()) {
    updateStatus('Pause animation ở một frame hợp lệ trước khi đăng ký export sprite frame.');
    return;
  }

  const instance = getActivePreviewInstance();
  const file = getPreviewFile(instance);
  if (!file) {
    return;
  }

  syncDefaultExportOutputDir();
  state.export.frameQueue = [
    ...state.export.frameQueue,
    {
      id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileId: file.id,
      fileName: file.fileName,
      animationName: instance.currentAnimation,
      skinName: instance.currentSkin,
      elapsed: instance.elapsed,
      customName: spineDisplayName(file),
      canvasWidth: instance.exportCanvasMode === 'custom' ? (instance.exportCanvasSize?.width ?? 0) : 0,
      canvasHeight: instance.exportCanvasMode === 'custom' ? (instance.exportCanvasSize?.height ?? 0) : 0,
      // Same fixed reference box + anchor offset as the preview overlay for
      // this animation, so every frame in this queue crops around one shared
      // anchor instead of each frame re-centering on its own current pose.
      lockedBounds: { ...ensureCanvasAnchorBounds(instance) },
      anchorOffset: { ...getCanvasAnchorOffset(instance) },
    },
  ];
  updateSuccess(`Đã đăng ký frame ${formatSeconds(instance.elapsed)}s (${instance.currentAnimation}).`);
}

function setActiveCanvasSizeValue(axis, rawValue) {
  const instance = getActivePreviewInstance();
  if (!instance) {
    return;
  }

  const value = Number(rawValue);
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  instance.exportCanvasSize = { ...instance.exportCanvasSize, [axis]: normalized };
}

// The export canvas is the tight spine bounds, grown by twice the anchor
// offset so nudging the character (see computeCanvasBoxGeometry) can't push
// it past the canvas edge — matches renderSpinePoseToCanvas()'s sizing
// exactly, so this is the "auto" / minimum size on both the numeric fields
// and the live overlay.
function naturalExportSize(instance) {
  if (!instance?.spine) {
    return { width: 0, height: 0 };
  }

  const bounds = ensureCanvasAnchorBounds(instance);
  const anchor = getCanvasAnchorOffset(instance);
  return {
    width: Math.max(2, Math.round(bounds.width + Math.abs(anchor.x) * 2)),
    height: Math.max(2, Math.round(bounds.height + Math.abs(anchor.y) * 2)),
  };
}

function setCanvasMode(mode) {
  const instance = getActivePreviewInstance();
  if (!instance) {
    return;
  }

  const nextMode = mode === 'custom' ? 'custom' : 'auto';
  if (nextMode === 'custom') {
    const hasNoSize = !instance.exportCanvasSize.width && !instance.exportCanvasSize.height;
    if (hasNoSize) {
      // Start the box matching the character exactly, instead of collapsed to 0.
      instance.exportCanvasSize = naturalExportSize(instance);
    }
  } else {
    // Auto always tracks natural bounds — drop any leftover custom size so
    // the overlay/export don't keep aligning to the old custom box.
    instance.exportCanvasSize = { width: 0, height: 0 };
  }
  instance.exportCanvasMode = nextMode;
  render();
}

// Every animation gets one fixed reference box, captured from its first seen
// pose, cached on the instance keyed by animation name. This is what keeps
// the canvas from chasing the animated pose (default behavior now, no manual
// lock) and makes switching back to an animation reuse the same box.
function ensureCanvasAnchorBounds(instance) {
  const key = instance.currentAnimation || '';
  instance.canvasBoundsByAnim ??= {};
  if (!instance.canvasBoundsByAnim[key]) {
    const bounds = instance.spine.getLocalBounds();
    instance.canvasBoundsByAnim[key] = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }
  return instance.canvasBoundsByAnim[key];
}

// Per-animation pixel offset that nudges the canvas frame away from center
// (positive X/Y slides the frame right/down relative to the character).
function getCanvasAnchorOffset(instance) {
  const key = instance.currentAnimation || '';
  return instance.canvasAnchorByAnim?.[key] ?? { x: 0, y: 0 };
}

function setCanvasAnchorValue(axis, rawValue) {
  const instance = getActivePreviewInstance();
  if (!instance) {
    return;
  }

  const key = instance.currentAnimation || '';
  const value = Number(rawValue);
  const normalized = Number.isFinite(value) ? Math.round(value) : 0;
  instance.canvasAnchorByAnim ??= {};
  instance.canvasAnchorByAnim[key] = { ...getCanvasAnchorOffset(instance), [axis]: normalized };

  // A custom size frozen before this anchor change can be smaller than what's
  // now needed to keep the character from clipping — grow to fit. Never
  // shrinks a custom box the user intentionally made larger or smaller.
  if (instance.exportCanvasMode === 'custom') {
    const natural = naturalExportSize(instance);
    instance.exportCanvasSize = {
      width: Math.max(instance.exportCanvasSize.width, natural.width),
      height: Math.max(instance.exportCanvasSize.height, natural.height),
    };
  }
}

// Screen-space box geometry for the live overlay: box stays centered on the
// animation's fixed reference bounds (not the current animated pose, and not
// the anchor either — anchor moves the character, see below), sized in real
// export pixels drawn at the instance's current zoom.
function computeCanvasBoxGeometry(instance) {
  if (!instance?.spine) {
    return null;
  }

  const zoom = instance.zoom || 1;
  const natural = naturalExportSize(instance);
  const size = instance.exportCanvasSize ?? { width: 0, height: 0 };
  // 0/blank means auto (natural size); any explicit value is honored exactly,
  // including shrinking below natural — the box (and the real export) crops.
  const realWidth = size.width > 0 ? size.width : natural.width;
  const realHeight = size.height > 0 ? size.height : natural.height;
  const screenWidth = realWidth * zoom;
  const screenHeight = realHeight * zoom;

  const spine = instance.spine;
  const scaleX = spine.scale.x || 1;
  const scaleY = spine.scale.y || 1;
  const local = ensureCanvasAnchorBounds(instance);
  const anchor = getCanvasAnchorOffset(instance);

  // Anchor moves the artwork, not the box: nudge the real on-stage character
  // by the anchor delta (self-correcting here on every read, so it also
  // catches switching to a different animation's stored anchor — not just a
  // manual edit), then subtract that same nudge back out of the box's
  // center so the canvas frame stays put while the character shifts inside it.
  const prevAnchor = instance.appliedCanvasAnchor ?? { x: 0, y: 0 };
  if (anchor.x !== prevAnchor.x || anchor.y !== prevAnchor.y) {
    spine.position.x += (anchor.x - prevAnchor.x) * scaleX;
    spine.position.y += (anchor.y - prevAnchor.y) * scaleY;
    instance.appliedCanvasAnchor = anchor;
  }

  const centerX = spine.position.x - anchor.x * scaleX + (local.x + local.width / 2) * scaleX;
  const centerY = spine.position.y - anchor.y * scaleY + (local.y + local.height / 2) * scaleY;

  return {
    left: centerX - screenWidth / 2,
    top: centerY - screenHeight / 2,
    width: screenWidth,
    height: screenHeight,
    realWidth,
    realHeight,
  };
}

function canvasSizeWidthLabelText(geometry) {
  return `W ${Math.round(geometry.realWidth)}px`;
}

function canvasSizeHeightLabelText(geometry) {
  return `H ${Math.round(geometry.realHeight)}px`;
}

function syncCanvasSizeOverlay(instances) {
  const list = Array.isArray(instances) ? instances : [instances];
  for (const instance of list) {
    if (!instance?.spine) {
      continue;
    }

    const box = document.querySelector(`[data-canvas-size-box="${instance.id}"]`);
    const geometry = computeCanvasBoxGeometry(instance);
    if (!box || !geometry) {
      continue;
    }

    box.style.left = `${geometry.left}px`;
    box.style.top = `${geometry.top}px`;
    box.style.width = `${Math.max(1, geometry.width)}px`;
    box.style.height = `${Math.max(1, geometry.height)}px`;
    const widthLabel = box.querySelector('[data-canvas-size-label-width]');
    if (widthLabel) {
      widthLabel.textContent = canvasSizeWidthLabelText(geometry);
    }
    const heightLabel = box.querySelector('[data-canvas-size-label-height]');
    if (heightLabel) {
      heightLabel.textContent = canvasSizeHeightLabelText(geometry);
    }
  }
}

function removeFrameExport(frameId) {
  state.export.frameQueue = state.export.frameQueue.filter((item) => item.id !== frameId);
  render();
}

function registeredFramesOf(instance) {
  return instance
    ? state.export.frameQueue.filter((item) => item.fileId === instance.fileId)
    : [];
}

function openStageContextMenu(clientX, clientY, instanceId) {
  // Keep the menu inside the window; sizes are the CSS min-width / two-row height.
  state.contextMenu = {
    open: true,
    x: Math.max(8, Math.min(clientX, window.innerWidth - 216)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - 110)),
    instanceId,
  };
  render();
}

function closeStageContextMenu() {
  if (!state.contextMenu.open) {
    return;
  }
  state.contextMenu = { open: false, x: 0, y: 0, instanceId: '' };
  render();
}

function removeContextFrames() {
  const instance = getPreviewInstanceById(state.contextMenu.instanceId);
  const removed = registeredFramesOf(instance);
  if (!removed.length) {
    closeStageContextMenu();
    return;
  }

  state.export.frameQueue = state.export.frameQueue.filter((item) => item.fileId !== instance.fileId);
  state.contextMenu = { open: false, x: 0, y: 0, instanceId: '' };
  updateSuccess(`Đã bỏ ${removed.length} frame đã đăng ký của ${removed[0].fileName}.`);
}

function updateFrameExportName(frameId, value) {
  const item = state.export.frameQueue.find((entry) => entry.id === frameId);
  if (item) {
    item.customName = value;
  }
}

function clearFrameQueue() {
  state.export.frameQueue = [];
  render();
}

async function handleOpenExportFolder() {
  if (!state.export.lastOutputDir) {
    return;
  }

  const result = await window.spinePreview.openFolder(state.export.lastOutputDir);
  if (!result?.ok) {
    updateStatus(result?.error || 'Không thể mở folder export.');
  }
}

async function handleExportFrameQueue() {
  const items = state.export.frameQueue;
  if (!items.length) {
    updateStatus('Chưa có frame nào được đăng ký để export.');
    return;
  }

  const outputDir = state.export.outputDir.trim();
  if (!outputDir) {
    updateStatus('Chọn folder output trước khi export sprite frame.');
    return;
  }

  state.export.isExporting = true;
  state.export.lastSummary = '';
  updateStatus('');
  render();

  try {
    const rawNames = items.map((item) =>
      sanitizeForFileName(item.customName?.trim() || item.fileName || item.animationName),
    );
    const uniqueNames = dedupeFileNames(rawNames);
    const payloadFiles = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const file = getFileById(item.fileId);
      if (!file) {
        continue;
      }

      // Canvas size/bounds/anchor belong to the animation, not the moment it
      // was registered — if the spine is still loaded, use its current live
      // values (in case the anchor got tweaked after registering) instead of
      // the frozen snapshot. Falls back to the snapshot if it was removed.
      const instance = state.preview.instances.find((inst) => inst.fileId === item.fileId);
      const canvasSize = instance
        ? (instance.exportCanvasMode === 'custom' ? instance.exportCanvasSize : { width: 0, height: 0 })
        : { width: item.canvasWidth ?? 0, height: item.canvasHeight ?? 0 };
      const lockedBounds = instance?.canvasBoundsByAnim?.[item.animationName] ?? item.lockedBounds;
      const anchorOffset = instance?.canvasAnchorByAnim?.[item.animationName] ?? item.anchorOffset ?? { x: 0, y: 0 };

      const pngDataUrl = await captureSpriteFramePng(file, {
        skinName: item.skinName,
        animationName: item.animationName,
        elapsedTime: item.elapsed,
        canvasSize,
        lockedBounds,
        anchorOffset,
      });
      payloadFiles.push({ fileName: `${uniqueNames[index]}.png`, pngDataUrl });
    }

    const result = await window.spinePreview.saveBatchSpriteFrames({
      outputDir,
      files: payloadFiles,
    });

    if (!result?.ok) {
      updateStatus(result?.error || 'Không thể export sprite frame.');
      return;
    }

    state.export.frameQueue = [];
    state.export.lastOutputDir = outputDir;
    state.export.lastSummary = `✓ Đã xuất ${result.writtenFiles.length} file.`;
    updateSuccess(state.export.lastSummary);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : 'Không thể export sprite frame.');
  } finally {
    state.export.isExporting = false;
    render();
  }
}

function resetActivePreviewState() {
  state.preview.spine = null;
  state.preview.activeInstanceId = '';
  state.preview.paused = false;
  state.preview.loop = true;
  state.preview.currentAnimation = '';
  state.preview.currentSkin = '';
  state.preview.speed = 1;
  state.preview.elapsed = 0;
  state.preview.duration = 0;
  state.preview.zoom = 1;
  state.preview.sequence = [];
  state.preview.sequenceLoopLast = true;
  state.preview.sequenceRunning = false;
  state.preview.sequenceDurations = null;
  state.preview.sequenceStep = 0;
  state.preview.sequenceCleanup = null;
}

function syncPreviewStateFromInstance(instance) {
  if (!instance) {
    resetActivePreviewState();
    return;
  }

  state.preview.activeInstanceId = instance.id;
  state.preview.spine = instance.spine;
  state.preview.paused = instance.paused;
  state.preview.loop = instance.loop;
  state.preview.currentAnimation = instance.currentAnimation;
  state.preview.currentSkin = instance.currentSkin;
  state.preview.speed = instance.speed;
  state.preview.elapsed = instance.elapsed;
  state.preview.duration = instance.duration;
  state.preview.zoom = instance.zoom;
  state.preview.sequence = [...instance.sequence];
  state.preview.sequenceLoopLast = instance.sequenceLoopLast;
  state.preview.sequenceRunning = instance.sequenceRunning;
  state.preview.sequenceDurations = instance.sequenceDurations;
  state.preview.sequenceStep = instance.sequenceStep;
  state.preview.sequenceCleanup = instance.sequenceCleanup;
}

function applyInstanceTimeScale(instance) {
  if (!instance?.spine) {
    return;
  }

  instance.spine.state.timeScale = instance.paused ? 0 : instance.speed;
}

function setActivePreviewInstance(instanceId, options = {}) {
  const instance = getPreviewInstanceById(instanceId);
  if (!instance) {
    return;
  }

  if (options.bringToFront !== false) {
    state.preview.stage?.bringToFront(instance.spine);
  }

  syncPreviewStateFromInstance(instance);
  if (options.syncSourceSelection !== false) {
    const index = state.files.findIndex((file) => file.id === instance.fileId);
    if (index >= 0) {
      state.currentIndex = index;
    }
  }
}

function stopCurrentSound() {
  if (state.preview.soundAudio) {
    state.preview.soundAudio.pause();
    state.preview.soundAudio.currentTime = 0;
    state.preview.soundAudio = null;
  }
}

function resetPreviewSoundState() {
  stopCurrentSound();
  state.preview.playWithSound = false;
  state.preview.soundOffsetMs = 0;
  state.preview.selectedSoundId = '';
}

function hasReachedAnimationEnd() {
  return !state.preview.loop && state.preview.duration > 0 && state.preview.elapsed >= state.preview.duration;
}

function setSelectedSound(soundId) {
  if (!SOUND_FEATURE_ENABLED) {
    return;
  }

  state.preview.selectedSoundId = soundId;
  render();
}

function toggleExpandedPreview(forceValue) {
  state.preview.expanded = typeof forceValue === 'boolean' ? forceValue : !state.preview.expanded;
  render();

  if (state.preview.stage) {
    refreshPreviewLayout();
  }
}

function toggleAnimationList(forceValue) {
  state.preview.animationListOpen =
    typeof forceValue === 'boolean' ? forceValue : !state.preview.animationListOpen;
  render();
}

function toggleAnimationListPosition() {
  state.preview.animationListPos = state.preview.animationListPos === 'float' ? 'left' : 'float';
  localStorage.setItem('spine-preview-animlist-pos', state.preview.animationListPos);
  render();
}

function attachStageView() {
  if (!state.preview.stage) {
    return;
  }

  const selector = state.preview.expanded ? '[data-preview-modal-viewport]' : '[data-preview-viewport]';
  const viewport = document.querySelector(selector);
  const view = state.preview.stage.app.view;
  if (viewport) {
    state.preview.stage.setContainer(viewport);
  }

  if (viewport && view.parentElement !== viewport) {
    viewport.appendChild(view);
  }
}

function observePreviewViewport() {
  previewResizeObserver?.disconnect();

  if (!state.preview.stage) {
    return;
  }

  const selector = state.preview.expanded ? '[data-preview-modal-viewport]' : '[data-preview-viewport]';
  const viewport = document.querySelector(selector);
  if (!viewport) {
    return;
  }

  previewResizeObserver = new ResizeObserver(() => {
    schedulePreviewResize();
  });
  previewResizeObserver.observe(viewport);
}

function refreshPreviewLayout() {
  if (!state.preview.stage) {
    return;
  }

  attachStageView();
  state.preview.stage.syncViewportSize();
  state.preview.stage.renderOnce();
}

function schedulePreviewResize() {
  if (resizeFrameId) {
    window.cancelAnimationFrame(resizeFrameId);
  }

  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = 0;
    refreshPreviewLayout();
  });
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function currentStageThemeOptions() {
  return {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
  };
}

function commitFileSearch(value) {
  state.fileSearch = value;
  if (!maybeSelectFileFromSearch()) {
    render();
    return false;
  }

  return true;
}

async function handleSelectFolder() {
  const folder = await window.spinePreview.selectFolder();
  if (folder) {
    updateFolder(folder);
    updateStatus('');
    render();
  }
}

async function handleSelectSoundFolder() {
  if (!SOUND_FEATURE_ENABLED) {
    return;
  }

  const folder = await window.spinePreview.selectSoundFolder();
  if (folder) {
    updateSoundFolder(folder);
    updateStatus('');
    render();
  }
}

async function handleScanFolder() {
  if (!state.folderPath.trim()) {
    updateStatus('Chọn folder animation trước khi scan.');
    return;
  }

  state.scanning = true;
  state.files = [];
  state.currentIndex = -1;
  state.export.selectedFileIds = [];
  state.export.lastSummary = '';
  state.export.frameQueue = [];
  state.preview.instances = [];
  state.preview.activeInstanceId = '';
  updateStatus('');
  destroyPreview();
  render();

  try {
    const result = await window.spinePreview.scanFolder(state.folderPath.trim());
    if (result.error) {
      updateStatus(result.error);
      return;
    }

    state.files = result.files ?? [];
    state.fileSearch = '';
    state.currentIndex = state.files.length ? 0 : -1;
    state.export.outputDir = state.folderPath.trim();
    setExportSelection(state.files[0] ? [state.files[0].id] : []);
    if (!state.files.length) {
      updateStatus('Không tìm thấy Spine file hợp lệ. App hiện cần folder chứa file .json Spine và ít nhất một file .atlas có thể ghép cặp trong cùng thư mục.');
      return;
    }

    updateStatus('');
    render();
    await ensurePreviewStage();
    if (state.files[0]) {
      await addPreviewInstance(state.files[0].id);
    }
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : 'Không thể scan folder.');
  } finally {
    state.scanning = false;
    render();
  }
}

async function handleScanSoundFolder() {
  if (!SOUND_FEATURE_ENABLED) {
    return;
  }

  if (!state.soundFolderPath.trim()) {
    updateStatus('Chọn folder sound trước khi scan.');
    return;
  }

  state.soundScanning = true;
  render();

  try {
    const result = await window.spinePreview.scanSoundFolder(state.soundFolderPath.trim());
    if (result.error) {
      updateStatus(result.error);
      return;
    }

    state.soundFiles = result.files ?? [];
    if (!state.soundFiles.find((sound) => sound.id === state.preview.selectedSoundId)) {
      state.preview.selectedSoundId = '';
    }
    updateStatus('');
    render();
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : 'Không thể scan folder sound.');
  } finally {
    state.soundScanning = false;
    render();
  }
}

function setPreviewPlaybackMeta() {
  const instance = getActivePreviewInstance();
  if (!instance?.spine) {
    state.preview.currentAnimation = '';
    state.preview.duration = 0;
    state.preview.elapsed = 0;
    return;
  }

  const playback = SpineStage.currentPlayback(instance.spine);
  instance.currentAnimation = playback.name || instance.currentAnimation;

  if (instance.sequenceRunning && instance.sequenceDurations) {
    const before = instance.sequenceDurations.durations
      .slice(0, instance.sequenceStep)
      .reduce((sum, duration) => sum + duration, 0);
    instance.duration = instance.sequenceDurations.total;
    instance.elapsed = Math.min(before + playback.elapsed, instance.sequenceDurations.total);
  } else {
    instance.duration = playback.duration;
    instance.elapsed = playback.elapsed;
  }

  syncPreviewStateFromInstance(instance);
}

function clearActiveSequence() {
  const instance = getActivePreviewInstance();
  instance?.sequenceCleanup?.();
  if (instance) {
    instance.sequenceCleanup = null;
    instance.sequenceRunning = false;
    instance.sequenceDurations = null;
    instance.sequenceStep = 0;
  }
  state.preview.sequenceCleanup = null;
  state.preview.sequenceRunning = false;
  state.preview.sequenceDurations = null;
  state.preview.sequenceStep = 0;
}

async function ensurePreviewStage() {
  if (state.preview.stage) {
    attachStageView();
    state.preview.stage.syncViewportSize();
    return state.preview.stage;
  }

  const viewport = document.querySelector('[data-preview-viewport]');
  if (!viewport) {
    state.preview.error = 'Khong tao duoc preview viewport.';
    render();
    return null;
  }

  const stage = new SpineStage(viewport, currentStageThemeOptions());
  state.preview.stage = stage;
  stage.app.ticker.add(handleTicker);
  return stage;
}

function getDefaultAnimation(file) {
  if (!file?.animations?.length) {
    return '';
  }

  return (
    file.animations.find((name) =>
      ['idle', 'default', 'hover', 'hold', 'spin', 'loop'].includes(name.toLowerCase()),
    ) ?? file.animations[0]
  );
}

function getInitialInstanceCenter(instanceCount, point) {
  if (point) {
    return point;
  }

  const stage = state.preview.stage;
  const center = stage?.centerPoint() ?? { x: 360, y: 260 };
  const offset = Math.min(instanceCount, 6) * 28;
  return {
    x: center.x + offset,
    y: center.y + offset,
  };
}

async function addPreviewInstance(fileId, options = {}) {
  const file = getFileById(fileId);
  const stage = await ensurePreviewStage();
  if (!file || !stage) {
    return;
  }

  const requestId = state.previewRequestId + 1;
  state.previewRequestId = requestId;
  state.preview.isLoading = true;
  state.preview.error = '';
  render();

  const instance = createPreviewInstance(fileId);
  state.preview.instances = [...state.preview.instances, instance];

  try {
    const spine = await stage.loadSpine({
      jsonPath: file.jsonPath,
      atlasPath: file.atlasPath,
    });

    if (requestId !== state.previewRequestId) {
      stage.removeSpine(spine);
      state.preview.instances = state.preview.instances.filter((item) => item.id !== instance.id);
      return;
    }

    instance.spine = spine;

    if (file.skins.length) {
      instance.currentSkin = file.skins.includes('default') ? 'default' : file.skins[0];
      SpineStage.setSkin(spine, instance.currentSkin);
    }

    instance.currentAnimation = getDefaultAnimation(file);
    if (instance.currentAnimation) {
      SpineStage.playAnimation(spine, instance.currentAnimation, instance.loop);
      instance.duration = SpineStage.animationDuration(spine, instance.currentAnimation);
    }

    spine.update(0);
    await waitForNextFrame();
    stage.syncViewportSize();
    const center = getInitialInstanceCenter(state.preview.instances.length - 1, options.point);
    stage.centerSpineAt(spine, center.x, center.y);
    const mid = stage.centerPoint();
    instance.position = { x: center.x - mid.x, y: center.y - mid.y };
    instance.zoom = stage.setSpineScale(spine, 1);
    applyInstanceTimeScale(instance);
    setActivePreviewInstance(instance.id);
    stage.renderOnce();
  } catch (error) {
    state.preview.instances = state.preview.instances.filter((item) => item.id !== instance.id);
    if (requestId === state.previewRequestId) {
      state.preview.error = error instanceof Error ? error.message : 'Không thể load spine preview.';
    }
  } finally {
    if (requestId === state.previewRequestId) {
      state.preview.isLoading = false;
      render();
    }
  }
}

function removePreviewInstance(instanceId) {
  const instance = getPreviewInstanceById(instanceId);
  if (!instance) {
    return;
  }

  instance.sequenceCleanup?.();
  stopCurrentSound();
  state.preview.stage?.removeSpine(instance.spine);
  state.preview.instances = state.preview.instances.filter((item) => item.id !== instanceId);
  if (state.preview.activeInstanceId === instanceId) {
    const nextInstance = state.preview.instances[state.preview.instances.length - 1] ?? null;
    syncPreviewStateFromInstance(nextInstance);
  }
  state.preview.stage?.renderOnce();
  render();
}

function clearAllPreviewInstances() {
  if (!state.preview.instances.length) {
    return;
  }

  state.preview.instances.forEach((instance) => {
    instance.sequenceCleanup?.();
    state.preview.stage?.removeSpine(instance.spine);
  });

  stopCurrentSound();
  state.preview.instances = [];
  resetActivePreviewState();
  state.preview.stage?.renderOnce();
  render();
}

function handleTicker() {
  const activeInstance = getActivePreviewInstance();
  syncCanvasSizeOverlay(canvasOverlayInstances(activeInstance));

  if (!activeInstance?.spine) {
    return;
  }

  setPreviewPlaybackMeta();
  syncSpinePositionInputs();
  const currentAnimation = document.querySelector('[data-current-animation]');
  const elapsed = document.querySelector('[data-elapsed]');
  const progress = document.querySelector('[data-progress]');
  const playPauseButton = document.querySelector('[data-action="toggle-pause"]');
  const duration = state.preview.duration || 0;
  const ratio = duration > 0 ? Math.min(state.preview.elapsed / duration, 1) : 0;

  if (currentAnimation) {
    currentAnimation.textContent = state.preview.currentAnimation || 'None';
  }
  if (elapsed) {
    elapsed.textContent = `${formatSeconds(state.preview.elapsed)} / ${formatSeconds(duration)}s`;
  }
  if (progress instanceof HTMLInputElement) {
    progress.max = String(duration || 0);
    progress.step = String(FRAME_STEP);
    progress.value = String(snapToFrame(state.preview.elapsed));
  }
  if (playPauseButton instanceof HTMLButtonElement) {
    // Only rewrite the button when the play/pause state actually changes.
    // Replacing innerHTML every frame removes the element mid-click, which
    // swallows the click event and makes the button feel unresponsive.
    const isPlayState = state.preview.paused || hasReachedAnimationEnd();
    const nextState = isPlayState ? 'play' : 'pause';
    if (playPauseButton.dataset.iconState !== nextState) {
      playPauseButton.dataset.iconState = nextState;
      playPauseButton.innerHTML = playbackToggleIconMarkup();
      playPauseButton.setAttribute('aria-label', isPlayState ? 'Play' : 'Pause');
    }
  }
  const fill = document.querySelector('[data-progress-fill]');
  if (fill) {
    fill.setAttribute('style', `width:${ratio * 100}%`);
  }
}

function destroyPreview() {
  stopCurrentSound();
  state.preview.instances.forEach((instance) => instance.sequenceCleanup?.());
  if (state.preview.stage) {
    state.preview.stage.app.ticker.remove(handleTicker);
    state.preview.stage.destroy();
  }

  state.preview.stage = null;
  state.preview.isLoading = false;
  state.preview.error = '';
  state.preview.instances = [];
  resetActivePreviewState();
}

function handleAnimationChange(value) {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !value) {
    return;
  }

  stopCurrentSound();
  clearActiveSequence();
  instance.currentAnimation = value;
  instance.duration = SpineStage.animationDuration(instance.spine, value);
  instance.elapsed = 0;
  instance.paused = false;
  SpineStage.playAnimation(instance.spine, value, instance.loop);
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  state.preview.stage?.renderOnce();
  maybePlayCurrentSound();
  render();
}

function handleSkinChange(value) {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !value) {
    return;
  }

  instance.currentSkin = value;
  SpineStage.setSkin(instance.spine, value);
  if (instance.currentAnimation) {
    SpineStage.playAnimation(instance.spine, instance.currentAnimation, instance.loop);
  }
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  state.preview.stage?.renderOnce();
  render();
}

function togglePause() {
  const instance = getActivePreviewInstance();
  if (!instance?.spine) {
    return;
  }

  if (hasReachedAnimationEnd()) {
    restartAnimation();
    return;
  }

  const wasPaused = instance.paused;
  instance.paused = !instance.paused;
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  if (wasPaused && !instance.paused) {
    maybePlayCurrentSound();
  } else if (instance.paused) {
    stopCurrentSound();
  }
  state.preview.stage?.renderOnce();
  render();
}

function restartAnimation() {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !instance.currentAnimation) {
    return;
  }

  stopCurrentSound();
  SpineStage.playAnimation(instance.spine, instance.currentAnimation, instance.loop);
  instance.elapsed = 0;
  instance.paused = false;
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  state.preview.stage?.renderOnce();
  maybePlayCurrentSound();
  render();
}

function toggleLoop() {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !instance.currentAnimation) {
    state.preview.loop = !state.preview.loop;
    render();
    return;
  }

  clearActiveSequence();
  instance.loop = !instance.loop;
  SpineStage.playAnimation(instance.spine, instance.currentAnimation, instance.loop);
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  state.preview.stage?.renderOnce();
  render();
}

function maybePlayCurrentSound() {
  if (!SOUND_FEATURE_ENABLED) {
    return;
  }

  const soundFile = getCurrentSoundFile();
  if (!state.preview.playWithSound || !soundFile) {
    return;
  }

  stopCurrentSound();
  const audio = new Audio(toAssetUrl(soundFile.soundPath));
  audio.preload = 'auto';
  state.preview.soundAudio = audio;

  const delay = state.preview.soundOffsetMs;
  if (delay <= 0) {
    audio.play().catch(() => {
      state.preview.soundAudio = null;
    });
    return;
  }

  window.setTimeout(() => {
    if (state.preview.soundAudio !== audio) {
      return;
    }
    audio.play().catch(() => {
      state.preview.soundAudio = null;
    });
  }, delay);
}

function addToSequence(name) {
  const instance = getActivePreviewInstance();
  if (!instance || !name) {
    return;
  }

  instance.sequence = [...instance.sequence, name];
  syncPreviewStateFromInstance(instance);
  render();
}

function removeFromSequence(index) {
  const instance = getActivePreviewInstance();
  if (!instance) {
    return;
  }

  instance.sequence = instance.sequence.filter((_, itemIndex) => itemIndex !== index);
  syncPreviewStateFromInstance(instance);
  render();
}

function clearSequence() {
  const instance = getActivePreviewInstance();
  clearActiveSequence();
  if (!instance) {
    return;
  }

  instance.sequence = [];
  syncPreviewStateFromInstance(instance);
  render();
}

function playSequence() {
  const instance = getActivePreviewInstance();
  const spine = instance?.spine;
  if (!instance || !spine || !instance.sequence.length) {
    return;
  }

  stopCurrentSound();
  clearActiveSequence();
  const durations = instance.sequence.map((name) => SpineStage.animationDuration(spine, name));
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  instance.sequenceDurations = { durations, total };
  instance.sequenceStep = 0;
  instance.sequenceRunning = true;
  instance.sequenceCleanup = SpineStage.onComplete(spine, () => {
    instance.sequenceStep = Math.min(
      instance.sequenceStep + 1,
      instance.sequence.length - 1,
    );
  });
  SpineStage.playSequence(spine, instance.sequence, instance.sequenceLoopLast);
  instance.currentAnimation = instance.sequence[0];
  instance.elapsed = 0;
  instance.duration = total;
  instance.paused = false;
  applyInstanceTimeScale(instance);
  syncPreviewStateFromInstance(instance);
  state.preview.stage?.renderOnce();
  maybePlayCurrentSound();
  render();
}

function setSpeed(value) {
  const instance = getActivePreviewInstance();
  const speed = Number(value);
  state.preview.speed = speed;
  if (instance) {
    instance.speed = speed;
    applyInstanceTimeScale(instance);
  }
  const speedValue = document.querySelector('[data-speed-value]');
  if (speedValue) {
    speedValue.textContent = `${speed.toFixed(2)}x`;
  }
  state.preview.stage?.renderOnce();
}

function setSoundOffset(value) {
  if (!SOUND_FEATURE_ENABLED) {
    return;
  }

  state.preview.soundOffsetMs = Math.round(Number(value) * 1000);
  const soundOffsetValue = document.querySelector('[data-sound-offset-value]');
  if (soundOffsetValue) {
    soundOffsetValue.textContent = formatSoundOffset(state.preview.soundOffsetMs);
  }
}

function seekAnimation(value) {
  const instance = getActivePreviewInstance();
  if (!instance?.spine || !state.preview.stage) {
    return;
  }

  const localTime = snapToFrame(Number(value));
  SpineStage.seek(instance.spine, localTime);
  instance.elapsed = localTime;
  syncPreviewStateFromInstance(instance);
  state.preview.stage.renderOnce();
  handleTicker();
}

function zoomBy(factor) {
  const instance = getActivePreviewInstance();
  if (!state.preview.stage || !instance?.spine) {
    return;
  }

  instance.zoom = state.preview.stage.zoomSpineBy(instance.spine, factor);
  syncPreviewStateFromInstance(instance);
  state.preview.stage.renderOnce();
  document.querySelectorAll('[data-zoom-value]').forEach((zoomValue) => {
    zoomValue.textContent = `${Math.round(instance.zoom * 100)}%`;
  });
}

function resetZoom() {
  const instance = getActivePreviewInstance();
  if (!state.preview.stage || !instance?.spine) {
    return;
  }

  state.preview.stage.resetSpineTransform(instance.spine);
  instance.zoom = 1;
  instance.position = { x: 0, y: 0 };
  syncPreviewStateFromInstance(instance);
  state.preview.stage.renderOnce();
  document.querySelectorAll('[data-zoom-value]').forEach((zoomValue) => {
    zoomValue.textContent = '100%';
  });
}

// Stage position of a spine, tracked as an offset from the viewport center so
// 0,0 always reads as "centered". Tracked on the instance rather than derived
// from the spine bounds, which drift with the animated pose every frame.
function getActiveSpinePosition() {
  return getActivePreviewInstance()?.position ?? { x: 0, y: 0 };
}

function moveActiveSpineTo(x, y) {
  const instance = getActivePreviewInstance();
  if (!state.preview.stage || !instance?.spine) {
    return;
  }

  state.preview.stage.moveSpineBy(instance.spine, x - instance.position.x, y - instance.position.y);
  instance.position = { x, y };
  state.preview.stage.renderOnce();
}

function setActiveSpinePosition(axis, rawValue) {
  const value = Number.parseFloat(rawValue);
  const next = { ...getActiveSpinePosition(), [axis]: Number.isFinite(value) ? value : 0 };
  moveActiveSpineTo(next.x, next.y);
}

function resetActiveSpinePosition() {
  moveActiveSpineTo(0, 0);
  syncSpinePositionInputs();
}

function syncSpinePositionInputs() {
  const position = getActiveSpinePosition();
  document.querySelectorAll('[data-spine-position-input]').forEach((input) => {
    // Never fight the field the user is currently typing into.
    if (!(input instanceof HTMLInputElement) || input === document.activeElement) {
      return;
    }
    input.value = String(Math.round(position[input.dataset.spinePositionInput] ?? 0));
  });
}

function bindPanEvents() {
  const drag = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    moved: false,
    target: null,
    instanceId: '',
  };

  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const surface = event.target.closest('[data-preview-viewport], [data-preview-modal-viewport]');
    if (!surface || !state.preview.stage || state.preview.isLoading) {
      return;
    }

    const hitSpine = state.preview.stage.hitTest(event.clientX, event.clientY);
    const instance = getPreviewInstanceBySpine(hitSpine);
    if (!instance) {
      return;
    }

    setActivePreviewInstance(instance.id);
    render();

    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved = false;
    drag.target = surface;
    drag.instanceId = instance.id;
    surface.classList.add('is-panning');
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId || !state.preview.stage) {
      return;
    }

    const instance = getPreviewInstanceById(drag.instanceId);
    if (!instance?.spine) {
      return;
    }

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 2) {
      return;
    }

    drag.moved = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    state.preview.stage.moveSpineBy(instance.spine, deltaX, deltaY);
    instance.position = { x: instance.position.x + deltaX, y: instance.position.y + deltaY };
    state.preview.stage.renderOnce();
  });

  const endPan = (event) => {
    if (!drag.active || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
      return;
    }
    drag.active = false;
    drag.pointerId = null;
    drag.target?.classList.remove('is-panning');
    drag.target = null;
    drag.instanceId = '';
  };

  window.addEventListener('pointerup', endPan);
  window.addEventListener('pointercancel', endPan);
}

function bindAnimationOverlayDragEvents() {
  const drag = { active: false, pointerId: null, node: null, offsetX: 0, offsetY: 0 };

  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state.preview.animationListPos !== 'float') {
      return;
    }
    // The position toggle lives in the drag strip; let it click through.
    if (!event.target.closest('[data-animation-overlay-drag]') || event.target.closest('button')) {
      return;
    }

    const node = event.target.closest('[data-animation-overlay]');
    const parent = node?.offsetParent;
    if (!node || !parent) {
      return;
    }

    event.preventDefault();
    const box = node.getBoundingClientRect();
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.node = node;
    drag.offsetX = event.clientX - box.left;
    drag.offsetY = event.clientY - box.top;
    node.classList.add('is-dragging');
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return;
    }

    const parent = drag.node.offsetParent;
    const parentBox = parent.getBoundingClientRect();
    const x = clampOverlayCoord(event.clientX - drag.offsetX - parentBox.left, parentBox.width - drag.node.offsetWidth);
    const y = clampOverlayCoord(event.clientY - drag.offsetY - parentBox.top, parentBox.height - drag.node.offsetHeight);
    state.preview.animationListXY = { x, y };
    drag.node.style.left = `${x}px`;
    drag.node.style.top = `${y}px`;
    drag.node.style.bottom = 'auto';
  });

  const endDrag = (event) => {
    if (!drag.active || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
      return;
    }
    drag.active = false;
    drag.pointerId = null;
    drag.node.classList.remove('is-dragging');
    drag.node = null;
    localStorage.setItem('spine-preview-animlist-xy', JSON.stringify(state.preview.animationListXY));
  };

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function readStoredAnimationListXY() {
  try {
    const parsed = JSON.parse(localStorage.getItem('spine-preview-animlist-xy') ?? 'null');
    return Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

function clampOverlayCoord(value, max) {
  return Math.round(Math.max(0, Math.min(value, Math.max(0, max))));
}

function bindCanvasSizeOverlayEvents() {
  const drag = {
    active: false,
    pointerId: null,
    instanceId: '',
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    zoom: 1,
  };

  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const handle = event.target.closest('[data-canvas-size-handle]');
    const instance = getActivePreviewInstance();
    if (!handle || !instance?.spine || instance.exportCanvasMode !== 'custom') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const natural = naturalExportSize(instance);
    const size = instance.exportCanvasSize ?? { width: 0, height: 0 };
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.instanceId = instance.id;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.startWidth = size.width > 0 ? size.width : natural.width;
    drag.startHeight = size.height > 0 ? size.height : natural.height;
    drag.zoom = instance.zoom || 1;
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return;
    }

    const instance = getPreviewInstanceById(drag.instanceId);
    if (!instance || instance.exportCanvasMode !== 'custom') {
      return;
    }

    // Box stays centered on the character, so dragging a corner by dx grows
    // both sides — total width grows by 2 * dx (converted from screen to
    // real export pixels via the current zoom level). Only a 1px floor —
    // dragging below the natural size crops, that's an intentional option.
    const dx = (event.clientX - drag.startX) / drag.zoom;
    const dy = (event.clientY - drag.startY) / drag.zoom;
    const width = Math.max(1, Math.round(drag.startWidth + dx * 2));
    const height = Math.max(1, Math.round(drag.startHeight + dy * 2));
    instance.exportCanvasSize = { width, height };

    syncCanvasSizeOverlay(instance);
    const widthInput = document.querySelector('[data-canvas-width-input]');
    const heightInput = document.querySelector('[data-canvas-height-input]');
    if (widthInput) widthInput.value = String(width);
    if (heightInput) heightInput.value = String(height);
  });

  const endResize = (event) => {
    if (!drag.active || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
      return;
    }
    drag.active = false;
    drag.pointerId = null;
    drag.instanceId = '';
  };

  window.addEventListener('pointerup', endResize);
  window.addEventListener('pointercancel', endResize);
}

function bindEvents() {
  bindPanEvents();
  bindCanvasSizeOverlayEvents();
  bindAnimationOverlayDragEvents();

  app.addEventListener('contextmenu', (event) => {
    // The open menu's backdrop covers the stage, so a second right-click lands
    // on it — treat that as "dismiss" instead of falling through to the OS menu.
    if (state.contextMenu.open) {
      event.preventDefault();
      closeStageContextMenu();
      return;
    }

    const surface = event.target.closest('[data-preview-viewport], [data-preview-modal-viewport]');
    if (!surface || !state.preview.stage || state.preview.isLoading) {
      return;
    }

    event.preventDefault();
    const instance = getPreviewInstanceBySpine(state.preview.stage.hitTest(event.clientX, event.clientY));
    if (!instance) {
      closeStageContextMenu();
      return;
    }

    setActivePreviewInstance(instance.id);
    openStageContextMenu(event.clientX, event.clientY, instance.id);
  });

  app.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) {
      return;
    }

    if (action === 'select-folder') {
      await handleSelectFolder();
    } else if (EXPORT_FEATURE_ENABLED && action === 'open-export-workspace') {
      syncDefaultExportOutputDir();
      setUiMode('export');
    } else if (EXPORT_FEATURE_ENABLED && action === 'back-to-preview') {
      setUiMode('preview');
    } else if (action === 'select-export-folder') {
      await handleSelectExportFolder();
    } else if (EXPORT_FEATURE_ENABLED && action === 'export-png-batch') {
      await handleBatchExportPng();
    } else if (SOUND_FEATURE_ENABLED && action === 'select-sound-folder') {
      await handleSelectSoundFolder();
    } else if (action === 'scan-folder') {
      await handleScanFolder();
    } else if (SOUND_FEATURE_ENABLED && action === 'scan-sound-folder') {
      await handleScanSoundFolder();
    } else if (action === 'toggle-animation-list') {
      toggleAnimationList();
    } else if (action === 'toggle-animation-list-position') {
      toggleAnimationListPosition();
    } else if (action === 'select-animation-item') {
      const animationName = event.target.closest('[data-animation-name]')?.dataset.animationName ?? '';
      handleAnimationChange(animationName);
    } else if (action === 'toggle-pause') {
      togglePause();
    } else if (action === 'restart-animation') {
      restartAnimation();
    } else if (action === 'toggle-loop') {
      toggleLoop();
    } else if (action === 'reset-spine-position') {
      resetActiveSpinePosition();
    } else if (action === 'zoom-in') {
      zoomBy(ZOOM_STEP);
    } else if (action === 'zoom-out') {
      zoomBy(1 / ZOOM_STEP);
    } else if (action === 'zoom-reset') {
      resetZoom();
    } else if (action === 'set-background') {
      const background = event.target.closest('[data-background]')?.dataset.background;
      if (background) {
        setBackground(background);
      }
    } else if (action === 'play-sequence') {
      playSequence();
    } else if (action === 'clear-sequence') {
      clearSequence();
    } else if (action === 'toggle-theme') {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    } else if (action === 'toggle-expanded-preview') {
      toggleExpandedPreview();
    } else if (action === 'close-expanded-preview') {
      toggleExpandedPreview(false);
    } else if (action === 'add-sequence-current') {
      addToSequence(state.preview.currentAnimation);
    } else if (action === 'remove-sequence-item') {
      removeFromSequence(Number(event.target.closest('[data-sequence-index]')?.dataset.sequenceIndex));
    } else if (action === 'select-file-chip') {
      const fileId = event.target.closest('[data-file-id]')?.dataset.fileId ?? '';
      if (fileId) {
        setCurrentFileById(fileId);
        if (!getActivePreviewInstance()) {
          await addPreviewInstance(fileId);
        }
      }
    } else if (EXPORT_FEATURE_ENABLED && action === 'toggle-export-file') {
      const fileId = event.target.closest('[data-file-id]')?.dataset.fileId ?? '';
      if (fileId) {
        toggleExportFileSelection(fileId);
        render();
      }
    } else if (EXPORT_FEATURE_ENABLED && action === 'select-all-export-files') {
      setExportSelection(state.files.map((file) => file.id));
      render();
    } else if (EXPORT_FEATURE_ENABLED && action === 'clear-export-files') {
      setExportSelection([]);
      render();
    } else if (action === 'remove-preview-instance') {
      const instanceId = event.target.closest('[data-preview-instance-id]')?.dataset.previewInstanceId ?? '';
      if (instanceId) {
        removePreviewInstance(instanceId);
      }
    } else if (action === 'clear-all-preview-instances') {
      clearAllPreviewInstances();
    } else if (action === 'focus-preview-instance') {
      const instanceId = event.target.closest('[data-preview-instance-id]')?.dataset.previewInstanceId ?? '';
      if (instanceId) {
        setActivePreviewInstance(instanceId);
        render();
      }
    } else if (action === 'set-control-tab') {
      state.controlTab = event.target.closest('[data-control-tab]')?.dataset.controlTab ?? 'playback';
      render();
    } else if (action === 'close-context-menu') {
      closeStageContextMenu();
    } else if (action === 'context-register-frame') {
      state.contextMenu = { open: false, x: 0, y: 0, instanceId: '' };
      registerFrameExport();
    } else if (action === 'context-remove-frames') {
      removeContextFrames();
    } else if (action === 'set-canvas-mode') {
      const mode = event.target.closest('[data-canvas-mode]')?.dataset.canvasMode ?? 'auto';
      setCanvasMode(mode);
    } else if (action === 'register-frame-export') {
      registerFrameExport();
    } else if (action === 'remove-frame-export') {
      const frameId = event.target.closest('[data-frame-export-id]')?.dataset.frameExportId ?? '';
      if (frameId) {
        removeFrameExport(frameId);
      }
    } else if (action === 'clear-frame-queue') {
      clearFrameQueue();
    } else if (action === 'export-frame-queue') {
      await handleExportFrameQueue();
    } else if (action === 'open-export-folder') {
      await handleOpenExportFolder();
    }
  });

  app.addEventListener('dragstart', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const chip = event.target.closest('[data-file-id].spine-chip');
    if (!(chip instanceof HTMLElement) || !event.dataTransfer) {
      return;
    }

    const fileId = chip.dataset.fileId ?? '';
    if (!fileId) {
      return;
    }

    state.draggingFileId = fileId;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', fileId);
    app.classList.add('is-dragging-spine');
  });

  app.addEventListener('dragend', () => {
    state.draggingFileId = '';
    app.classList.remove('is-dragging-spine');
    document.querySelectorAll('[data-preview-dropzone]').forEach((node) => {
      node.classList.remove('is-drop-target');
    });
  });

  app.addEventListener('dragover', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const dropzone = event.target.closest('[data-preview-dropzone]');
    if (!dropzone || !state.draggingFileId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-drop-target');
  });

  app.addEventListener('dragleave', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const dropzone = event.target.closest('[data-preview-dropzone]');
    if (!dropzone) {
      return;
    }

    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove('is-drop-target');
    }
  });

  app.addEventListener('drop', async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const dropzone = event.target.closest('[data-preview-dropzone]');
    if (!dropzone) {
      return;
    }

    event.preventDefault();
    dropzone.classList.remove('is-drop-target');
    app.classList.remove('is-dragging-spine');
    const fileId = event.dataTransfer?.getData('text/plain') || state.draggingFileId;
    state.draggingFileId = '';
    if (fileId) {
      const point = state.preview.stage?.clientToCanvasPoint(event.clientX, event.clientY);
      await addPreviewInstance(fileId, { point });
    }
  });

  app.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-folder-input]')) {
      updateFolder(target.value);
    } else if (target.matches('[data-file-search]')) {
      state.fileSearch = target.value;
      maybeSelectFileFromSearch();
    } else if (target.matches('[data-export-anchor-x]')) {
      state.export.anchorX = target.value;
    } else if (target.matches('[data-export-anchor-y]')) {
      state.export.anchorY = target.value;
    } else if (target.matches('[data-canvas-width-input]')) {
      setActiveCanvasSizeValue('width', target.value);
    } else if (target.matches('[data-canvas-height-input]')) {
      setActiveCanvasSizeValue('height', target.value);
    } else if (target.matches('[data-canvas-anchor-x-input]')) {
      setCanvasAnchorValue('x', target.value);
    } else if (target.matches('[data-canvas-anchor-y-input]')) {
      setCanvasAnchorValue('y', target.value);
    } else if (target.matches('[data-spine-position-input]')) {
      setActiveSpinePosition(target.dataset.spinePositionInput, target.value);
    } else if (target.matches('[data-frame-name-input]')) {
      const frameId = target.closest('[data-frame-export-id]')?.dataset.frameExportId ?? '';
      if (frameId) {
        updateFrameExportName(frameId, target.value);
      }
    } else if (target.matches('[data-export-folder-input]')) {
      state.export.outputDir = target.value;
    } else if (target.matches('[data-speed-range]')) {
      setSpeed(target.value);
    } else if (SOUND_FEATURE_ENABLED && target.matches('[data-sound-offset-range]')) {
      setSoundOffset(target.value);
    } else if (target.matches('[data-background-custom]')) {
      setBackgroundLive(target.value);
    } else if (target.matches('[data-progress]')) {
      seekAnimation(target.value);
    } else if (target.matches('[data-sequence-loop-last]')) {
      state.preview.sequenceLoopLast = target.checked;
      const instance = getActivePreviewInstance();
      if (instance) {
        instance.sequenceLoopLast = target.checked;
      }
      render();
    } else if (SOUND_FEATURE_ENABLED && target.matches('[data-play-with-sound]')) {
      state.preview.playWithSound = target.checked;
      render();
    }
  });

  app.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-file-search]')) {
      commitFileSearch(target.value);
    } else if (target.matches('[data-animation-select]')) {
      handleAnimationChange(target.value);
    } else if (target.matches('[data-skin-select]')) {
      handleSkinChange(target.value);
    } else if (SOUND_FEATURE_ENABLED && target.matches('[data-sound-select]')) {
      setSelectedSound(target.value);
    } else if (target.matches('[data-canvas-width-input], [data-canvas-height-input], [data-canvas-anchor-x-input], [data-canvas-anchor-y-input]')) {
      render();
    }
  });

  app.addEventListener('blur', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches('[data-file-search]')) {
      commitFileSearch(target.value);
    }
  }, true);

  app.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (!target.matches('[data-file-search]')) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitFileSearch(target.value);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.contextMenu.open) {
      event.preventDefault();
      closeStageContextMenu();
      return;
    }

    if (event.key === 'Escape' && state.preview.expanded) {
      event.preventDefault();
      toggleExpandedPreview(false);
      return;
    }

    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      restartAnimation();
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      toggleLoop();
    }
  });
}

function backgroundPickerMarkup() {
  const isCustom = !BACKGROUND_PRESETS.some((preset) => preset.id === state.background);
  const customColor = isCustom ? state.background : '#101418';
  const swatches = BACKGROUND_PRESETS.map((preset) => {
    const active = state.background === preset.id ? 'active' : '';
    return `
      <button
        type="button"
        class="bg-swatch ${active}"
        data-action="set-background"
        data-background="${escapeHtml(preset.id)}"
        aria-label="${escapeHtml(preset.label)}"
        style="--swatch:${preset.swatch}"
      ></button>
    `;
  }).join('');

  return `
    <div class="bg-controls">
      <span>Background</span>
      <div class="bg-swatch-row">
        ${swatches}
        <label class="bg-swatch bg-swatch-custom ${isCustom ? 'active' : ''}" style="--swatch:${escapeHtml(customColor)}">
          <input type="color" data-background-custom value="${escapeHtml(customColor)}">
        </label>
      </div>
    </div>
  `;
}

// isActive controls the drag handle only — background boxes (kept visible
// because that spine already has a registered frame) are just a passive
// reminder of where their canvas sits, not interactively resizable.
function animationOverlayMarkup(activeFile) {
  if (!activeFile) {
    return '';
  }

  const items = activeFile.animations
    .map((name) => {
      const duration = state.preview.spine ? SpineStage.animationDuration(state.preview.spine, name) : 0;
      return `
        <button
          class="animation-list-item ${name === state.preview.currentAnimation ? 'active' : ''}"
          data-action="select-animation-item"
          data-animation-name="${escapeHtml(name)}"
          type="button"
        >
          <span>${escapeHtml(name)}</span>
          <strong>${formatAnimationDuration(duration)}</strong>
        </button>
      `;
    })
    .join('');

  const isFloat = state.preview.animationListPos === 'float';
  const xy = state.preview.animationListXY;
  // Float keeps its dragged spot via inline left/top; bottom must yield to it.
  const style = isFloat && xy ? `style="left:${xy.x}px;top:${xy.y}px;bottom:auto;"` : '';

  return `
    <div
      class="animation-overlay animation-overlay-${isFloat ? 'float' : 'left'} ${state.preview.animationListOpen ? 'open' : ''}"
      data-animation-overlay
      ${style}
    >
      <button
        class="animation-overlay-toggle"
        data-action="toggle-animation-list"
        type="button"
        aria-expanded="${state.preview.animationListOpen ? 'true' : 'false'}"
      >
        <span>Anim List</span>
        <strong>${activeFile.animations.length}</strong>
      </button>
      <div class="animation-overlay-panel">
        <div class="animation-overlay-head" data-animation-overlay-drag>
          <span>Animations</span>
          <button
            class="animation-overlay-pos-btn"
            data-action="toggle-animation-list-position"
            type="button"
            title="${isFloat ? 'Dock sang bên trái' : 'Chuyển thành popup nổi (kéo được)'}"
          >
            ${isFloat ? 'Dock left' : 'Float'}
          </button>
        </div>
        <div class="animation-overlay-list">
          ${items || '<p class="animation-list-empty">Chưa có animation.</p>'}
        </div>
      </div>
    </div>
  `;
}

function canvasSizeOverlayMarkup(instance, isActive) {
  const geometry = computeCanvasBoxGeometry(instance);
  if (!geometry) {
    return '';
  }

  const isCustom = instance.exportCanvasMode === 'custom';

  return `
    <div
      class="canvas-size-box ${isActive ? '' : 'canvas-size-box-inactive'}"
      data-canvas-size-box="${escapeHtml(instance.id)}"
      style="left:${geometry.left}px;top:${geometry.top}px;width:${Math.max(1, geometry.width)}px;height:${Math.max(1, geometry.height)}px;"
    >
      <span class="canvas-size-label canvas-size-label-width" data-canvas-size-label-width>${canvasSizeWidthLabelText(geometry)}</span>
      <span class="canvas-size-label canvas-size-label-height" data-canvas-size-label-height>${canvasSizeHeightLabelText(geometry)}</span>
      ${isActive && isCustom ? '<div class="canvas-size-handle" data-canvas-size-handle title="Kéo để chỉnh kích thước canvas"></div>' : ''}
    </div>
  `;
}

// A spine keeps showing its canvas box once it has a registered frame in the
// export queue, even after focus moves to a different spine on the stage.
function hasRegisteredFrame(instance) {
  return registeredFramesOf(instance).length > 0;
}

function canvasOverlayInstances(activeInstance) {
  return state.preview.instances.filter((instance) => (
    instance.spine && (instance.id === activeInstance?.id || hasRegisteredFrame(instance))
  ));
}

function frameExportPanelMarkup() {
  const queue = state.export.frameQueue;
  const canRegister = canRegisterFrame();
  const activeInstance = getActivePreviewInstance();
  const activeCanvasSize = activeInstance?.exportCanvasSize ?? { width: 0, height: 0 };
  const activeCanvasMode = activeInstance?.exportCanvasMode ?? 'auto';
  const isCustomMode = activeCanvasMode === 'custom';
  const activeCanvasAnchor = activeInstance ? getCanvasAnchorOffset(activeInstance) : { x: 0, y: 0 };
  const items = queue
    .map(
      (item) => `
        <div class="sequence-item frame-export-item">
          <input
            class="frame-export-name-input"
            type="text"
            data-frame-name-input
            data-frame-export-id="${escapeHtml(item.id)}"
            value="${escapeHtml(item.customName ?? item.fileName)}"
            placeholder="${escapeHtml(item.fileName)}"
          />
          <span class="frame-export-meta">${escapeHtml(item.animationName)} @ ${formatSeconds(item.elapsed)}s</span>
          <button
            class="sequence-remove"
            data-action="remove-frame-export"
            data-frame-export-id="${escapeHtml(item.id)}"
            type="button"
            aria-label="Remove registered frame"
          >
            <svg class="icon-svg" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      `,
    )
    .join('');

  return `
    <div class="sequence-panel">
      <div class="sequence-header">
        <span>Canvas</span>
        <span>${queue.length} registered</span>
      </div>
      <div class="canvas-mode-toggle">
        <button
          type="button"
          class="secondary-btn control-btn ${!isCustomMode ? 'active' : ''}"
          data-action="set-canvas-mode"
          data-canvas-mode="auto"
          ${activeInstance ? '' : 'disabled'}
        >Auto</button>
        <button
          type="button"
          class="secondary-btn control-btn ${isCustomMode ? 'active' : ''}"
          data-action="set-canvas-mode"
          data-canvas-mode="custom"
          ${activeInstance ? '' : 'disabled'}
        >Custom</button>
      </div>
      <div class="anchor-fields">
        <label class="field anchor-field">
          <span>Canvas Width (px)</span>
          <input
            type="number"
            min="0"
            step="1"
            data-canvas-width-input
            placeholder="auto"
            value="${activeCanvasSize.width || ''}"
            ${isCustomMode ? '' : 'disabled'}
          />
        </label>
        <label class="field anchor-field">
          <span>Canvas Height (px)</span>
          <input
            type="number"
            min="0"
            step="1"
            data-canvas-height-input
            placeholder="auto"
            value="${activeCanvasSize.height || ''}"
            ${isCustomMode ? '' : 'disabled'}
          />
        </label>
      </div>
      <div class="anchor-fields">
        <label class="field anchor-field">
          <span>Anchor X (px)</span>
          <input
            type="number"
            step="1"
            data-canvas-anchor-x-input
            placeholder="0"
            value="${activeCanvasAnchor.x || ''}"
            ${activeInstance ? '' : 'disabled'}
            title="Dịch canvas theo tâm hiện tại của animation này"
          />
        </label>
        <label class="field anchor-field">
          <span>Anchor Y (px)</span>
          <input
            type="number"
            step="1"
            data-canvas-anchor-y-input
            placeholder="0"
            value="${activeCanvasAnchor.y || ''}"
            ${activeInstance ? '' : 'disabled'}
            title="Dịch canvas theo tâm hiện tại của animation này"
          />
        </label>
      </div>
      ${isCustomMode ? '<p class="canvas-size-hint">Kéo chấm ở góc khung đen trên khung preview để chỉnh trực tiếp.</p>' : ''}
      <div class="button-row">
        <button
          class="secondary-btn control-btn"
          data-action="register-frame-export"
          ${canRegister ? '' : 'disabled'}
          title="${canRegister ? 'Đăng ký frame hiện tại' : 'Pause animation ở frame hợp lệ trước'}"
        >Register Frame</button>
        <button
          class="secondary-btn control-btn sequence-play-btn"
          data-action="export-frame-queue"
          ${queue.length && !state.export.isExporting ? '' : 'disabled'}
        >${state.export.isExporting ? 'Exporting...' : 'Export Frames (PNG)'}</button>
        <button class="secondary-btn control-btn" data-action="clear-frame-queue" ${queue.length ? '' : 'disabled'}>Clear</button>
      </div>
      <div class="folder-row source-row export-row">
        <input
          data-export-folder-input
          class="folder-input"
          type="text"
          placeholder="/path/to/output-folder"
          value="${escapeHtml(state.export.outputDir)}"
        />
        <button class="primary-btn" data-action="select-export-folder">Browse</button>
      </div>
      <div class="sequence-list">
        ${items || '<p class="sequence-empty">Chưa có frame nào được đăng ký.</p>'}
      </div>
      ${state.export.lastSummary
        ? `
          <div class="frame-export-summary">
            <span>${escapeHtml(state.export.lastSummary)}</span>
            <button class="secondary-btn control-btn" type="button" data-action="open-export-folder">Open Folder</button>
          </div>
        `
        : ''}
    </div>
  `;
}

function previewPanelMarkup() {
  const activeInstance = getActivePreviewInstance();
  const activeFile = getPreviewFile(activeInstance);
  const hasFiles = Boolean(activeInstance && activeFile);
  const instanceCounts = new Map();
  const previewStackMarkup = state.preview.instances
    .map((instance) => {
      const file = getPreviewFile(instance);
      if (!file) {
        return '';
      }

      const nextCount = (instanceCounts.get(file.id) ?? 0) + 1;
      instanceCounts.set(file.id, nextCount);
      const label = `${spineDisplayName(file)}${nextCount > 1 ? ` #${nextCount}` : ''}`;
      const isActive = instance.id === activeInstance?.id;

      return `
        <div class="preview-stack-chip ${isActive ? 'active' : ''}" data-preview-instance-id="${escapeHtml(instance.id)}">
          <button
            type="button"
            class="preview-stack-name"
            data-action="focus-preview-instance"
          >
            ${escapeHtml(label)}
          </button>
          ${isActive
            ? '<span class="preview-stack-badge">Active</span>'
            : `
              <button
                type="button"
                class="preview-stack-remove"
                data-action="remove-preview-instance"
                aria-label="Remove ${escapeHtml(label)}"
              >
                <svg class="icon-svg" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            `}
        </div>
      `;
    })
    .join('');
  const currentSound = SOUND_FEATURE_ENABLED ? getCurrentSoundFile() : null;
  const previewError = state.preview.error
    ? `<div class="panel-error">${escapeHtml(state.preview.error)}</div>`
    : '';
  const optionsAnimation = activeFile
    ? activeFile.animations
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}" ${name === state.preview.currentAnimation ? 'selected' : ''}>${escapeHtml(name)}</option>`,
        )
        .join('')
    : '';
  const optionsSkin = activeFile
    ? activeFile.skins
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}" ${name === state.preview.currentSkin ? 'selected' : ''}>${escapeHtml(name)}</option>`,
        )
        .join('')
    : '';
  const optionsSound = SOUND_FEATURE_ENABLED
    ? state.soundFiles
        .map(
          (sound) =>
            `<option value="${escapeHtml(sound.id)}" ${sound.id === currentSound?.id ? 'selected' : ''}>${escapeHtml(sound.relativeName)}</option>`,
        )
        .join('')
    : '';
  const sequenceItems = state.preview.sequence
    .map(
      (name, index) => `
        <div class="sequence-item">
          <span>${escapeHtml(name)}</span>
          <button
            class="sequence-remove"
            data-action="remove-sequence-item"
            data-sequence-index="${index}"
            type="button"
            aria-label="Remove sequence item"
          >
            <svg class="icon-svg" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      `,
    )
    .join('');
  const animationOverlay = hasFiles ? animationOverlayMarkup(activeFile) : '';
  const spinePosition = getActiveSpinePosition();
  const spinePositionX = Math.round(spinePosition.x);
  const spinePositionY = Math.round(spinePosition.y);
  const controlsMarkup = hasFiles
    ? `
        <div class="button-row">
          <button
            class="secondary-btn control-btn playback-icon-btn"
            data-action="toggle-pause"
            ${hasFiles ? '' : 'disabled'}
            aria-label="${state.preview.paused || hasReachedAnimationEnd() ? 'Play' : 'Pause'}"
          >
            ${playbackToggleIconMarkup()}
          </button>
          <button
            class="secondary-btn control-btn playback-icon-btn"
            data-action="restart-animation"
            ${hasFiles ? '' : 'disabled'}
            aria-label="Restart"
          >
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5.5 12a6.5 6.5 0 1 1 1.9 4.6" />
              <path d="M5 7.5V12h4.5" />
            </svg>
          </button>
          <button
            class="secondary-btn control-btn playback-icon-btn ${state.preview.loop ? 'active' : ''}"
            data-action="toggle-loop"
            ${hasFiles ? '' : 'disabled'}
            aria-label="Loop"
          >
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9a4 4 0 0 1 4-4h11" />
              <path d="M16 2l3 3-3 3" />
              <path d="M20 15a4 4 0 0 1-4 4H5" />
              <path d="M8 22l-3-3 3-3" />
            </svg>
          </button>
        </div>

        <label class="field">
          <span>Animation</span>
          <select data-animation-select ${hasFiles ? '' : 'disabled'}>${optionsAnimation}</select>
        </label>

        <label class="field">
          <span>Skin</span>
          <select data-skin-select ${hasFiles && activeFile.skins.length ? '' : 'disabled'}>${optionsSkin}</select>
        </label>

        ${SOUND_FEATURE_ENABLED && state.soundFiles.length
          ? `
            <label class="field">
              <span>Sound</span>
              <select data-sound-select>${optionsSound}</select>
            </label>

            <label class="field checkbox-field">
              <span class="field-header">
                <span>Play with sound</span>
                <input type="checkbox" data-play-with-sound ${state.preview.playWithSound ? 'checked' : ''}>
              </span>
            </label>

            <label class="field">
              <span class="field-header">
                <span>Sound offset</span>
                <strong data-sound-offset-value>${formatSoundOffset(state.preview.soundOffsetMs)}</strong>
              </span>
              <input data-sound-offset-range type="range" min="0" max="2" step="0.1" value="${state.preview.soundOffsetMs / 1000}">
            </label>
          `
          : ''}

        <label class="field">
          <span class="field-header">
            <span>Speed</span>
            <strong data-speed-value>${state.preview.speed.toFixed(2)}x</strong>
          </span>
          <input data-speed-range type="range" min="0.5" max="2" step="0.1" value="${state.preview.speed}" ${hasFiles ? '' : 'disabled'}>
        </label>

        <div class="zoom-controls">
          <span>Zoom <strong data-zoom-value>${Math.round((state.preview.zoom || 1) * 100)}%</strong></span>
          <div class="button-row zoom-button-row">
            <button class="secondary-btn control-btn" data-action="zoom-out" ${hasFiles ? '' : 'disabled'}>-</button>
            <button class="secondary-btn control-btn" data-action="zoom-reset" ${hasFiles ? '' : 'disabled'}>Reset</button>
            <button class="secondary-btn control-btn" data-action="zoom-in" ${hasFiles ? '' : 'disabled'}>+</button>
          </div>
        </div>

        <div class="zoom-controls">
          <span>Position</span>
          <div class="button-row zoom-button-row">
            <button class="secondary-btn control-btn" data-action="reset-spine-position" ${hasFiles ? '' : 'disabled'}>Center</button>
          </div>
        </div>
        <div class="anchor-fields position-fields">
          <label class="field anchor-field">
            <span>X (px)</span>
            <input
              type="number"
              step="1"
              data-spine-position-input="x"
              value="${spinePositionX}"
              ${hasFiles ? '' : 'disabled'}
              title="Lệch so với tâm khung preview"
            />
          </label>
          <label class="field anchor-field">
            <span>Y (px)</span>
            <input
              type="number"
              step="1"
              data-spine-position-input="y"
              value="${spinePositionY}"
              ${hasFiles ? '' : 'disabled'}
              title="Lệch so với tâm khung preview"
            />
          </label>
        </div>

        ${backgroundPickerMarkup()}

        <div class="hint-list">
          <p><kbd>Space</kbd> play or pause</p>
          <p><kbd>R</kbd> restart</p>
          <p><kbd>L</kbd> toggle loop</p>
          <p><kbd>Click</kbd> chọn spine, <kbd>Drag</kbd> kéo vị trí</p>
        </div>

        <div class="sequence-panel">
          <div class="sequence-header">
            <span>Sequence</span>
            <span>${state.preview.sequence.length} items</span>
          </div>
          <div class="button-row">
            <button class="secondary-btn control-btn" data-action="add-sequence-current" ${hasFiles && state.preview.currentAnimation ? '' : 'disabled'}>Add Anim</button>
            <button class="secondary-btn control-btn sequence-play-btn" data-action="play-sequence" ${state.preview.sequence.length ? '' : 'disabled'}>Play Seq</button>
            <button class="secondary-btn control-btn" data-action="clear-sequence" ${state.preview.sequence.length ? '' : 'disabled'}>Clear</button>
          </div>
          <label class="sequence-loop">
            <input type="checkbox" data-sequence-loop-last ${state.preview.sequenceLoopLast ? 'checked' : ''}>
            <span>Loop last animation</span>
          </label>
          <div class="sequence-list">
            ${sequenceItems || '<p class="sequence-empty">Chưa có animation nào trong sequence.</p>'}
          </div>
        </div>
      `
    : `
        <div class="controls-placeholder">
          <div class="controls-placeholder-copy">
            <p>Select a Spine file to enable controls.</p>
          </div>
          <div class="placeholder-block placeholder-block-lg"></div>
          <div class="placeholder-row">
            <div class="placeholder-pill"></div>
            <div class="placeholder-pill"></div>
            <div class="placeholder-pill"></div>
          </div>
          <div class="placeholder-block"></div>
          <div class="placeholder-block"></div>
          <div class="placeholder-block"></div>
          <div class="placeholder-divider"></div>
          <div class="placeholder-row placeholder-row-wide">
            <div class="placeholder-pill"></div>
            <div class="placeholder-pill"></div>
          </div>
          <div class="placeholder-list">
            <div class="placeholder-line"></div>
            <div class="placeholder-line"></div>
            <div class="placeholder-line short"></div>
          </div>
        </div>
      `;

  return `
    <section class="preview-grid">
      <div class="preview-card">
        <div class="card-header preview-header">
          <div class="preview-title-row">
            <button
              class="secondary-btn icon-btn"
              data-action="toggle-expanded-preview"
              ${hasFiles ? '' : 'disabled'}
              aria-label="${state.preview.expanded ? 'Collapse preview' : 'Expand preview'}"
            >
              <svg class="icon-svg" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
                <path d="M8 4H4v4M12 4h4v4M16 12v4h-4M8 16H4v-4" opacity="0" />
              </svg>
            </button>
            <div class="preview-file">
              <h2>${hasFiles ? escapeHtml(activeFile.fileName) : 'No spine selected'}</h2>
            </div>
          </div>
        </div>
        <div class="viewport-wrap" data-preview-bg-target data-preview-dropzone>
          <div data-preview-viewport class="preview-viewport"></div>
          ${state.preview.isLoading ? '<div class="overlay-message">Loading spine...</div>' : ''}
          ${!hasFiles && !state.preview.isLoading ? '<div class="overlay-message">Chọn folder và scan để bắt đầu preview.</div>' : ''}
          ${hasFiles ? canvasOverlayInstances(activeInstance).map((instance) => canvasSizeOverlayMarkup(instance, instance.id === activeInstance?.id)).join('') : ''}
          ${animationOverlay}
        </div>
        <div class="preview-stack-section">
          <div class="preview-stack-header">
            <span>Preview Stack</span>
            <button
              type="button"
              class="secondary-btn preview-stack-clear-btn"
              data-action="clear-all-preview-instances"
              ${state.preview.instances.length ? '' : 'disabled'}
            >
              Clear All
            </button>
          </div>
          ${previewStackMarkup
            ? `<div class="preview-stack-list">${previewStackMarkup}</div>`
            : '<p class="preview-stack-empty">Drag Spine buttons vào khung preview để thêm spine instances vào cùng một canvas.</p>'}
        </div>
        ${previewError}
        <div class="timeline">
          <div class="timeline-labels">
            <span data-current-animation>${escapeHtml(state.preview.currentAnimation || 'None')}</span>
            <span data-elapsed>${formatSeconds(state.preview.elapsed)} / ${formatSeconds(state.preview.duration)}s</span>
          </div>
          <div class="timeline-track">
            <div data-progress-fill class="timeline-fill" style="width:${state.preview.duration ? (state.preview.elapsed / state.preview.duration) * 100 : 0}%"></div>
            <input data-progress class="timeline-range" type="range" min="0" max="${state.preview.duration || 0}" step="${FRAME_STEP}" value="${snapToFrame(state.preview.elapsed)}" ${hasFiles ? '' : 'disabled'}>
          </div>
        </div>
      </div>

      <div class="control-card">
        <div class="control-tabs" role="tablist">
          ${CONTROL_TABS.map(
            (tab) => `
              <button
                type="button"
                role="tab"
                class="control-tab ${state.controlTab === tab.id ? 'active' : ''}"
                data-action="set-control-tab"
                data-control-tab="${tab.id}"
                aria-selected="${state.controlTab === tab.id ? 'true' : 'false'}"
              >${tab.label}</button>
            `,
          ).join('')}
        </div>
        ${state.controlTab === 'export' ? frameExportPanelMarkup() : controlsMarkup}
      </div>
    </section>
  `;
}

function stageContextMenuMarkup() {
  const instance = getPreviewInstanceById(state.contextMenu.instanceId);
  if (!state.contextMenu.open || !instance) {
    return '';
  }

  const file = getPreviewFile(instance);
  const registered = registeredFramesOf(instance);
  const canRegister = canRegisterFrame();
  const item = registered.length
    ? `
      <button class="context-menu-item danger" type="button" data-action="context-remove-frames">
        Remove registered frame${registered.length > 1 ? `s (${registered.length})` : ''}
      </button>
    `
    : `
      <button
        class="context-menu-item"
        type="button"
        data-action="context-register-frame"
        ${canRegister ? '' : 'disabled'}
        title="${canRegister ? '' : 'Pause animation ở frame hợp lệ trước'}"
      >
        Register frame
      </button>
    `;

  return `
    <div class="context-menu-layer" data-action="close-context-menu">
      <div class="context-menu" style="left:${state.contextMenu.x}px;top:${state.contextMenu.y}px;">
        <p class="context-menu-title">${escapeHtml(file ? spineDisplayName(file) : 'Spine')}</p>
        ${item}
      </div>
    </div>
  `;
}

function expandedPreviewMarkup() {
  if (!state.preview.expanded) {
    return '';
  }

  const activeInstance = getActivePreviewInstance();
  const activeFile = getPreviewFile(activeInstance);
  const hasFiles = Boolean(activeInstance && activeFile);
  const optionsSkin = activeFile
    ? activeFile.skins
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}" ${name === state.preview.currentSkin ? 'selected' : ''}>${escapeHtml(name)}</option>`,
        )
        .join('')
    : '';

  return `
    <div class="preview-modal" data-preview-modal>
      <div class="preview-modal-backdrop" data-action="close-expanded-preview"></div>
      <div class="preview-modal-panel">
        <div class="preview-modal-header">
          <div class="preview-modal-copy">
            <p class="eyebrow">Fullscreen Preview</p>
            <h2>${hasFiles ? escapeHtml(activeFile.fileName) : 'No spine selected'}</h2>
          </div>
          <div class="preview-modal-actions">
            ${hasFiles && activeFile.skins.length > 1
              ? `
                <label class="modal-field-label">
                  <span>Skin</span>
                  <select class="modal-skin-select" data-skin-select>
                    ${optionsSkin}
                  </select>
                </label>
              `
              : ''}
            <button
              class="secondary-btn icon-btn modal-close-btn"
              data-action="close-expanded-preview"
              aria-label="Close preview"
            >
              <svg class="icon-svg" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
        </div>
        <div class="preview-modal-body" data-preview-bg-target>
          <div data-preview-modal-viewport class="preview-modal-viewport"></div>
          ${state.preview.isLoading ? '<div class="overlay-message">Loading spine...</div>' : ''}
          ${hasFiles
            ? `
              <div class="preview-modal-zoom-controls">
                <span>Zoom <strong data-zoom-value>${Math.round((state.preview.zoom || 1) * 100)}%</strong></span>
                <div class="button-row zoom-button-row">
                  <button class="secondary-btn control-btn" data-action="zoom-out">-</button>
                  <button class="secondary-btn control-btn" data-action="zoom-reset">Reset</button>
                  <button class="secondary-btn control-btn" data-action="zoom-in">+</button>
                </div>
              </div>
            `
            : ''}
          ${hasFiles ? animationOverlayMarkup(activeFile) : ''}
        </div>
      </div>
    </div>
  `;
}

function exportPanelMarkup() {
  if (!EXPORT_FEATURE_ENABLED) {
    return '';
  }

  const hasFiles = state.files.length > 0;
  if (!hasFiles || state.uiMode !== 'export') {
    return '';
  }

  const exportButtons = state.files
    .map((file) => {
      const active = isExportFileSelected(file.id) ? 'active' : '';
      return `
        <button
          type="button"
          class="spine-chip export-chip ${active}"
          data-action="toggle-export-file"
          data-file-id="${escapeHtml(file.id)}"
        >
          ${escapeHtml(spineDisplayName(file))}
        </button>
      `;
    })
    .join('');

  return `
    <section class="export-panel-card">
      <div class="card-header export-panel-header">
        <div>
          <p class="eyebrow">Export Spine</p>
          <h2>Batch Export</h2>
        </div>
        <div class="export-panel-header-actions">
          <p class="export-panel-copy">Chọn pivot của spine khi export. PNG sẽ được offset để bên runtime có thể dùng anchor chuẩn <code>0.5,0.5</code> mà vẫn giữ đúng tâm/pivot mong muốn.</p>
          <button class="secondary-btn" data-action="back-to-preview">Back To Preview</button>
        </div>
      </div>

      <div class="folder-row source-row export-row">
        <input
          data-export-folder-input
          class="folder-input"
          type="text"
          placeholder="/path/to/output-folder"
          value="${escapeHtml(state.export.outputDir)}"
        />
        <button class="primary-btn" data-action="select-export-folder">Browse</button>
        <button class="primary-btn accent" data-action="export-png-batch" ${state.export.isExporting ? 'disabled' : ''}>${state.export.isExporting ? 'Exporting...' : 'Export'}</button>
      </div>

      <div class="export-toolbar">
        <label class="field export-anchor-field">
          <span>Spine Pivot X</span>
          <input data-export-anchor-x class="folder-input export-anchor-input" type="number" min="0" max="1" step="0.01" value="${escapeHtml(state.export.anchorX)}" />
        </label>
        <label class="field export-anchor-field">
          <span>Spine Pivot Y</span>
          <input data-export-anchor-y class="folder-input export-anchor-input" type="number" min="0" max="1" step="0.01" value="${escapeHtml(state.export.anchorY)}" />
        </label>
        <div class="export-actions">
          <button class="secondary-btn" data-action="select-all-export-files">Select All</button>
          <button class="secondary-btn" data-action="clear-export-files" ${state.export.selectedFileIds.length ? '' : 'disabled'}>Clear</button>
        </div>
      </div>

      <p class="navigator-result export-result">${state.export.selectedFileIds.length} files selected${state.export.lastSummary ? ` • ${escapeHtml(state.export.lastSummary)}` : ''}</p>
      <div class="spine-chip-list export-chip-list">
        ${exportButtons}
      </div>

      ${state.success ? `<div class="status success export-status">${escapeHtml(state.success)}</div>` : ''}
    </section>
  `;
}

function render() {
  const current = getCurrentFile();
  const activeInstance = getActivePreviewInstance();
  const activeFile = getPreviewFile(activeInstance);
  const hasFiles = state.files.length > 0;
  syncExportSelection();
  const autocompleteOptions = state.files
    .map(
      (file) =>
        `<option value="${escapeHtml(file.relativeName)}"></option>`,
    )
    .join('');
  const spineButtons = hasFiles
    ? state.files
        .map((file) => {
          const active = current?.id === file.id ? 'active' : '';
          return `
            <button
              type="button"
              class="spine-chip ${active}"
              data-action="select-file-chip"
              data-file-id="${escapeHtml(file.id)}"
              draggable="true"
            >
              ${escapeHtml(spineDisplayName(file))}
            </button>
          `;
        })
        .join('')
    : '';
  const searchPlaceholder = hasFiles && current
    ? `Search another spine... Current source: ${current.fileName}`
    : 'Search scanned files...';

  app.innerHTML = `
    <div class="shell theme-${state.theme} ${state.loading ? 'is-loading' : ''} ${state.readyAnimating ? 'is-ready' : ''} mode-${state.uiMode}" style="--preview-image:url('${previewBackgroundUrl}')">
      <div class="loading-screen ${state.loading ? '' : 'hidden'}" aria-hidden="${state.loading ? 'false' : 'true'}">
        <div class="loading-splash">
          <div class="loading-orbital" aria-hidden="true">
            <div class="loading-orbital-grid"></div>
            <div class="loading-orbital-ring loading-orbital-ring-outer"></div>
            <div class="loading-orbital-ring loading-orbital-ring-middle"></div>
            <div class="loading-orbital-core">
              <div class="loading-core-cut loading-core-cut-a"></div>
              <div class="loading-core-cut loading-core-cut-b"></div>
            </div>
            <div class="loading-orbital-shard loading-orbital-shard-a"></div>
            <div class="loading-orbital-shard loading-orbital-shard-b"></div>
            <div class="loading-orbital-shard loading-orbital-shard-c"></div>
            <div class="loading-orbital-beam"></div>
            <div class="loading-orbital-noise">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
          <div class="loading-copy">
            <p class="loading-kicker">Spine Preview Workspace</p>
            <h1>Preparing your animation stage</h1>
            <p>Optimizing viewport and control surface.</p>
          </div>
          <div class="loading-progress" aria-hidden="true">
            <div class="loading-progress-bar"></div>
          </div>
        </div>
      </div>

      <main class="main-layout">
        ${state.uiMode === 'preview'
          ? `
            <section class="hero-card">
          <div class="hero-header">
            <div>
              <p class="eyebrow app-title">Animation Preview App</p>
              <p class="hero-copy">Chọn folder animation, scan toàn bộ spine files.</p>
            </div>
            <button
              class="secondary-btn theme-btn"
              data-action="toggle-theme"
              aria-label="${state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}"
            >
              <span class="theme-icon-wrap ${state.theme === 'dark' ? 'is-dark' : 'is-light'}" aria-hidden="true">
                <svg class="theme-icon theme-icon-sun" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="3.2" />
                  <path d="M10 1.8v2.4M10 15.8v2.4M18.2 10h-2.4M4.2 10H1.8M15.9 4.1l-1.7 1.7M5.8 14.2l-1.7 1.7M15.9 15.9l-1.7-1.7M5.8 5.8L4.1 4.1" />
                </svg>
                <svg class="theme-icon theme-icon-moon" viewBox="0 0 20 20">
                  <path d="M13.8 2.9a6.9 6.9 0 1 0 3.3 12.9A7.8 7.8 0 0 1 13.8 2.9Z" />
                </svg>
              </span>
            </button>
          </div>

          <div class="folder-row source-toolbar">
            <input
              data-folder-input
              class="folder-input"
              type="text"
              placeholder="/path/to/animation-folder"
              value="${escapeHtml(state.folderPath)}"
            />
            <button class="primary-btn" data-action="select-folder">Browse</button>
            <button class="primary-btn accent" data-action="scan-folder" ${state.scanning ? 'disabled' : ''}>${state.scanning ? 'Scanning...' : 'Scan'}</button>
            ${EXPORT_FEATURE_ENABLED
              ? `<button class="secondary-btn export-entry-btn" data-action="open-export-workspace" ${hasFiles ? '' : 'disabled'}>Export Spine</button>`
              : ''}
          </div>
          ${hasFiles
            ? `<p class="navigator-result source-result">${state.files.length} spine files scanned.</p>`
            : ''}

          ${SOUND_FEATURE_ENABLED
            ? `
              <div class="source-grid">
                <div class="source-card">
                  <div class="source-card-copy">
                    <p class="eyebrow">Sound Source</p>
                    <p class="source-copy">Chọn folder sound để ghép playback theo file hoặc animation hiện tại.</p>
                  </div>
                  <div class="folder-row source-row">
                    <input
                      class="folder-input"
                      type="text"
                      placeholder="/path/to/sound-folder"
                      value="${escapeHtml(state.soundFolderPath)}"
                      readonly
                    />
                    <button class="primary-btn" data-action="select-sound-folder">Browse</button>
                    <button class="primary-btn accent" data-action="scan-sound-folder" ${state.soundScanning ? 'disabled' : ''}>${state.soundScanning ? 'Scanning...' : 'Scan'}</button>
                  </div>
                  ${state.soundFolderPath
                    ? `<p class="navigator-result">${state.soundFiles.length} sound files scanned.</p>`
                    : ''}
                </div>
              </div>
              `
            : ''}

          <div class="hero-search-row">
            <div class="search-input-wrap">
              <input
                data-file-search
                class="navigator-search"
                type="text"
                list="file-search-suggestions"
                placeholder="${escapeHtml(searchPlaceholder)}"
                value="${escapeHtml(state.fileSearch)}"
                ${hasFiles ? '' : 'disabled'}
              />
            </div>
            <datalist id="file-search-suggestions">
              ${autocompleteOptions}
            </datalist>
            <div class="header-meta hero-meta">
              <span>${hasFiles ? `${state.currentIndex + 1} / ${state.files.length}` : '0 / 0'}</span>
            </div>
          </div>
          ${hasFiles
            ? `<p class="search-hint-label">Drag & drop spine vào khung bên dưới để preview</p>`
            : ''}

          ${hasFiles
            ? `
              <div class="spine-chip-list">
                ${spineButtons}
              </div>
            `
            : ''}

          ${state.error ? `<div class="status error">${escapeHtml(state.error)}</div>` : ''}
            </section>
          `
          : ''}

        ${state.uiMode === 'preview' ? previewPanelMarkup() : ''}
        ${exportPanelMarkup()}

        <footer class="app-footer">
          <p>Prompted by TiTi</p>
        </footer>
      </main>

      ${expandedPreviewMarkup()}
      ${stageContextMenuMarkup()}
    </div>
  `;

  attachStageView();
  observePreviewViewport();
  applyPreviewBackground();
  schedulePreviewResize();
}

function initialize() {
  state.folderPath = localStorage.getItem('spine-preview-folder') || '';
  state.soundFolderPath = SOUND_FEATURE_ENABLED
    ? (localStorage.getItem('spine-preview-sound-folder') || '')
    : '';
  state.theme = localStorage.getItem('spine-preview-theme') === 'light' ? 'light' : 'dark';
  state.background = localStorage.getItem('spine-preview-background') || 'scene';
  state.preview.animationListPos =
    localStorage.getItem('spine-preview-animlist-pos') === 'float' ? 'float' : 'left';
  state.preview.animationListXY = readStoredAnimationListXY();
  if (!SOUND_FEATURE_ENABLED) {
    state.soundFiles = [];
    state.soundScanning = false;
    resetPreviewSoundState();
  }
  render();
  bindEvents();
  window.addEventListener('resize', schedulePreviewResize);

  window.setTimeout(() => {
    state.loading = false;
    state.readyAnimating = true;
    render();
    window.setTimeout(() => {
      state.readyAnimating = false;
      render();
    }, READY_FADE_DURATION_MS);
  }, LOADING_SCREEN_MAX_DURATION_MS);
}

initialize();
