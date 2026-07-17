import { app, BrowserWindow, dialog, ipcMain, protocol, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const SPINE_ASSET_SCHEME = 'spine-asset';

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.atlas' || ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SPINE_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

const createWindow = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    minWidth: 900,
    minHeight: 680,
    center: true,
    backgroundColor: '#0e141a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

function walkJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkAtlasFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkAtlasFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.atlas')) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkSoundFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSoundFiles(fullPath));
    } else if (entry.isFile() && /\.(mp3|wav|ogg|m4a)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function readAtlasPngs(atlasPath) {
  if (!fs.existsSync(atlasPath)) {
    return [];
  }

  const lines = fs.readFileSync(atlasPath, 'utf8').split(/\r?\n/);
  return lines.filter((line) => line.trim().endsWith('.png')).map((line) => line.trim());
}

function resolveAtlasTexturePaths(atlasPath) {
  const atlasDir = path.dirname(atlasPath);
  return readAtlasPngs(atlasPath).map((name) => path.resolve(atlasDir, name));
}

function atlasTexturesExist(atlasPath) {
  const texturePaths = resolveAtlasTexturePaths(atlasPath);
  return texturePaths.length > 0 && texturePaths.every((texturePath) => fs.existsSync(texturePath));
}

function readSkinNames(rawSkins) {
  if (Array.isArray(rawSkins)) {
    return rawSkins
      .map((skin) => (skin && typeof skin === 'object' ? skin.name : ''))
      .filter(Boolean);
  }

  if (rawSkins && typeof rawSkins === 'object') {
    return Object.keys(rawSkins);
  }

  return [];
}

function normalizeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function resolveAtlasPath(jsonPath, atlasCandidatesByDir) {
  const dir = path.dirname(jsonPath);
  const jsonBase = normalizeBaseName(jsonPath);
  const directAtlasPath = path.join(dir, `${path.basename(jsonPath, '.json')}.atlas`);

  if (fs.existsSync(directAtlasPath)) {
    return atlasTexturesExist(directAtlasPath) ? directAtlasPath : '';
  }

  const candidates = atlasCandidatesByDir.get(dir) ?? [];
  if (candidates.length === 0) {
    return '';
  }

  const validCandidates = candidates.filter((atlasPath) => atlasTexturesExist(atlasPath));
  if (validCandidates.length === 0) {
    return '';
  }

  const exactCandidate = validCandidates.find((atlasPath) => normalizeBaseName(atlasPath) === jsonBase);
  if (exactCandidate) {
    return exactCandidate;
  }

  const looseCandidate = validCandidates.find((atlasPath) => {
    const atlasBase = normalizeBaseName(atlasPath);
    return atlasBase.includes(jsonBase) || jsonBase.includes(atlasBase);
  });
  if (looseCandidate) {
    return looseCandidate;
  }

  if (validCandidates.length === 1) {
    return validCandidates[0];
  }

  return '';
}

function scanSpineFolder(sourceDir) {
  const jsonFiles = walkJsonFiles(sourceDir);
  const atlasFiles = walkAtlasFiles(sourceDir);
  const atlasCandidatesByDir = new Map();
  const results = [];

  for (const atlasPath of atlasFiles) {
    const dir = path.dirname(atlasPath);
    const existing = atlasCandidatesByDir.get(dir) ?? [];
    existing.push(atlasPath);
    atlasCandidatesByDir.set(dir, existing);
  }

  for (const filePath of jsonFiles) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    if (!parsed?.skeleton || !parsed?.bones || !parsed?.slots) {
      continue;
    }

    const dir = path.dirname(filePath);
    const atlasPath = resolveAtlasPath(filePath, atlasCandidatesByDir);
    if (!atlasPath || !fs.existsSync(atlasPath)) {
      continue;
    }

    const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slotsWithAttachment = slots.filter((slot) => slot?.attachment).length;
    const pngNames = readAtlasPngs(atlasPath);
    const pngPaths = resolveAtlasTexturePaths(atlasPath);
    const atlasPages = Math.max(pngNames.length, 1);
    const estDrawcall = Math.max(atlasPages, Math.ceil(slotsWithAttachment / 8));
    const animations = parsed.animations && typeof parsed.animations === 'object'
      ? Object.keys(parsed.animations)
      : [];
    const skins = readSkinNames(parsed.skins);

    results.push({
      id: `${filePath}:${atlasPath}`,
      fileName: path.basename(filePath),
      relativeName: path.relative(sourceDir, filePath),
      jsonPath: filePath,
      atlasPath,
      pngPaths,
      version: typeof parsed.skeleton?.spine === 'string' ? parsed.skeleton.spine : 'unknown',
      slots: slotsWithAttachment,
      atlasPages,
      estDrawcall,
      animations,
      skins,
    });
  }

  return results;
}

function scanSoundFolder(sourceDir) {
  return walkSoundFiles(sourceDir).map((filePath) => ({
    id: filePath,
    fileName: path.basename(filePath),
    relativeName: path.relative(sourceDir, filePath),
    soundPath: filePath,
    baseName: path.basename(filePath, path.extname(filePath)).toLowerCase(),
  }));
}

function ensureInsideOutputDir(outputDir, relativeOutputPath) {
  const normalized = path.normalize(relativeOutputPath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(outputDir, normalized);
}

function buildExportAtlas(textureFileName, width, height, regionName) {
  return `${textureFileName}
size: ${width},${height}
format: RGBA8888
filter: Linear,Linear
repeat: none

${regionName}
  rotate: false
  xy: 0, 0
  size: ${width}, ${height}
  orig: ${width}, ${height}
  offset: 0, 0
  index: -1
`;
}

function buildExportJson({ baseName, width, height, pivotX, pivotY, spineVersion }) {
  const centerX = width / 2 - pivotX;
  const centerY = pivotY - height / 2;
  return JSON.stringify({
    skeleton: {
      spine: spineVersion || '3.7.94',
      width,
      height,
      images: './',
    },
    bones: [
      { name: 'root' },
      { name: 'holder', parent: 'root' },
    ],
    slots: [
      { name: 'image', bone: 'holder', attachment: baseName },
    ],
    skins: {
      default: {
        image: {
          [baseName]: {
            x: Number(centerX.toFixed(3)),
            y: Number(centerY.toFixed(3)),
            width,
            height,
          },
        },
      },
    },
    animations: {
      idle: {},
    },
  });
}

async function saveBatchSpineExportFiles(outputDir, files) {
  const writtenFiles = [];

  for (const file of files) {
    if (!file?.relativeBasePath || !file?.pngDataUrl) {
      continue;
    }

    const pngPath = ensureInsideOutputDir(outputDir, `${file.relativeBasePath}.png`);
    const atlasPath = ensureInsideOutputDir(outputDir, `${file.relativeBasePath}.atlas`);
    const jsonPath = ensureInsideOutputDir(outputDir, `${file.relativeBasePath}.json`);
    const targetDir = path.dirname(pngPath);
    const textureFileName = path.basename(pngPath);
    const regionName = path.basename(file.relativeBasePath);
    const width = Math.max(1, Math.round(Number(file.width) || 0));
    const height = Math.max(1, Math.round(Number(file.height) || 0));
    const pivotX = Number(file.pivotX) || 0;
    const pivotY = Number(file.pivotY) || 0;
    const base64 = String(file.pngDataUrl).replace(/^data:image\/png;base64,/, '');
    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.writeFile(pngPath, Buffer.from(base64, 'base64'));
    await fs.promises.writeFile(
      atlasPath,
      buildExportAtlas(textureFileName, width, height, regionName),
      'utf8',
    );
    await fs.promises.writeFile(
      jsonPath,
      buildExportJson({
        baseName: regionName,
        width,
        height,
        pivotX,
        pivotY,
        spineVersion: file.spineVersion,
      }),
      'utf8',
    );
    writtenFiles.push(jsonPath);
  }

  return writtenFiles;
}

function registerIpcHandlers() {
  ipcMain.handle('select-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Spine Animation Folder',
    });

    if (canceled || !filePaths.length) {
      return '';
    }

    return filePaths[0];
  });

  ipcMain.handle('select-sound-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Sound Folder',
    });

    if (canceled || !filePaths.length) {
      return '';
    }

    return filePaths[0];
  });

  ipcMain.handle('select-export-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select PNG Export Folder',
    });

    if (canceled || !filePaths.length) {
      return '';
    }

    return filePaths[0];
  });

  ipcMain.handle('scan-spine-folder', async (_event, sourceDir) => {
    try {
      if (!sourceDir || !fs.existsSync(sourceDir)) {
        return {
          files: [],
          error: 'Folder không tồn tại hoặc không thể truy cập.',
        };
      }

      return {
        files: scanSpineFolder(sourceDir),
        error: '',
      };
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : 'Không thể scan folder.',
      };
    }
  });

  ipcMain.handle('scan-sound-folder', async (_event, sourceDir) => {
    try {
      if (!sourceDir || !fs.existsSync(sourceDir)) {
        return {
          files: [],
          error: 'Folder sound không tồn tại hoặc không thể truy cập.',
        };
      }

      return {
        files: scanSoundFolder(sourceDir),
        error: '',
      };
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : 'Không thể scan folder sound.',
      };
    }
  });

  const handleSaveBatchSpineExport = async (_event, payload) => {
    try {
      const outputDir = payload?.outputDir;
      const files = Array.isArray(payload?.files) ? payload.files : [];
      if (!outputDir || !fs.existsSync(outputDir)) {
        return {
          ok: false,
          writtenFiles: [],
          error: 'Folder export không tồn tại hoặc không thể truy cập.',
        };
      }

      const writtenFiles = await saveBatchSpineExportFiles(outputDir, files);
      return {
        ok: true,
        writtenFiles,
        error: '',
      };
    } catch (error) {
      return {
        ok: false,
        writtenFiles: [],
        error: error instanceof Error ? error.message : 'Không thể lưu PNG export.',
      };
    }
  };

  ipcMain.handle('save-batch-spine-export', handleSaveBatchSpineExport);
  ipcMain.handle('save-batch-png', handleSaveBatchSpineExport);
}

function installSpineAssetProtocol() {
  protocol.handle(SPINE_ASSET_SCHEME, async (request) => {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);

      // Windows custom protocol URLs come through as /C:/path/to/file.
      // Strip the leading slash so fs can resolve the drive letter path.
      if (/^\/[A-Za-z]:\//.test(filePath)) {
        filePath = filePath.slice(1);
      }

      const bytes = await fs.promises.readFile(filePath);
      const headers = {
        ...corsHeaders,
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': 'no-cache',
      };
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers,
      });
    } catch (error) {
      return new Response('Not found', {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Spine-Asset-Error': error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  installSpineAssetProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
