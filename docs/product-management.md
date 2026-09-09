# Hướng dẫn Quản lý Sản phẩm (Thêm & Chỉnh sửa)

Tài liệu này hướng dẫn cách kiểm thử và sử dụng tính năng **Thêm mới** và **Chỉnh sửa sản phẩm** trong ứng dụng Family Inventory, giải thích cách dữ liệu được xác thực và bảo vệ qua hai lớp (Giao diện Client & Chính sách RLS trên Supabase).

---

## 1. Phân quyền Người dùng

- **Thành viên có quyền chỉnh sửa (`can_edit = true`, `is_active = true`)**:
  - Nhìn thấy nút **"+ Thêm sản phẩm"** trên đầu trang (Header) và nút **"Chỉnh sửa"** trên từng thẻ sản phẩm.
  - Được phép gửi lệnh `INSERT` và `UPDATE` lên Supabase.
- **Thành viên chỉ xem (`can_edit = false`, `is_active = true`)**:
  - Không nhìn thấy nút "+ Thêm sản phẩm" hay "Chỉnh sửa".
  - Vẫn tra cứu, lọc danh mục và xem chi tiết tồn kho bình thường.
  - Nếu cố tình gọi API ghi, chính sách RLS tại máy chủ sẽ từ chối với lỗi `42501 (Permission denied)`.
- **Tài khoản bị khóa (`is_active = false`)**:
  - Bị chặn ở màn hình đăng nhập, không đọc được dữ liệu.

---

## 2. Quy tắc Kiểm tra Dữ liệu trên Form

Form dùng chung cho cả Thêm và Sửa sản phẩm thực hiện kiểm tra nghiêm ngặt:

1. **Chuỗi văn bản (Mã hàng, Tên sản phẩm, Danh mục, Đơn vị tính)**:
   - Tự động cắt khoảng trắng đầu/cuối (`trim()`).
   - Từ chối chuỗi chỉ chứa toàn dấu cách hoặc để trống.
   - `code` luôn là dạng chuỗi `string`, bảo toàn các số 0 ở đầu (ví dụ: `00101`).

2. **Mã vạch (`barcode`)**:
   - Trường tùy chọn (không bắt buộc).
   - Nếu người dùng không nhập gì hoặc nhập toàn khoảng trắng, giá trị gửi lên cơ sở dữ liệu sẽ tự động chuyển thành `null`.

3. **Giá nhập & Giá bán (`purchase_price`, `sale_price`)**:
   - Bắt buộc nhập, phải là số `>= 0`.
   - Tối đa 2 chữ số thập phân (khớp với kiểu `numeric(14,2)` trong schema).
   - Giá trị tối đa: `999.999.999.999,99` (dưới $10^{12}$).
   - Từ chối `NaN`, `Infinity`, chữ cái hoặc định dạng không hợp lệ. Không tự ý biến ô trống thành số 0.
   - **Cảnh báo bán lỗ**: Nếu `Giá bán < Giá nhập`, form hiển thị khung cảnh báo màu vàng (*"Lưu ý: Giá bán đang thấp hơn giá nhập"*), nhưng vẫn cho phép lưu nếu người dùng có chủ đích.

4. **Số lượng tồn kho (`stock`)**:
   - Bắt buộc nhập, phải là số `>= 0`.
   - Tối đa 3 chữ số thập phân (khớp với kiểu `numeric(14,3)` để hỗ trợ hàng hóa cân ký, ví dụ: `2.500` kg).
   - Giá trị tối đa: `99.999.999.999,999` (dưới $10^{11}$).
   - Thao tác chỉnh sửa tồn kho là **thay thế trực tiếp** bằng giá trị người dùng nhập, không thực hiện phép cộng/trừ dồn.

5. **Trùng lặp Mã hàng hoặc Mã vạch**:
   - Khi Supabase trả về lỗi mã trùng (`23505`), ứng dụng bắt lỗi và hiển thị thông báo tiếng Việt chính xác:
     - *"Mã hàng này đã tồn tại trên hệ thống. Vui lòng kiểm tra hoặc đổi mã khác."*
     - *"Mã vạch này đã được gán cho một sản phẩm khác."*
   - Toàn bộ dữ liệu đang nhập trên form được **giữ nguyên**, không bị xóa mất để người dùng dễ dàng chỉnh sửa lại.

6. **Ảnh đại diện (`image_url`)**:
   - Trường tùy chọn (không bắt buộc).
   - Chấp nhận các định dạng ảnh: JPEG, PNG, WebP với dung lượng tối đa **5 MB**.
   - Kiểm tra định dạng: Bắt lỗi nếu là HEIC/HEIF hoặc loại không hỗ trợ, yêu cầu người dùng chuyển đổi trước khi tải lên (không tự ý đổi đuôi file).
   - Xem trước ảnh bằng `object URL`, tự động thu hồi khi đổi ảnh, bấm bỏ ảnh hoặc đóng form.
   - Nút **"Bỏ ảnh vừa chọn"**: Cho phép người dùng hủy chọn để quay lại ảnh ban đầu (ảnh cũ hoặc không có ảnh).
   - Lưu trữ: Cột `products.image_url` chỉ lưu **đường dẫn tương đối trong bucket** (`<user-id>/<uuid>.<ext>`), không lưu blob URL hay signed URL có thời hạn.
   - Hiển thị: Tải Blob từ private bucket qua SDK `supabase.storage.from('product-images').download(path)` và cache trong bộ nhớ trình duyệt, có placeholder dự phòng khi chưa có ảnh hoặc tải lỗi.

---

## 3. Các Tình huống Kiểm thử Đề xuất

Sau khi đăng nhập bằng tài khoản có quyền `can_edit = true`, hãy thử nghiệm các kịch bản sau trên trình duyệt:

### Kịch bản 1: Thêm sản phẩm đầu tiên thành công
1. Nhấn nút **"+ Thêm sản phẩm"** (hoặc nút trên màn hình Chưa có sản phẩm).
2. Điền thông tin:
   - Mã hàng: `00101` (xác nhận số 0 ở đầu được giữ).
   - Tên sản phẩm: `Gạo ST25 Ông Cua Túi 5kg`.
   - Danh mục: Gõ `Lương thực` (danh mục mới).
   - Đơn vị tính: `túi`.
   - Giá nhập: `170000`.
   - Giá bán: `195000`.
   - Tồn kho: `15`.
3. Nhấn **Thêm sản phẩm**.
4. **Kết quả**: Modal đóng, hiển thị thông báo toast màu xanh lá *"Đã thêm "Gạo ST25..." thành công"*, danh sách xuất hiện thẻ sản phẩm mới, tổng số lượng tăng lên 1, danh mục `Lương thực` tự động được bổ sung vào bộ lọc.

### Kịch bản 2: Thêm sản phẩm bán theo cân (số lẻ 3 chữ số thập phân)
1. Thêm sản phẩm:
   - Mã hàng: `00102`.
   - Tên: `Đường phèn Quảng Ngãi`.
   - Danh mục: `Lương thực`.
   - Đơn vị tính: `kg`.
   - Giá nhập: `35000`.
   - Giá bán: `42000`.
   - Tồn kho: `2.750`.
2. **Kết quả**: Sản phẩm lưu thành công, thẻ hiển thị `Tồn: 2.75 kg`.

### Kịch bản 3: Cảnh báo giá bán thấp hơn giá nhập
1. Nhập sản phẩm với Giá nhập = `50000`, Giá bán = `40000`.
2. Quan sát thấy khung cảnh báo màu vàng xuất hiện ngay lập tức trên form.
3. Nhấn nút Lưu: Form vẫn cho phép lưu thành công bình thường.

### Kịch bản 4: Kiểm tra chống trùng mã hàng
1. Mở modal thêm mới, nhập lại mã hàng `00101` đã tồn tại từ Kịch bản 1.
2. Nhấn nút Lưu.
3. **Kết quả**: Xuất hiện thông báo lỗi đỏ: *"Mã hàng này đã tồn tại trên hệ thống..."*. Toàn bộ thông tin vừa nhập trên form vẫn được giữ nguyên.

### Kịch bản 5: Chỉnh sửa sản phẩm & Thay đổi tồn kho
1. Trên thẻ sản phẩm vừa tạo, nhấn nút **"Chỉnh sửa"**.
2. Modal mở lên với toàn bộ dữ liệu của sản phẩm đó đã được điền sẵn.
3. Đổi số lượng tồn kho từ `15` thành `0`.
4. Nhấn **Lưu thay đổi**.
5. **Kết quả**: Thẻ sản phẩm lập tức chuyển sang trạng thái huy hiệu đỏ **"Hết hàng" (0 túi)**.

### Kịch bản 6: Thêm sản phẩm khi đang áp dụng bộ lọc (Thông báo ẩn)
1. Trên thanh tìm kiếm, gõ từ khóa `nước mắm`.
2. Mở modal và thêm sản phẩm `Mì Hảo Hảo` (mã `00201`).
3. Nhấn nút Lưu.
4. **Kết quả**: Xuất hiện thông báo toast: *"Đã thêm "Mì Hảo Hảo" thành công, nhưng sản phẩm đang bị ẩn bởi bộ lọc hiện tại"* kèm nút bấm *"Xóa bộ lọc để xem"*. Bấm vào nút này, từ khóa tìm kiếm được xóa và thẻ sản phẩm mới xuất hiện ngay trên màn hình.

### Kịch bản 7: Kiểm thử điều hướng bàn phím & Tiếp cận (Accessibility)
1. Nhấn nút "+ Thêm sản phẩm": Con trỏ bàn phím (focus) tự động nhảy vào ô "Mã hàng".
2. Nhấn phím `Escape`: Cửa sổ modal lập tức đóng lại, và focus tự động quay trở về nút "+ Thêm sản phẩm".

---

## 4. Kịch bản Kiểm thử Tính năng Ảnh Sản phẩm (Supabase Storage)

> ⚠️ **Trạng thái:** *Mã nguồn đã hoàn tất và vượt qua toàn bộ lint/build, nhưng chưa kiểm thử thực tế với mạng thật trên bucket Supabase Storage.*

### Kịch bản 8: Chọn ảnh hợp lệ và xem trước (Preview)
1. Mở form "+ Thêm sản phẩm".
2. Bấm nút **"Chọn ảnh từ máy"** và chọn một file ảnh hợp lệ (JPG, PNG hoặc WebP, dung lượng dưới 5 MB).
3. **Kết quả**:
   - Khung thumbnail xem trước hiển thị ngay lập tức hình ảnh vừa chọn.
   - Hiển thị tên file và dung lượng (KB).
   - Nút chọn đổi thành **"Đổi ảnh khác"** và xuất hiện thêm nút **"✕ Bỏ ảnh vừa chọn"**.

### Kịch bản 9: Từ chối ảnh vượt dung lượng và định dạng không hỗ trợ (HEIC/HEIF)
1. Thử chọn một file ảnh có dung lượng lớn hơn 5 MB:
   - **Kết quả**: Báo lỗi đỏ *"Dung lượng file ảnh (... MB) vượt quá giới hạn tối đa cho phép là 5 MB."*, không tạo preview và reset input file.
2. Thử chọn một file ảnh có đuôi `.heic` hoặc `.heif` (ảnh từ iPhone/iPad):
   - **Kết quả**: Báo lỗi đỏ *"Định dạng ảnh HEIC/HEIF chưa được hỗ trợ trực tiếp trên trình duyệt. Vui lòng chuyển đổi ảnh sang định dạng JPEG, PNG hoặc WebP trước khi tải lên (không tự ý đổi đuôi file)."*.

### Kịch bản 10: Hủy ảnh vừa chọn (Nút "Bỏ ảnh vừa chọn")
1. Chọn một file ảnh để xem trước.
2. Bấm nút **"✕ Bỏ ảnh vừa chọn"**.
3. **Kết quả**: Vùng xem trước quay về ảnh placeholder mặc định, input file được làm sạch, object URL xem trước được thu hồi khỏi bộ nhớ.

### Kịch bản 11: Quy trình Tải ảnh lên và Lưu sản phẩm mới
1. Điền đầy đủ các trường thông tin sản phẩm và chọn 1 ảnh hợp lệ.
2. Bấm nút **"Thêm sản phẩm"**.
3. **Kết quả**:
   - Nút chuyển sang trạng thái: *"Đang tải ảnh lên..."* ➔ *"Đang lưu sản phẩm..."*.
   - Ảnh được tải lên Storage tại đường dẫn `<user-id>/<random-uuid>.<ext>`.
   - Sản phẩm được lưu vào bảng `products` với cột `image_url` là đường dẫn tương đối vừa tạo.
   - Thẻ sản phẩm mới trên màn hình chính hiển thị đúng hình ảnh vừa tải lên từ bucket riêng tư.

### Kịch bản 12: Chỉnh sửa sản phẩm có ảnh (Giữ nguyên hoặc Thay mới)
1. Bấm **"Chỉnh sửa"** trên thẻ sản phẩm đã có ảnh:
   - Khung xem trước hiển thị ảnh đang lưu của sản phẩm đó.
   - Dưới có dòng chữ *"Để nguyên nếu muốn giữ ảnh cũ"*.
2. **Trường hợp A (Giữ ảnh cũ)**: Chỉ sửa giá bán hoặc tồn kho, không chọn ảnh mới ➔ Bấm Lưu ➔ Sản phẩm cập nhật thành công và vẫn giữ nguyên ảnh cũ.
3. **Trường hợp B (Thay ảnh mới)**: Bấm **"Thay ảnh mới"**, chọn file ảnh khác ➔ Khung xem trước chuyển sang ảnh mới ➔ Bấm Lưu ➔ Sản phẩm cập nhật sang ảnh mới.

### Kịch bản 13: Hiệu năng bộ nhớ đệm (In-Memory Image Cache)
1. Khi danh sách đã tải xong các hình ảnh, thử gõ từ khóa vào ô tìm kiếm hoặc chuyển đổi bộ lọc danh mục.
2. **Kết quả**: Các thẻ sản phẩm lọc tức thì mà **không bị tải lại ảnh từ máy chủ hay nhấp nháy trắng** nhờ cơ chế In-Memory Object URL Cache.
3. Đăng xuất khỏi tài khoản: Toàn bộ Object URL được tự động thu hồi (`URL.revokeObjectURL`) và dọn dẹp sạch sẽ khỏi RAM trình duyệt.

