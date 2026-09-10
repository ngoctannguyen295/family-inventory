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

---

## 5. Kịch bản Kiểm thử Giao diện Lịch sử Thay đổi Sản phẩm (Product History)

Hệ thống ghi nhận nhật ký tự động vào bảng `public.product_history` qua trigger cơ sở dữ liệu mỗi khi sản phẩm được tạo mới (`create`) hoặc cập nhật (`update`).

### 5.1 Quyền xem lịch sử
- **Tất cả thành viên gia đình đang hoạt động (`is_active = true`)** đều nhìn thấy nút **"Lịch sử"** trên thẻ sản phẩm và có quyền mở xem nhật ký thay đổi.
- Thành viên chỉ xem (`can_edit = false`) vẫn xem được đầy đủ lịch sử của mọi sản phẩm.
- Chính sách RLS trên Supabase bảo vệ quyền `SELECT` độc lập ở tầng máy chủ.

---

### 5.2 Các Kịch bản Kiểm thử Giao diện

#### Kịch bản 14: Xem nhật ký tạo mới sản phẩm (Create)
1. Trên thẻ một sản phẩm vừa được tạo gần đây, bấm nút **"Lịch sử"** (icon 🕒).
2. **Kết quả**:
   - Modal mở lên với tiêu đề hiển thị tên sản phẩm và mã hàng (ví dụ: `[00101] Gạo ST25 Ông Cua Túi 5kg`).
   - Xuất hiện bản ghi tạo mới với huy hiệu màu xanh lá **"Tạo sản phẩm"**.
   - Hiển thị người thực hiện (`actor_name`) và thời gian ghi nhận theo định dạng ngày giờ Việt Nam kèm chú thích `(Giờ Việt Nam)`.
   - Danh sách chi tiết thể hiện toàn bộ giá trị ban đầu: Mã hàng, Tên sản phẩm, Danh mục, Đơn vị tính, Giá nhập, Giá bán, Tồn kho ban đầu, Mã vạch (nếu có), Ghi chú (nếu có) và trạng thái ảnh ("Có ảnh" hoặc "Chưa có ảnh").
   - Giá hiển thị định dạng tiền tệ `₫`, số tồn kho giữ đúng định dạng thập phân và gắn kèm đơn vị tính tại thời điểm tạo.

#### Kịch bản 15: Xem nhật ký cập nhật sản phẩm (Update)
1. Bấm **"Chỉnh sửa"** một sản phẩm: thay đổi giá bán từ `195.000` thành `200.000` và tồn kho từ `15` thành `10`, sau đó bấm **"Lưu thay đổi"**.
2. Bấm nút **"Lịch sử"** của sản phẩm đó:
3. **Kết quả**:
   - Dòng thời gian hiển thị bản ghi mới nhất ở trên cùng với huy hiệu màu xanh dương **"Cập nhật sản phẩm"**.
   - Chỉ hiển thị các trường có sự thay đổi:
     - **Giá bán**: `195.000 ₫` ➔ `200.000 ₫`
     - **Số lượng tồn kho**: `15 túi` ➔ `10 túi`
   - Các trường không thay đổi (như Tên, Đơn vị tính, Ghi chú) được ẩn đi để nhật ký ngắn gọn, trực quan.

#### Kịch bản 16: Thay đổi ảnh sản phẩm trong nhật ký
1. Chỉnh sửa một sản phẩm để thêm ảnh mới hoặc thay thế ảnh cũ.
2. Mở modal **"Lịch sử"**:
3. **Kết quả**:
   - Trường **Ảnh sản phẩm** hiển thị rõ ràng:
     - Nếu thêm ảnh mới cho sản phẩm trước đó chưa có ảnh: `Chưa có ảnh` ➔ `Có ảnh`.
     - Nếu đổi sang ảnh khác: `Đã thay ảnh`.
   - Tuyệt đối **không hiển thị** chuỗi đường dẫn Storage thô hay ký tự JSON khó hiểu.

#### Kịch bản 17: Phân trang và tải thêm nhật ký (Load More)
1. Với sản phẩm có hơn 20 lần chỉnh sửa:
2. Modal mở ban đầu tải đúng **20 bản ghi** mới nhất.
3. Cuối danh sách hiển thị nút **"Tải thêm lịch sử"**.
4. Bấm nút: tải tiếp trang kế tiếp (thêm 20 bản ghi) và nối liền vào dòng thời gian mà không bị nhảy trang.
5. Khi đã tải hết toàn bộ lịch sử: nút tải thêm tự động ẩn đi.
6. Đóng modal và mở lại: danh sách được làm mới và tải lại từ đầu.

#### Kịch bản 18: Trạng thái trống và trạng thái lỗi mạng
1. Mở lịch sử của sản phẩm cũ được tạo trước khi bật hệ thống trigger:
   - **Kết quả**: Hiển thị bảng thông báo trống: *"Chưa có lịch sử thay đổi"* kèm chú thích *"Lịch sử chỉ ghi nhận từ khi tính năng được kích hoạt trên hệ thống"*.
2. Nếu mất kết nối mạng trong lúc mở modal:
   - **Kết quả**: Hiển thị thông báo lỗi thân thiện kèm nút **"Thử lại"**. Bấm nút này hệ thống tự động gửi lại truy vấn.

#### Kịch bản 19: Điều hướng bàn phím & Bảo mật phiên làm việc
1. Nhấn phím `Escape` khi modal lịch sử đang mở:
   - **Kết quả**: Modal đóng ngay lập tức, tiêu điểm bàn phím (focus) tự động quay về nút "Lịch sử" của thẻ sản phẩm vừa thao tác.
2. Khi đang mở modal lịch sử mà tài khoản bị đăng xuất hoặc hết hạn phiên:
   - **Kết quả**: Modal lịch sử tự động đóng ngay lập tức, dữ liệu trong modal được xóa để đảm bảo an toàn thông tin.

---

## 6. Hướng dẫn và Kịch bản Kiểm thử Quét Mã vạch (Barcode Scanner)

Tính năng quét mã vạch hỗ trợ toàn bộ thành viên đang hoạt động (`is_active = true`), kể cả thành viên chỉ xem, tra cứu tức thì thông tin sản phẩm trong kho bằng 3 phương thức: **Camera**, **Chọn ảnh có mã vạch** và **Nhập mã thủ công**.

### 6.1 Cơ chế kỹ thuật & Định dạng hỗ trợ
- **Thư viện**: Sử dụng `html5-qrcode` (phiên bản `2.3.8`) được **lazy-load** độc lập qua dynamic import để tối ưu tốc độ tải trang ban đầu.
- **Định dạng mã vạch hỗ trợ**: `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E` và `CODE-128`.
- **An toàn Camera**:
  - Chỉ xin quyền truy cập khi người dùng bấm nút *"Bắt đầu quét bằng camera"*.
  - Ưu tiên camera sau (`facingMode: "environment"`). Có bộ chọn đổi camera nếu thiết bị có từ 2 camera trở lên.
  - Tự động dừng camera và giải phóng tài nguyên khi đóng modal, đổi tab, unmount hoặc đăng xuất.
  - Xử lý race condition khi đóng modal lúc camera đang khởi động (`isStartingRef`).
  - Bỏ qua lỗi per-frame, chỉ nhận diện và dừng camera khi đọc mã thành công 1 lần duy nhất.
- **Xử lý Ảnh trên máy**:
  - Quét mã từ ảnh (`scanFile`) hoàn toàn tại client (trình duyệt). Tuyệt đối **không tải ảnh quét lên Supabase Storage**.
  - Giới hạn dung lượng 5 MB, định dạng JPEG, PNG, WebP.
- **Tra cứu Cơ sở Dữ liệu**:
  - Mã đọc được lưu dưới dạng chuỗi `string`, cắt khoảng trắng 2 đầu và **bảo toàn các số 0 ở đầu**.
  - Truy vấn khớp chính xác trực tiếp vào bảng `public.products` (`barcode = cleanCode`), không bị giới hạn bởi bộ lọc danh mục hiện tại.

---

### 6.2 Các Kịch bản Kiểm thử Đề xuất

#### Kịch bản 20: Mở modal quét mã vạch và chuyển đổi các chế độ
1. Bấm nút **"Quét mã"** (icon Barcode) cạnh ô tìm kiếm hoặc nút *"Quét mã vạch tra cứu"* khi kho hàng đang trống.
2. **Kết quả**:
   - Modal mở lên với 3 tab: **"📷 Dùng camera"**, **"🖼️ Chọn ảnh có mã vạch"**, **"⌨️ Nhập mã thủ công"**.
   - Tab Camera hiển thị khung ngắm cùng nút *"Bắt đầu quét bằng camera"*. Camera chưa tự ý bật khi người dùng chưa bấm nút.
   - Chuyển lần lượt giữa 3 tab: giao diện chuyển đổi mượt mà, không bị xung đột camera.

#### Kịch bản 21: Nhập mã thủ công tìm sản phẩm đã có
1. Chọn tab **"Nhập mã thủ công"**.
2. Nhập mã vạch của sản phẩm đã lưu (ví dụ: `8935001234567` hoặc mã hàng/mã vạch mẫu).
3. Bấm **"Tìm sản phẩm"** (hoặc nhấn phím `Enter`):
4. **Kết quả**:
   - Hệ thống hiển thị thẻ sản phẩm chi tiết: ảnh đại diện (nếu có), tên sản phẩm, mã hàng, mã vạch, giá nhập, giá bán (`₫`), tồn kho kèm đơn vị tính.
   - Có nút **"Xem trong danh sách"**: bấm vào sẽ đóng modal và lọc danh sách sản phẩm theo mã vừa tìm.
   - Có nút **"Quét mã khác"**: bấm vào sẽ reset trạng thái để sẵn sàng quét lượt mới.

#### Kịch bản 22: Tra cứu mã vạch chưa có trong danh mục kho
1. Nhập một mã vạch bất kỳ chưa có trong kho (ví dụ: `8939999999999`).
2. Bấm **"Tìm sản phẩm"**:
3. **Kết quả**:
   - Hiển thị thẻ thông báo thân thiện: *"Chưa có sản phẩm mang mã 8939999999999"* kèm chú thích *"Mã vạch này chưa được gán cho mặt hàng nào trong danh mục kho gia đình"*.
   - Hệ thống **không tự ý tạo sản phẩm mới**.
   - Có nút *"Quét lại hoặc nhập mã khác"* để người dùng tiếp tục thao tác.

#### Kịch bản 23: Đọc mã từ ảnh có chứa mã vạch (File scan)
1. Chuyển sang tab **"Chọn ảnh có mã vạch"**.
2. Bấm **"Chọn ảnh có mã vạch"** và chọn một file ảnh chụp bao bì/mã vạch rõ nét (JPG, PNG, WebP dưới 5 MB).
3. **Kết quả**:
   - Trạng thái chuyển sang *"Đang quét mã từ ảnh..."*.
   - Quét thành công: hệ thống trích xuất mã và tự động tra cứu sản phẩm trong kho.
   - Nếu chọn file ảnh không chứa mã vạch rõ ràng: hệ thống báo lỗi *"Không tìm thấy mã vạch hợp lệ trong ảnh này. Vui lòng chọn ảnh chụp rõ nét, đủ ánh sáng hoặc nhập mã thủ công."*.
   - Nếu chọn file vượt quá 5 MB: báo lỗi giới hạn dung lượng ngay lập tức.

#### Kịch bản 24: Quét bằng camera trực tiếp
1. Chuyển sang tab **"Dùng camera"** và bấm **"Bắt đầu quét bằng camera"**.
2. Trình duyệt hiển thị hộp thoại xin cấp quyền camera:
   - **Trường hợp từ chối quyền**: Modal báo lỗi đỏ *"Quyền truy cập camera bị từ chối. Vui lòng cho phép quyền truy cập camera trong cài đặt trình duyệt để tiếp tục."*.
   - **Trường hợp cho phép quyền**: Khung ngắm camera mở lên, hiển thị khung căn chỉnh màu trắng và tia laser đỏ quét lên xuống.
3. Đưa mã vạch của sản phẩm vào khung ngắm:
   - Ngay khi nhận diện được mã, camera lập tức dừng, hệ thống chuyển sang màn hình hiển thị sản phẩm tìm thấy.

#### Kịch bản 25: Đóng modal và xử lý vòng đời an toàn
1. Khi camera đang mở, nhấn phím `Escape` hoặc nút `✕`:
   - Modal đóng ngay lập tức, camera được tắt hoàn toàn (đèn báo webcam tắt).
   - Tiêu điểm bàn phím (focus) tự động quay lại nút "Quét mã" cạnh ô tìm kiếm.
2. Nếu đăng xuất trong lúc modal đang mở:
   - Modal tự động đóng, luồng camera bị hủy an toàn, không có lỗi rò rỉ bộ nhớ hay chạy ngầm.

---

### 6.3 Ghi chú về Môi trường Kiểm thử
- **Môi trường đã kiểm thử trực tiếp trong quá trình phát triển**:
  - Trình duyệt Chromium/Blink trên hệ điều hành Windows 11 qua cổng cục bộ `http://localhost:5173/`.
  - Kiểm tra hoàn chỉnh các luồng: giao diện nút quét, modal 3 tab, nhập mã thủ công, xử lý lỗi ảnh, đóng mở modal qua phím Escape/backdrop và phân giải responsive ở chiều rộng 375px.
- **Lưu ý với thiết bị di động (Android / iOS)**:
  - Việc nhận diện camera trên điện thoại thật yêu cầu kết nối **HTTPS** (hoặc tunnel an toàn) do chính sách bảo mật WebRTC / `navigator.mediaDevices.getUserMedia` của trình duyệt di động.
  - Khi triển khai lên môi trường thực tế (staging / production có chứng chỉ SSL), người dùng có thể dùng camera góc rộng/camera macro và tận dụng khả năng tự động lấy nét (autofocus) của điện thoại để quét mã vạch với tốc độ tối ưu.


