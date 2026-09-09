# Family Inventory

Ứng dụng quản lý hàng hóa và tồn kho nội bộ cho gia đình (khoảng 5 thành viên), xây dựng bằng **Vite + React + TypeScript** và cơ sở dữ liệu **Supabase** với bảo mật cấp hàng (Row Level Security - RLS).

---

## 1. Tính năng chính

- **Quản lý hàng hóa**: Theo dõi mã hàng, mã vạch, giá nhập, giá bán, số lượng tồn kho (hỗ trợ cả đơn vị cân ký với 3 chữ số thập phân) và danh mục.
- **Tìm kiếm thông minh**: Tìm theo tên (hỗ trợ tiếng Việt không dấu, không phân biệt hoa/thường), mã hàng hoặc mã vạch cập nhật tức thì.
- **Phân quyền bảo mật (RLS)**:
  - Phân quyền trực tiếp từ bảng `public.family_members` trên máy chủ Supabase.
  - Thành viên đang hoạt động (`is_active = true`) và có quyền (`can_edit = true`) mới được thêm/sửa hàng hóa.
  - Thành viên xem (`can_edit = false`) chỉ được phép xem.
  - Tài khoản chưa được cấp quyền hoặc bị khóa sẽ không thể đọc bất kỳ dữ liệu nào.
  - Không cấp quyền xóa hàng hóa cho client để bảo toàn lịch sử.
- **Giao diện thân thiện Mobile (Mobile-first)**: Tối ưu chuẩn hiển thị trên điện thoại (không cuộn ngang ở 375px) và tự động co giãn lưới sản phẩm trên máy tính.

---

## 2. Yêu cầu môi trường

- **Node.js**: Phiên bản 18+ (khuyên dùng Node.js 20 LTS trở lên).
- **Trình quản lý gói**: `npm` (hoặc `pnpm`, `yarn`).
- **Dự án Supabase**: Đã tạo dự án và chạy migration tại [supabase/migrations/20260909000100_create_inventory.sql](supabase/migrations/20260909000100_create_inventory.sql).

---

## 3. Cấu hình biến môi trường

1. Tạo file `.env.local` tại thư mục gốc của dự án dựa trên file mẫu `.env.example`:
   ```bash
   cp .env.example .env.local
   ```

2. Điền thông tin kết nối từ Supabase Dashboard (**Project Settings** ➔ **API**):
   ```env
   VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-or-publishable-key>
   ```

> **Lưu ý bảo mật**:
> - File `.env.local` đã được cấu hình trong `.gitignore` để không bị đẩy lên kho mã nguồn Git.
> - Chỉ sử dụng khóa `anon` (hoặc `publishable key`). Tuyệt đối **không** dùng `service_role key` hay khóa bí mật quản trị trên ứng dụng client.

---

## 4. Cài đặt và Chạy ứng dụng

### Cài đặt thư viện:
```bash
npm install
```

### Chạy môi trường phát triển (Dev Server):
```bash
npm run dev
```
Ứng dụng sẽ chạy tại địa chỉ: `http://localhost:5173/`

### Kiểm tra mã nguồn (Lint):
```bash
npm run lint
```

### Đóng gói sản phẩm (Build):
```bash
npm run build
```

---

## 5. Quản lý Thành viên Gia đình

Sau khi người dùng tạo tài khoản trong **Supabase Authentication**, Quản trị viên cấp quyền truy cập bằng cách thêm một dòng vào bảng `public.family_members` qua **SQL Editor** trên Supabase Dashboard:

```sql
INSERT INTO public.family_members (user_id, display_name, can_edit, is_active)
VALUES ('<UUID_CỦA_NGƯỜI_DÙNG>', 'Tên Thành Viên', true, true);
```

- `can_edit = true`: Thành viên có quyền chỉnh sửa và thêm hàng hóa.
- `can_edit = false`: Thành viên chỉ có quyền xem danh sách hàng hóa.
- `is_active = false`: Khóa tài khoản thành viên (người dùng sẽ bị chặn truy cập danh mục sản phẩm ngay lập tức).

Chi tiết thiết kế schema và ma trận phân quyền được lưu trong tài liệu [docs/database.md](docs/database.md).
