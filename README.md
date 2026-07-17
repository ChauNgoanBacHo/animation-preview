# spine-preview-app

Desktop app để preview Spine animation folder bằng Electron + Vite.

## Setup

Yêu cầu:
- Node.js 20+
- npm

Cài dependencies:

```bash
npm install
```

Chạy app local:

```bash
npm start
```

Build:

```bash
npm run make
```

Build Windows `.exe`:

```bash
npm run make:win
```

## Khi Electron không tự download được

Một số máy nội bộ hoặc mạng bị chặn có thể làm `npm install` không tải được binary Electron. Khi đó có thể cài thủ công như sau.

### 1. Xác định version Electron cần dùng

Project hiện dùng:

```text
electron 42.3.3
```

Có thể kiểm tra lại trong [package.json](/Users/fe-tienhuynh/Documents/spine-preview-app/package.json:24).

### 2. Download Electron binary thủ công

Tải đúng file theo OS đang dùng từ release Electron:

- macOS Apple Silicon: `electron-v42.3.3-darwin-arm64.zip`
- macOS Intel: `electron-v42.3.3-darwin-x64.zip`
- Windows x64: `electron-v42.3.3-win32-x64.zip`

Sau khi tải xong, giải nén vào:

```text
node_modules/electron/dist
```

Ví dụ sau khi giải nén:

- macOS: `node_modules/electron/dist/Electron.app`
- Windows: `node_modules/electron/dist/electron.exe`

### 3. Tạo file `path.txt`

Electron package cần file `node_modules/electron/path.txt` để biết executable nằm ở đâu trong thư mục `dist`.

#### macOS

Tạo file:

```text
node_modules/electron/path.txt
```

Nội dung:

```text
Electron.app/Contents/MacOS/Electron
```

Lệnh nhanh:

```bash
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

#### Windows

Tạo file:

```text
node_modules/electron/path.txt
```

Nội dung:

```text
electron.exe
```

### 4. Kiểm tra lại

Sau khi đã có:

- `node_modules/electron/dist/...`
- `node_modules/electron/path.txt`

thì chạy lại:

```bash
npm start
```

Hoặc build:

```bash
npm run make
```

## Ghi chú

- Icon Windows dùng `assets/icon.ico`
- Installer Windows đang được tạo bằng Electron Forge Squirrel
- Nếu preview Spine trên Windows bị lỗi asset path, hãy chắc rằng bạn đang dùng bản build mới nhất của project
