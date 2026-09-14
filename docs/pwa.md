# Hướng Dẫn & Tài Liệu PWA (Progressive Web App) - Family Inventory

Tài liệu này cung cấp hướng dẫn toàn diện về tính năng PWA đã được tích hợp vào dự án **Family Inventory (Hàng hóa gia đình)**, bao gồm cấu hình Service Worker, cơ chế cập nhật phiên bản an toàn, quy tắc mạng/cache và hướng dẫn cài đặt lên màn hình chính điện thoại.

---

## 1. Kiểm tra Web App Manifest và Service Worker trong DevTools

Để kiểm tra cấu hình PWA sau khi build ứng dụng:

1. **Khởi động bản build thử nghiệm**:
   ```bash
   npm run build
   npm run preview
   ```
2. **Mở trình duyệt** (Google Chrome hoặc Microsoft Edge) tại địa chỉ hiển thị (thường là `http://localhost:4173/`).
3. Mở **Developer Tools** (phím `F12` hoặc tổ hợp `Ctrl + Shift + I`).
4. Chuyển sang tab **Application** (hoặc **Ứng dụng**):
   - **Mục Manifest** (ở menu bên trái):
     - Kiểm tra `Name`: **Hàng hóa gia đình**
     - `Short name`: **Kho gia đình**
     - `Start URL`: `/`
     - `Display`: `standalone`
     - `Theme color`: `#2563eb` (xanh dương)
     - `Background color`: `#f8fafc`
     - Kiểm tra 4 icon: `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png` (Maskable), `apple-touch-icon-180x180.png`.
   - **Mục Service Workers**:
     - Kiểm tra file `sw.js` đã đăng ký thành công (Status: `activated and is running`).
     - Lưu ý: Trong chế độ dev (`npm run dev`), Service Worker được chủ động tắt (`devOptions.enabled: false`) để tránh cản trở quá trình Hot Module Replacement (HMR).

---

## 2. Thử nghiệm cơ chế cập nhật phiên bản (PWA Update Prompt)

Ứng dụng sử dụng cơ chế cập nhật an toàn với `registerType: 'prompt'`. Khi có phiên bản mới được deploy, Service Worker sẽ phát hiện ngầm nhưng **không tự ý reload trang** để tránh làm mất thao tác của người dùng.

### Quy trình thử nghiệm 2 bản build:

1. **Chạy bản build thứ nhất (v1)**:
   ```bash
   npm run build
   npm run preview
   ```
   - Mở ứng dụng trong tab ẩn danh hoặc tab mới.
   - Đảm bảo Service Worker của bản v1 đã cài đặt và active.
2. **Tạo bản cập nhật (v2)**:
   - Chỉnh sửa một chi tiết nhỏ trong code (ví dụ đổi tiêu đề phiên bản hoặc sửa một chuỗi text giao diện trong `src/App.tsx`).
   - Mở terminal khác và build lại:
     ```bash
     npm run build
     ```
3. **Kích hoạt phát hiện bản mới**:
   - Quay lại tab trình duyệt đang mở ở bước 1.
   - Mở thêm 1 tab mới cùng domain `http://localhost:4173/` hoặc chuyển qua lại giữa các tab để trình duyệt kiểm tra Service Worker cập nhật ngầm.
   - Hộp thoại nổi **“Có phiên bản mới”** sẽ xuất hiện ở góc dưới màn hình kèm 2 nút: **“Cập nhật”** và **“Để sau”**.
4. **Kiểm tra an toàn biểu mẫu (Dirty Form Safety)**:
   - Bấm nút **“Thêm sản phẩm”** hoặc **Sửa sản phẩm** để mở modal form.
   - Nhập một vài ký tự vào ô tên sản phẩm (form chuyển sang trạng thái đã sửa đổi - `isDirty`).
   - Nhìn vào hộp thông báo cập nhật PWA:
     - Nút **“Cập nhật”** sẽ chuyển sang trạng thái cảnh báo / yêu cầu người dùng xử lý thay đổi trước khi tải lại trang để tránh mất dữ liệu đang nhập dở.
     - Dòng cảnh báo xuất hiện: *“Bạn có thay đổi chưa lưu trong biểu mẫu. Hãy lưu hoặc hủy biểu mẫu trước khi tải lại.”*
   - Sau khi đóng form hoặc bấm hủy, nút **“Cập nhật”** trở lại bình thường.
5. **Tiến hành cập nhật**:
   - Bấm **“Cập nhật”**: Service Worker sẽ gửi thông điệp `SKIP_WAITING` và kích hoạt reload trang để áp dụng toàn bộ giao diện mới nhất.
   - Bấm **“Để sau”**: Hộp thoại ẩn đi và người dùng có thể tiếp tục công việc hiện tại.

---

## 3. Danh sách tính năng bắt buộc có kết nối mạng

> [!IMPORTANT]
> **Nguyên tắc an toàn dữ liệu**: Ứng dụng Family Inventory quản lý kho hàng dùng chung cho gia đình theo thời gian thực. Để ngăn ngừa xung đột dữ liệu giữa các thành viên và bảo đảm bảo mật cho ảnh riêng tư, ứng dụng **chỉ precache bộ khung tĩnh (App Shell)** và **tuyệt đối không runtime-cache dữ liệu kinh doanh**.

### Các tính năng bắt buộc có mạng:
1. **Đăng nhập & Xác thực**:
   - Đăng nhập email/mật khẩu, đăng xuất, làm mới phiên truy cập (Supabase Auth).
2. **Quản lý Hàng hóa & Tồn kho**:
   - Tải danh sách hàng hóa và danh mục mới nhất từ máy chủ.
   - Thêm sản phẩm mới, chỉnh sửa thông tin, cập nhật số lượng tồn kho, xóa sản phẩm.
   - Ghi nhận lịch sử xuất/nhập/điều chỉnh tồn kho.
3. **Quản lý Hình ảnh**:
   - Tải lên ảnh sản phẩm mới lên Supabase Storage.
   - Xem và hiển thị ảnh sản phẩm riêng tư (thông qua signed URL hoặc cơ chế bảo mật của kho lưu trữ).
4. **Tìm kiếm bằng ảnh AI (Packaging Search)**:
   - Gọi Supabase Edge Function `search-product-image` và dịch vụ Google Gemini API để phân tích bao bì sản phẩm.

### Trải nghiệm khi mất mạng (Offline):
- Thanh thông báo cảnh báo màu đỏ sẽ hiển thị cố định ở đầu màn hình:
  - *“Đang mất kết nối. Kết nối mạng để tải hoặc lưu dữ liệu.”*
  - Kèm ghi chú: *“Dữ liệu trên màn hình chưa được làm mới do đang mất kết nối.”*
- Các nút hành động thao tác dữ liệu (như **Lưu** trong form thêm/sửa sản phẩm, **Tìm sản phẩm** trong modal AI) sẽ bị vô hiệu hóa kèm thông báo nhắc người dùng kết nối mạng.
- Hệ thống **không tạo hàng đợi ghi offline** để tránh tình trạng ghi đè sai lệch dữ liệu kho dùng chung.

---

## 4. Hướng dẫn cài đặt lên màn hình chính (Add to Home Screen)

### Trên Android (Trình duyệt Google Chrome / Edge / Brave):
1. Dùng Chrome truy cập vào địa chỉ website của ứng dụng.
2. Nhấn vào biểu tượng **Tùy chọn** (dấu 3 chấm dọc `⋮` ở góc trên bên phải màn hình).
3. Chọn mục **“Cài đặt ứng dụng”** (hoặc **“Thêm vào màn hình chính”** / *Add to Home screen*).
4. Xác nhận tên ứng dụng **“Hàng hóa gia đình”** và nhấn **Cài đặt**.
5. Biểu tượng ứng dụng hình hộp hàng sẽ xuất hiện trên màn hình chính của điện thoại, mở lên toàn màn hình độc lập (standalone mode) không thanh địa chỉ trình duyệt.

### Trên iOS / iPhone / iPad (Trình duyệt Apple Safari):
> Lưu ý: Trên iOS, tính năng thêm PWA ra màn hình chính hoạt động tốt nhất trên trình duyệt Safari mặc định.

1. Dùng **Safari** truy cập vào website của ứng dụng.
2. Nhấn vào biểu tượng **Chia sẻ** (hình vuông có mũi tên chỉ lên `↑` ở thanh công cụ dưới đáy màn hình).
3. Cuộn xuống danh sách các tác vụ và chọn **“Thêm vào MH chính”** (*Add to Home Screen*).
4. Ứng dụng sẽ hiển thị biểu tượng hộp hàng sắc nét kèm tên mặc định là **“Hàng hóa gia đình”**.
5. Nhấn **“Thêm”** (*Add*) ở góc trên bên phải.
6. Icon ứng dụng sẽ nằm trên màn hình chính iOS, hoạt động mượt mà như một ứng dụng gốc.
