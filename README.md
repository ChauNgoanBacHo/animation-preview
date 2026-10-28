# Spine GIF Expoter

Desktop tool dành cho team animation tạo GIF minh hoạ trong doc closure. App quét toàn bộ Spine trong một folder, gom animation theo từng asset và export các đoạn trim thành GIF trong một lượt.

## Luồng sử dụng

1. Chọn `Source folder`, sau đó bấm `Scan Spine`.
2. Mỗi Spine được hiển thị thành một group dọc; bên phải là toàn bộ animation của Spine đó.
3. Chọn skin (nếu Spine có skin), rồi click tên animation để xem preview phát loop trong đúng đoạn trim. Chỉnh `From` / `To` hoặc kéo hai đầu trim trên timeline.
4. Click animation card hoặc checkbox để chọn những animation cần xuất.
5. Chọn `GIF output` và bấm `Export GIF` để chạy batch một lần.

Dùng ô search để lọc theo tên Spine hoặc animation. Nút `Uncheck all` bỏ chọn toàn bộ batch nhưng giữ nguyên skin và timeframe đã cấu hình.

Bật `Gộp Anim` để ghép toàn bộ animation đã tick vào một GIF 960×540. Tool tự xếp tối đa 5 animation mỗi hàng; mỗi animation dùng skin/timeframe riêng và tự loop nếu ngắn hơn thời lượng group.

GIF được render trong vùng tối đa 512×512 rồi tự crop theo nội dung, chạy ở 20 FPS, loop vô hạn, dùng skin đã chọn và có tên dạng `SpineName_AnimationName.gif`. Option `Bake nền caro` được bật mặc định để đưa nền caro vào file GIF; tắt option này nếu cần GIF transparent.

`Object size` điều chỉnh độ lớn nhân vật khi render. Tool tự quét pixel alpha trên toàn bộ timeframe và crop transparent padding theo giá trị `Padding`, giúp file GIF gọn và nhẹ hơn. Khi bật `Gộp Anim`, dùng `Object / row` để chọn số animation trên mỗi hàng của group GIF.

Mỗi GIF được tự tối ưu xuống tối đa 0.5 MB. Nếu lần encode đầu vượt giới hạn, tool tự encode lại theo nhiều mức, ưu tiên giữ chất lượng rồi mới giảm palette màu, FPS và resolution.

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
