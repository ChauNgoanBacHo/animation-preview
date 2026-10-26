# Spine GIF Exporter

Desktop tool dành cho team animation tạo GIF minh hoạ trong doc closure. App quét toàn bộ Spine trong một folder, gom animation theo từng asset và export các đoạn trim thành GIF trong một lượt.

## Luồng sử dụng

1. Chọn `Source folder`, sau đó bấm `Scan Spine`.
2. Mỗi Spine được hiển thị thành một group dọc; bên phải là toàn bộ animation của Spine đó.
3. Chọn skin (nếu Spine có skin), rồi click tên animation để xem preview phát loop trong đúng đoạn trim. Chỉnh `From` / `To` hoặc kéo hai đầu trim trên timeline.
4. Tick những animation cần xuất. Checkbox là nguồn duy nhất quyết định animation nào được đưa vào batch export.
5. Chọn `GIF output` và bấm `Export GIF` để chạy batch một lần.

GIF mặc định được xuất ở 512×512, 20 FPS, loop vô hạn, nền transparent, dùng skin đã chọn và có tên dạng `SpineName_AnimationName.gif`. Preview dùng nền ô caro để dễ nhận biết vùng trong suốt; nền caro không được bake vào GIF.

## Setup

Yêu cầu Node.js 20+ và npm.

```bash
npm install
npm start
```

Build app:

```bash
npm run make
```

Build Windows `.exe`:

```bash
npm run make:win
```

## Ghi chú Electron binary

Project dùng Electron 42.3.3. Nếu mạng nội bộ chặn download, tải đúng binary cho hệ điều hành, giải nén vào `node_modules/electron/dist`, rồi tạo `node_modules/electron/path.txt`:

- macOS: `Electron.app/Contents/MacOS/Electron`
- Windows: `electron.exe`

Spine asset được đọc qua custom protocol nội bộ `spine-asset://`; file nguồn không bị chỉnh sửa trong quá trình scan hoặc export.
