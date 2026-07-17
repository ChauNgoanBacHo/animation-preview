import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { toAssetUrl } from './shared/assetUrl.js';

let preferencesApplied = false;
const LOAD_TIMEOUT_MS = 8000;

function applyAssetPreferences() {
  if (preferencesApplied) {
    return;
  }

  preferencesApplied = true;
  PIXI.Assets.setPreferences({
    preferWorkers: false,
    crossOrigin: 'anonymous',
  });
}

export class SpineStage {
  static MIN_SPINE_SCALE = 0.1;

  static MAX_SPINE_SCALE = 10;

  constructor(container, options = {}) {
    this.container = container;
    this.destroyed = false;
    this.spines = [];
    this.content = new PIXI.Container();
    const { width, height } = this.getViewportSize();
    this.app = new PIXI.Application({
      width,
      height,
      antialias: true,
      backgroundColor: options.backgroundColor ?? 0x101418,
      backgroundAlpha: options.backgroundAlpha ?? 1,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    const view = this.app.view;
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.display = 'block';
    this.app.stage.addChild(this.content);
    container.appendChild(view);
  }

  async loadSpine({ jsonPath, atlasPath }) {
    applyAssetPreferences();
    const jsonUrl = toAssetUrl(jsonPath);
    const atlasUrl = toAssetUrl(atlasPath);

    const [jsonResponse, atlasResponse] = await Promise.all([
      fetch(jsonUrl),
      fetch(atlasUrl),
    ]);

    if (!jsonResponse.ok) {
      throw new Error(`Khong doc duoc JSON asset (${jsonResponse.status})`);
    }

    if (!atlasResponse.ok) {
      throw new Error(`Khong doc duoc atlas asset (${atlasResponse.status})`);
    }

    const resource = await Promise.race([
      PIXI.Assets.load({
        src: jsonUrl,
        data: {
          spineAtlasFile: atlasUrl,
        },
      }),
      new Promise((_, reject) => {
        window.setTimeout(() => {
          reject(new Error('Spine preview load timed out. Kiểm tra lại file atlas va texture png.'));
        }, LOAD_TIMEOUT_MS);
      }),
    ]);

    const spine = new Spine(resource.spineData);
    if (this.destroyed) {
      spine.destroy();
      throw new Error('Preview was destroyed before the asset loaded');
    }

    this.spines.push(spine);
    this.content.addChild(spine);
    return spine;
  }

  removeSpine(spine) {
    if (!spine) {
      return;
    }

    this.spines = this.spines.filter((item) => item !== spine);
    spine.parent?.removeChild(spine);
    spine.destroy();
  }

  setContainer(container) {
    if (!container) {
      return;
    }

    this.container = container;
  }

  getViewportSize() {
    const rect = this.container?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    return {
      width: Math.max(1, Math.round(this.container?.clientWidth || rect.width || 0)),
      height: Math.max(1, Math.round(this.container?.clientHeight || rect.height || 0)),
    };
  }

  syncViewportSize() {
    if (this.destroyed) {
      return false;
    }

    const { width, height } = this.getViewportSize();
    const renderer = this.app.renderer;
    const currentWidth = renderer.screen.width;
    const currentHeight = renderer.screen.height;

    if (currentWidth !== width || currentHeight !== height) {
      renderer.resize(width, height);
      return true;
    }

    return false;
  }

  centerPoint() {
    const view = this.app.screen;
    return { x: view.width / 2, y: view.height / 2 };
  }

  clientToCanvasPoint(clientX, clientY) {
    const rect = this.container?.getBoundingClientRect?.();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  getSpineCenter(spine) {
    const bounds = spine.getLocalBounds();
    const scaleX = spine.scale.x || 1;
    const scaleY = spine.scale.y || 1;
    return {
      x: spine.position.x + (bounds.x + bounds.width / 2) * scaleX,
      y: spine.position.y + (bounds.y + bounds.height / 2) * scaleY,
    };
  }

  centerSpineAt(spine, x, y) {
    const bounds = spine.getLocalBounds();
    spine.position.set(
      x - (bounds.x + bounds.width / 2) * spine.scale.x,
      y - (bounds.y + bounds.height / 2) * spine.scale.y,
    );
  }

  moveSpineBy(spine, deltaX, deltaY) {
    spine.position.set(
      spine.position.x + deltaX,
      spine.position.y + deltaY,
    );
  }

  setSpineScale(spine, nextScale) {
    const clamped = Math.max(
      SpineStage.MIN_SPINE_SCALE,
      Math.min(SpineStage.MAX_SPINE_SCALE, nextScale),
    );
    const center = this.getSpineCenter(spine);
    spine.scale.set(clamped);
    this.centerSpineAt(spine, center.x, center.y);
    return clamped;
  }

  zoomSpineBy(spine, factor) {
    return this.setSpineScale(spine, spine.scale.x * factor);
  }

  resetSpineTransform(spine) {
    this.setSpineScale(spine, 1);
    const center = this.centerPoint();
    this.centerSpineAt(spine, center.x, center.y);
  }

  bringToFront(spine) {
    if (!spine?.parent) {
      return;
    }

    spine.parent.addChild(spine);
    this.spines = this.spines.filter((item) => item !== spine);
    this.spines.push(spine);
  }

  hitTest(clientX, clientY) {
    const point = this.clientToCanvasPoint(clientX, clientY);
    for (let index = this.spines.length - 1; index >= 0; index -= 1) {
      const spine = this.spines[index];
      const bounds = spine.getBounds();
      if (bounds.contains(point.x, point.y)) {
        return spine;
      }
    }

    return null;
  }

  setBackground(color, alpha = 1) {
    const renderer = this.app.renderer;
    if (typeof color === 'number') {
      renderer.background.color = color;
    }
    renderer.background.alpha = alpha;
    this.renderOnce();
  }

  setTimeScale(scale) {
    for (const spine of this.spines) {
      spine.state.timeScale = scale;
    }
  }

  renderOnce() {
    if (!this.destroyed) {
      this.app.renderer.render(this.app.stage);
    }
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    const view = this.app.view;
    this.app.destroy(true, {
      children: true,
      texture: false,
      baseTexture: false,
    });
    view.parentElement?.removeChild(view);
    this.spines = [];
  }

  get currentZoom() {
    return 1;
  }

  static animationNames(spine) {
    return spine.spineData.animations.map((animation) => animation.name);
  }

  static animationDuration(spine, name) {
    const animation = spine.spineData.animations.find((item) => item.name === name);
    return animation ? animation.duration : 0;
  }

  static currentPlayback(spine) {
    const entry = spine.state.tracks[0];
    if (!entry?.animation) {
      return { elapsed: 0, duration: 0, name: '' };
    }

    const duration = entry.animation.duration;
    let elapsed = entry.trackTime;
    if (duration > 0) {
      elapsed = entry.loop ? entry.trackTime % duration : Math.min(entry.trackTime, duration);
    }

    return {
      elapsed,
      duration,
      name: entry.animation.name,
    };
  }

  static setSkin(spine, name) {
    spine.skeleton.setSkinByName(name);
    spine.skeleton.setSlotsToSetupPose();
  }

  static playAnimation(spine, name, loop) {
    spine.state.setAnimation(0, name, loop);
  }

  static seek(spine, localTime) {
    const entry = spine.state.tracks[0];
    if (!entry?.animation) {
      return;
    }

    const clamped = Math.max(0, Math.min(localTime, entry.animation.duration));
    entry.trackTime = clamped;
    spine.update(0);
  }

  static onComplete(spine, callback) {
    const listener = { complete: () => callback() };
    spine.state.addListener(listener);
    return () => spine.state.removeListener(listener);
  }

  static playSequence(spine, names, loopLast) {
    if (!names.length) {
      return;
    }

    spine.state.setAnimation(0, names[0], names.length === 1 ? loopLast : false);
    for (let index = 1; index < names.length; index += 1) {
      const isLast = index === names.length - 1;
      spine.state.addAnimation(0, names[index], isLast ? loopLast : false, 0);
    }
  }

  static playSequenceFrom(spine, names, startIndex, offset, loopLast) {
    const steps = names.slice(Math.max(0, startIndex));
    if (!steps.length) {
      return;
    }

    const entry = spine.state.setAnimation(0, steps[0], steps.length === 1 ? loopLast : false);
    if (entry && offset > 0) {
      entry.trackTime = offset;
    }

    for (let index = 1; index < steps.length; index += 1) {
      const isLast = index === steps.length - 1;
      spine.state.addAnimation(0, steps[index], isLast ? loopLast : false, 0);
    }
  }
}
