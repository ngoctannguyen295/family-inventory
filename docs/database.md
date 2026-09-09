# Tài liệu Thiết kế Cơ sở Dữ liệu & Phân quyền (Family Inventory)

Tài liệu này mô tả cấu trúc bảng, cơ chế bảo mật cấp hàng (Row Level Security - RLS), ma trận phân quyền và quy trình vận hành cơ sở dữ liệu trên Supabase cho ứng dụng Family Inventory.

---

## 1. Cấu trúc bảng & Quan hệ

Hệ thống cơ sở dữ liệu gồm 2 bảng trong schema `public`:

### 1.1 Bảng `public.family_members`
Lưu trữ danh sách thành viên gia đình được phép truy cập ứng dụng.

- **`user_id`** (`uuid`, Primary Key): Khóa chính, tham chiếu trực tiếp đến `auth.users(id)` với ràng buộc `ON DELETE CASCADE`.
- **`display_name`** (`text`, NOT NULL): Tên hiển thị của thành viên (kiểm tra không được rỗng hoặc chỉ toàn khoảng trắng).
- **`can_edit`** (`boolean`, NOT NULL, default `false`): Quyền thao tác (sửa/thêm hàng hóa). Mặc định chỉ có quyền xem.
- **`is_active`** (`boolean`, NOT NULL, default `true`): Trạng thái tài khoản thành viên (đang hoạt động hay bị khóa).
- **`created_at`** (`timestamptz`, NOT NULL, default `now()`): Thời điểm cấp quyền thành viên.

### 1.2 Bảng `public.products`
Lưu trữ thông tin hàng hóa, mã số định danh, giá nhập, giá bán và số lượng tồn kho.

- **`id`** (`uuid`, Primary Key, default `gen_random_uuid()`): Định danh duy nhất của sản phẩm.
- **`code`** (`text`, NOT NULL, UNIQUE): Mã hàng hóa nội bộ (chuỗi không rỗng, giữ được số `0` ở đầu như `00101`).
- **`barcode`** (`text`, Nullable, UNIQUE): Mã vạch chuẩn (EAN/UPC). Dùng giá trị `NULL` khi sản phẩm chưa có mã vạch; nếu có thì không được để chuỗi rỗng và không được trùng lặp.
- **`name`** (`text`, NOT NULL): Tên sản phẩm (không để rỗng).
- **`category`** (`text`, NOT NULL): Danh mục hàng hóa (ví dụ: *Gia vị & Dầu ăn*, *Lương thực & Đồ khô*).
- **`unit`** (`text`, NOT NULL): Đơn vị tính (ví dụ: gói, chai, lon, kg, túi).
- **`image_url`** (`text`, Nullable): Đường dẫn ảnh đại diện sản phẩm.
- **`purchase_price`** (`numeric(14,2)`, NOT NULL): Giá nhập (VNĐ), ràng buộc `>= 0`.
- **`sale_price`** (`numeric(14,2)`, NOT NULL): Giá bán (VNĐ), ràng buộc `>= 0`.
- **`stock`** (`numeric(14,3)`, NOT NULL, default `0`): Số lượng tồn kho, ràng buộc `>= 0`. Định dạng 3 chữ số thập phân cho phép quản lý cả hàng hóa cân ký (ví dụ: `2.500 kg`).
- **`notes`** (`text`, NOT NULL, default `''`): Ghi chú bổ sung.
- **`created_at`** (`timestamptz`, NOT NULL, default `now()`): Thời điểm tạo.
- **`updated_at`** (`timestamptz`, NOT NULL, default `now()`): Tự động cập nhật qua trigger `trg_products_updated_at` mỗi khi bản ghi bị thay đổi.

---

## 2. Ma trận Phân quyền (Permission Matrix)

Hệ thống bảo vệ toàn diện bằng RLS và quản lý quyền trực tiếp từ bảng `family_members`, hoàn toàn không dựa vào `user_metadata` ở client:

| Vai trò người dùng | Đọc `family_members` | Ghi `family_members` | Xem `products` (SELECT) | Thêm `products` (INSERT) | Sửa `products` (UPDATE) | Xóa `products` (DELETE) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Khách vãng lai (`anon`)** | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối |
| **Đã đăng nhập nhưng chưa cấp quyền** *(Không có dòng trong `family_members`)* | ❌ Rỗng (0 dòng) | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối |
| **Thành viên bị khóa** *(`is_active = false`)* | ✅ Xem thông tin mình | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối |
| **Thành viên chỉ xem** *(`is_active = true, can_edit = false`)* | ✅ Xem thông tin mình | ❌ Từ chối | ✅ Được xem toàn bộ | ❌ Từ chối | ❌ Từ chối | ❌ Từ chối |
| **Thành viên chỉnh sửa** *(`is_active = true, can_edit = true`)* | ✅ Xem thông tin mình | ❌ Từ chối | ✅ Được xem toàn bộ | ✅ Được thêm mới | ✅ Được chỉnh sửa | ❌ Từ chối (Không cấp) |

> **Lưu ý bảo mật quan trọng:**
> - Toàn bộ thao tác thêm mới/phân quyền thành viên (`family_members`) được quản lý trong Supabase Dashboard / SQL Editor của Quản trị viên, không cấp quyền INSERT/UPDATE/DELETE cho client.
> - Bảng `products` không cấp quyền và không tạo policy `DELETE` nhằm tránh rủi ro xóa nhầm lịch sử dữ liệu hàng hóa.

---

## 3. Hướng dẫn Chạy Migration Thủ công bằng SQL Editor

Khi chưa cấu hình kết nối Supabase CLI tự động, bạn có thể chạy migration trực tiếp trên giao diện Supabase:

1. Đăng nhập vào [Supabase Dashboard](https://supabase.com/dashboard).
2. Chọn dự án **Family Inventory**.
3. Ở menu thanh bên trái, chọn biểu tượng **SQL Editor**.
4. Nhấn **New query**.
5. Mở file [supabase/migrations/20260909000100_create_inventory.sql](file:///c:/Users/Ngoc%20Tan/Projects/family-inventory/supabase/migrations/20260909000100_create_inventory.sql), sao chép toàn bộ nội dung và dán vào khung soạn thảo query.
6. Nhấn nút **Run** (hoặc `Ctrl + Enter` / `Cmd + Enter`).
7. Xác nhận thông báo thực thi thành công (`Success. No rows returned`).

### ⚠️ Lưu ý về Lịch sử Migration (Supabase CLI)
- Khi bạn chạy mã SQL trực tiếp trong **SQL Editor**, Supabase sẽ thực thi DDL ngay vào cơ sở dữ liệu, nhưng **chưa tự động ghi nhận phiên bản này vào bảng lịch sử `supabase_migrations.schema_migrations` của Supabase CLI**.
- Nếu sau này bạn sử dụng Supabase CLI cục bộ (ví dụ lệnh `supabase db push` hoặc `supabase migration up`), bạn có thể dùng cờ `--include-all` hoặc cập nhật trạng thái migration bằng `supabase migration repair --status applied 20260909000100` để CLI đồng bộ với cơ sở dữ liệu trên cloud.

---

## 4. Danh sách Tình huống Cần Kiểm thử RLS Sau Khi Áp Dụng

Sau khi chạy migration và tạo tài khoản thử nghiệm trên Authentication, hãy kiểm tra các kịch bản sau:

1. **Kiểm tra truy cập ẩn danh (Anon)**:
   - Dùng Anon Key gọi `supabase.from('products').select('*')` ➔ Kết quả: Lỗi hoặc trả về mảng rỗng `[]`.
   - Dùng Anon Key gọi `supabase.from('family_members').select('*')` ➔ Kết quả: Lỗi hoặc rỗng `[]`.

2. **Kiểm tra tài khoản mới đăng ký nhưng chưa cấp quyền**:
   - Đăng nhập tài khoản mới chưa được thêm vào `family_members`.
   - Gọi truy vấn `products` ➔ Kết quả: Rỗng `[]`.
   - Gọi truy vấn `family_members` ➔ Kết quả: Rỗng `[]`.

3. **Kiểm tra thành viên chỉ xem (`is_active = true, can_edit = false`)**:
   - Đăng nhập tài khoản.
   - Thêm bản ghi vào `family_members` qua SQL Editor:
     ```sql
     INSERT INTO public.family_members (user_id, display_name, can_edit, is_active)
     VALUES ('<UID_CỦA_USER>', 'Thành viên Xem', false, true);
     ```
   - Gọi `products.select('*')` ➔ Xem được danh sách sản phẩm.
   - Thử thêm mới hoặc cập nhật `products` ➔ Bị RLS chặn (lỗi permission denied hoặc 0 dòng cập nhật).

4. **Kiểm tra thành viên có quyền chỉnh sửa (`can_edit = true`)**:
   - Cập nhật tài khoản sang `can_edit = true`.
   - Thử thực hiện `INSERT` sản phẩm mới ➔ Thành công.
   - Thử `UPDATE` giá bán hoặc tồn kho của sản phẩm ➔ Thành công; kiểm tra trường `updated_at` tự động cập nhật thời gian mới hơn `created_at`.
   - Thử thực hiện lệnh `DELETE` sản phẩm ➔ Thất bại (bị từ chối do không có quyền).

5. **Kiểm tra thành viên bị khóa (`is_active = false`)**:
   - Cập nhật `is_active = false`.
   - Thử đọc danh sách `products` ➔ Lập tức trả về rỗng `[]`, không đọc được bất kỳ sản phẩm nào.

---

## 5. Quản lý Lưu trữ Ảnh Sản phẩm (Supabase Storage)

Migration: [supabase/migrations/20260910000100_storage_product_images.sql](file:///c:/Users/Ngoc%20Tan/Projects/family-inventory/supabase/migrations/20260910000100_storage_product_images.sql)

> ⚠️ **Trạng thái kiểm thử:** *Chưa kiểm thử thực tế trên hệ thống đang chạy (Pending live verification).* Migration mới được khởi tạo và đang chờ áp dụng trên Supabase Dashboard / SQL Editor.

### 5.1 Cấu hình Bucket `product-images`
- **Chế độ truy cập:** Private (`public = false`). Mọi yêu cầu truy cập xem ảnh đều phải thông qua xác thực (Signed URL hoặc request có header xác thực thành viên).
- **Dung lượng tối đa mỗi file:** 5 MB (`5,242,880` bytes).
- **Định dạng file cho phép:** `image/jpeg`, `image/png`, `image/webp`.

### 5.2 Ma trận Quyền trên `storage.objects`

| Thao tác Storage | Đối tượng được phép | Điều kiện kiểm tra RLS | Ghi chú |
|---|---|---|---|
| **SELECT (Xem/Tải ảnh)** | Thành viên gia đình đang hoạt động (`is_active = true`) | `bucket_id = 'product-images'` VÀ tồn tại bản ghi trong `public.family_members` có `user_id = auth.uid()` và `is_active = true` | Thành viên được xem toàn bộ ảnh trong bucket do bất kỳ thành viên nào tải lên |
| **INSERT (Tải ảnh lên)** | Thành viên có quyền chỉnh sửa (`is_active = true, can_edit = true`) | `bucket_id = 'product-images'` VÀ `can_edit = true` VÀ `(storage.foldername(name))[1] = auth.uid()::text` | Thư mục đầu tiên trong đường dẫn bắt buộc phải là UID của người đang tải lên |
| **UPDATE (Ghi đè file)** | ❌ Không cấp | Không có policy UPDATE | Tránh rủi ro ghi đè file ngoài ý muốn |
| **DELETE (Xóa file)** | ❌ Không cấp | Không có policy DELETE | Không cho phép xóa trực tiếp từ client ở bước này |

### 5.3 Quy ước Đường dẫn File (Storage Path Convention)
Đường dẫn đối tượng trong bucket `product-images` tuân thủ nghiêm ngặt quy tắc phân cấp theo UID thành viên:

```text
<user-id>/<random-uuid>.<extension>
```

Ví dụ:
`c9f30b91-49b8-4c8d-8153-f72535798993/7b5d1a2c-e549-4b87-9d7a-115f5c88e04b.webp`

- `<user-id>`: Chuỗi UUID của người dùng đang đăng nhập (`auth.uid()`). Điều này đảm bảo tính bảo mật khi tải lên (kiểm tra bởi RLS `storage.foldername(name)[1]`).
- `<random-uuid>`: Chuỗi UUID ngẫu nhiên v4 cho mỗi lần upload, giúp tên file không trùng lặp và không lộ tên file gốc từ máy người dùng.
- `<extension>`: Đuôi file hợp lệ (`jpg`, `jpeg`, `png`, `webp`).

### 5.4 Quy tắc Lưu trữ trong Bảng `public.products`
- Cột `image_url` trong bảng `public.products` **chỉ lưu đường dẫn file tương đối trong bucket** (ví dụ: `c9f30b91-49b8.../7b5d1a2c...webp`), hoặc giá trị `NULL` nếu sản phẩm chưa có ảnh.
- **Tuyệt đối không lưu Signed URL** vào cơ sở dữ liệu vì Signed URL luôn có thời hạn hết hạn (TTL). Khi giao diện cần hiển thị ảnh, client sẽ dùng Supabase SDK để tạo Signed URL ngắn hạn từ đường dẫn file đã lưu.

### 5.5 Cơ chế Thay ảnh và Dọn dẹp File Rác (Orphaned Files)
- **Khi thay đổi ảnh sản phẩm:** Ứng dụng sẽ tải file mới lên với UUID mới và tham số `upsert = false`. Sau khi tải lên thành công, client cập nhật trường `image_url` của sản phẩm sang đường dẫn mới.
- **Dọn dẹp ảnh cũ:** File ảnh cũ vẫn sẽ nằm trong bucket và chưa tự động xóa ở bước này.
- **File mồ côi (Orphaned files):** Trong trường hợp người dùng chọn tải ảnh lên nhưng sau đó hủy form lưu sản phẩm, file đó đã tồn tại trong bucket nhưng không gắn với sản phẩm nào. Một tiến trình dọn dẹp định kỳ (Storage cleanup cron job / Edge Function) sẽ được thiết kế ở các giai đoạn tiếp theo để quét và xóa các file mồ côi này.
