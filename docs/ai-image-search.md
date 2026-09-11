# Tài liệu Kỹ thuật: Tìm kiếm Sản phẩm từ Ảnh bao bì (AI Image Search)

Tài liệu này mô tả chi tiết kiến trúc, cấu hình bảo mật, quy tắc đối chiếu và hướng dẫn kiểm thử backend Edge Function `search-product-image` cho hệ thống quản lý kho gia đình **Family Inventory**.

---

## 1. Bản chất Giải pháp & Phạm vi Thử nghiệm

> [!IMPORTANT]
> - **Bản chất giải pháp**: Đây là hệ thống **Trích xuất thông tin bao bì bằng AI Vision (OCR & Package Information Extraction)** thông qua Google Gemini 2.5 Flash, kết hợp với **Thuật toán đối chiếu thông minh theo tập luật (Rule-based Heuristic Matching Engine)** chạy trên Supabase Edge Function.
> - **Chưa phải tìm kiếm vector**: Hệ thống **chưa** sử dụng cơ chế tìm kiếm độ tương đồng vector (Multimodal Vector Embeddings) hoặc cơ sở dữ liệu vector (`pgvector`).
> - **Bảo vệ dữ liệu kho hàng**: Edge Function **tuyệt đối không gửi toàn bộ kho hàng, giá nhập, giá bán hoặc tồn kho sang cho Gemini**. AI chỉ nhận duy nhất ảnh bao bì tải lên và trả về các thuộc tính khách quan nhìn thấy trên bao bì. Toàn bộ quá trình đối chiếu diễn ra nội bộ trên Edge Function.
> - **Chỉ số tương đồng là Heuristic**: Điểm `match_score` (0 - 100) là chỉ số đối chiếu chuỗi và thuộc tính dựa trên tập luật xác định, **không phải xác suất thống kê hay độ tin cậy trực tiếp từ mô hình AI**.
> - **Tối ưu chi phí & Ngắt sớm (Pre-check)**: Trước khi trừ quota và trước khi gọi sang Gemini, hệ thống sẽ kiểm tra danh mục kho của người dùng:
>   - Nếu kho rỗng (0 sản phẩm): Trả về kết quả sớm, không trừ quota và không gọi Gemini.
>   - Nếu kho vượt quá 500 sản phẩm: Trả về lỗi `inventory_limit_exceeded` ngay lập tức, không trừ quota và không gọi Gemini.
> - **Trạng thái Database**: Script SQL migration đã được kiểm tra cú pháp và logic chặt chẽ, **chưa áp dụng trực tiếp lên cơ sở dữ liệu PostgreSQL thực tế trên Cloud**.

---

## 2. Luồng Xử lý Hoàn chỉnh (Pipeline)

```
[ Client (Web/Mobile) ]
       │  POST multipart/form-data (trường duy nhất "image")
       │  Origin: http://localhost:5173 (hoặc ALLOWED_ORIGIN)
       │  Authorization: Bearer <access_token>
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase Edge Function: search-product-image                │
│                                                             │
│ 1. CORS Preflight & Origin Allowlist (Chặn 403 nếu sai)     │
│ 2. HTTP Method Check (Chỉ POST & OPTIONS)                   │
│ 3. Xác thực Bearer Token & Kiểm tra Active Member (RLS)     │
│ 4. Pre-check Kho hàng: 0 sản phẩm hoặc >500 sản phẩm dừng sớm│
│ 5. Kiểm tra Stream ảnh: Tối đa 5MB, Magic Bytes, 1 trường ảnh│
│ 6. Trừ Quota nguyên tử (clock_timestamp(), UTC Day/Minute)  │
│ 7. Gửi ảnh sang Google Gemini 2.5 Flash (Header API Key, 20s)│
│ 8. Kiểm tra dữ liệu AI runtime & Bắt buộc có tên sản phẩm  │
│ 9. Thuật toán Đối chiếu Heuristic & Độc lập Tên/Loại        │
└─────────────────────────────────────────────────────────────┘
       │  JSON Response (Chuẩn hóa, an toàn không lộ lỗi nội bộ)
       ▼
[ Client nhận kết quả ]
```

---

## 3. Chi tiết Các Cơ chế Bảo mật & Xử lý

### 3.1 Cấu hình CORS & Nguồn gốc Yêu cầu (Origin Security)
- **Danh sách cho phép (Allowlist)**: Cấu hình chính xác nguồn gốc: `http://localhost:5173` và biến môi trường `ALLOWED_ORIGIN`. Tuyệt đối không dùng wildcard `*` làm fallback.
- **Header `Vary: Origin`**: Bắt buộc có trên tất cả các phản hồi HTTP để ngăn chặn cache phân tán trả nhầm header CORS giữa các origin khác nhau.
- **Từ chối sớm**: Nếu request có header `Origin` nhưng không nằm trong allowlist, Edge Function trả về ngay mã `403 Forbidden` trước khi thực hiện bất kỳ truy vấn cơ sở dữ liệu hay gọi AI nào.
- **Cho phép request nội bộ / không có Origin**: Nếu request không có header `Origin` (ví dụ: lệnh `curl` từ quản trị viên, ứng dụng native mobile, hoặc server-to-server), hệ thống vẫn cho phép đi tiếp nếu có Bearer token hợp lệ.

### 3.2 Cấu hình Gateway & Xác thực Phân quyền RLS
Trong file `supabase/config.toml`:
```toml
[functions.search-product-image]
verify_jwt = false
```
- **Lý do kiến trúc**: Việc đặt `verify_jwt = false` tại Gateway là lựa chọn kiến trúc để handler bên trong Edge Function tự chịu trách nhiệm toàn trình việc xác thực người dùng và phân quyền chi tiết.
- Handler gọi trực tiếp `supabase.auth.getUser(token)` đến máy chủ Supabase Auth để xác thực tính hợp lệ của token, sau đó kiểm tra điều kiện `is_active = true` trên bảng `public.family_members`.
- Mọi thao tác truy vấn bảng `public.products` đều thực hiện thông qua Supabase client gắn token của người dùng, đảm bảo tuân thủ nghiêm ngặt các chính sách Row Level Security (RLS) đã thiết lập.

### 3.3 Kiểm tra File Ảnh & Giới hạn Stream (Request Streaming Limits)
- Đọc stream `request.body` với bộ đếm dung lượng tối đa `MAX_REQUEST_BYTES = 5 MiB + 64 KiB`. Nếu body vượt quá ngưỡng, stream lập tức bị ngắt (`reader.cancel()`) và trả về `413 Payload Too Large` trước khi kịp cấp phát bộ nhớ lớn.
- Bắt buộc form multipart chỉ chứa **duy nhất 1 trường `image`**. Nếu có trường lạ hoặc nhiều file ảnh, request sẽ bị từ chối với mã `400 Bad Request`.
- Nhận diện **Magic Bytes** nhị phân thực tế ở đầu file:
  - **JPEG**: `FF D8 FF`
  - **PNG**: `89 50 4E 47 0D 0A 1A 0A`
  - **WebP**: `RIFF` (bytes 0..3) và `WEBP` (bytes 8..11)
- Từ chối các file văn bản đổi đuôi hoặc file nhị phân không rõ nguồn gốc.
- Không lưu ảnh vào Supabase Storage, không lưu raw bytes vào log.

### 3.4 Quota & Rate Limiting Nguyên tử (PostgreSQL Migration)
File migration: [`supabase/migrations/20260911000100_create_ai_usage_quota.sql`](file:///c:/Users/Ngoc%20Tan/Projects/family-inventory/supabase/migrations/20260911000100_create_ai_usage_quota.sql)
- **Cơ chế cập nhật nguyên tử**:
  - Khóa dòng bằng `SELECT ... FOR UPDATE` trên bảng `public.ai_usage_quotas`.
  - Mốc thời gian `v_now := pg_catalog.clock_timestamp()` được lấy **ngay sau khi đã có khóa dòng**, phản ánh đúng thời điểm thực tế sau khi chờ giải phóng khóa (thay vì `now()` vốn chỉ trả về thời điểm bắt đầu transaction). Mốc `v_now` này được dùng để tính toán bucket phút, ngày và thời gian chờ `retry_after_seconds`.
  - Sử dụng hàm chuẩn `GREATEST(...)` và `EXTRACT(SECOND FROM ...)` / `EXTRACT(EPOCH FROM ...)`.
  - Tính ngày UTC tường minh `(v_now AT TIME ZONE 'UTC')::DATE` và cửa sổ phút cố định `date_trunc('minute', v_now)`.
- **Thứ tự kiểm tra hạn mức**:
  - Ưu tiên kiểm tra quota ngày trước (50 lượt/ngày UTC). Nếu hết lượt ngày, trả về `retry_after_seconds` tính đến nửa đêm UTC tiếp theo (`v_next_day_utc`).
  - Sau đó kiểm tra quota phút (5 lượt/phút). Nếu hết lượt phút, trả về số giây còn lại của phút hiện tại.
- **Bảo mật phân quyền**:
  - Đã thu hồi toàn bộ quyền truy cập bảng: `REVOKE ALL ON TABLE public.ai_usage_quotas FROM PUBLIC, anon, authenticated;`.
  - Hàm RPC `check_and_increment_ai_quota()` chạy với `SECURITY DEFINER` và `SET search_path = ''`.

### 3.5 Tích hợp Google Gemini 2.5 Flash
- Truyền API Key qua HTTP Header: `x-goog-api-key: <KEY>` (không truyền trên query parameter URL để tránh bị ghi nhận vào nhật ký mạng hoặc proxy).
- Timeout chặt chẽ **20 giây** bao bọc cả quá trình `fetch` và đọc stream response body. Luôn dọn dẹp bộ đếm giờ (`clearTimeout`) trong khối `finally`.
- Giới hạn dung lượng phản hồi từ Gemini tối đa **1 MiB**.
- Kiểm tra kiểu dữ liệu tại runtime nghiêm ngặt trên kiểu `unknown`:
  - Trường `readable` bắt buộc là `boolean` nguyên thủy (không dùng `Boolean("false")`).
  - Các trường text kiểm tra độ dài tối đa (255 ký tự).
  - `quantity_value` bắt buộc là số thực dương hữu hạn (`Number.isFinite(val) && val > 0`).
  - Mảng `visible_text` tối đa 10 phần tử chuỗi.
- Bắt mọi ngoại lệ và chỉ trả thông báo lỗi an toàn cố định, tuyệt đối không trả `err.message` ra client.

---

## 4. Thuật toán Đối chiếu Heuristic (Matching Engine)

File: [`supabase/functions/search-product-image/matching.ts`](file:///c:/Users/Ngoc%20Tan/Projects/family-inventory/supabase/functions/search-product-image/matching.ts)

### 4.1 Tách Token theo Ranh giới Từ (Word Boundary)
- Sử dụng hàm `containsWordBoundary(text, term)` để kiểm tra sự xuất hiện của từ/cụm từ theo đúng ranh giới từ `(?:^|[^a-z0-9])term(?:$|[^a-z0-9])`.
- Ngăn ngừa tình trạng từ con khớp nhầm trong các từ khác (ví dụ: "ca" không khớp trong "bánh cay", "dove" không khớp trong "undovered").

### 4.2 Phát hiện Mâu thuẫn Loại Sản phẩm (Conflict Detection)
- Hệ thống định nghĩa các nhóm ngành hàng loại trừ lẫn nhau (`INCOMPATIBLE_TYPE_GROUPS`):
  - Hóa mỹ phẩm: `['sua tam', 'dau goi', 'dau xa', 'sua rua mat', 'kem danh rang', ...]`
  - Giặt tẩy: `['nuoc giat', 'bot giat', 'nuoc xa vai', 'nuoc lau san', 'nuoc rua chen', ...]`
  - Gia vị: `['dau an', 'nuoc mam', 'nuoc tuong', 'xi dau', 'tuong ot', ...]`
  - Đồ uống: `['nuoc ngot', 'nuoc suoi', 'nuoc khoang', 'nuoc ep', 'bia', 'ruou', ...]`
- **Xử lý mâu thuẫn**: Nếu ảnh bao bì là một loại (ví dụ: "sữa tắm Dove 500ml") mà sản phẩm trong kho là một loại khác cùng nhóm (ví dụ: "dầu gội Dove 500ml"):
  - Phát hiện mâu thuẫn loại sản phẩm.
  - Gán ngay `score = 0`.
  - Loại bỏ hoàn toàn khỏi danh sách kết quả phù hợp.

### 4.3 Yêu cầu Bắt buộc về Bằng chứng Độc lập Tên/Loại Sản phẩm
- **Xử lý tên sản phẩm trùng thương hiệu**: Nếu `product_name` sau khi chuẩn hóa chỉ bằng `brand` (hoặc chỉ gồm brand và quy cách đóng gói), hàm `rankProductMatches` trả về mảng rỗng `[]` để yêu cầu người dùng chụp rõ hơn.
- **Không công nhận thương hiệu/dung tích trong `visible_text` là bằng chứng độc lập**: Nếu `visible_text` chỉ lặp lại thương hiệu (ví dụ: `["Dove"]`) hoặc dung tích (ví dụ: `["500ml"]`), chúng **không** được coi là bằng chứng độc lập về tên/loại sản phẩm.
- **Áp dụng kiểm tra trước khi cộng điểm dung tích**: Nếu không có bằng chứng độc lập (từ `nameScore`, `variantScore` hoặc từ ngữ thực sự trên bao bì ngoài thương hiệu/dung tích), hệ thống trả về `score = 0` ngay lập tức, tuyệt đối không cộng điểm dung tích.
- **Giữ kết quả đúng**: Nếu sản phẩm nhận diện đúng tên, thương hiệu và dung tích (ví dụ: "Sữa tắm Dove 500ml"), hệ thống vẫn trả về sản phẩm phù hợp với điểm cao.

### 4.4 Đối chiếu Quy cách Đóng gói (Không dùng dung sai 2%)
- Hàm `compareQuantities(q1, q2)` so sánh hai dung tích/khối lượng đã chuẩn hóa:
  - Cho phép sai số số thực cực nhỏ (`diff < 0.001`) khi chuyển đổi đơn vị (`1 l = 1000 ml`).
  - **Không dùng dung sai 2% giữa các quy cách sản phẩm**: Chai `980 ml` và chai `1000 ml` lệch 20ml, được xác định là **khác quy cách** và áp dụng mức phạt điểm nặng (`-40 điểm`).

### 4.5 Bảng Trọng số Điểm Heuristic
- **Trùng thương hiệu (`brand`)**: +25 điểm.
- **Khớp tên sản phẩm (`product_name`)**:
  - Khớp nguyên cụm: +35 điểm.
  - Khớp các token từ khóa: lên đến +25 điểm.
- **Khớp biến thể / dòng (`variant`)**: +15 điểm.
- **Khớp từ khóa nhìn thấy trên bao bì (`visible_text`)**: +3 điểm/từ (tối đa +10 điểm, không tính thương hiệu/dung tích lặp lại).
- **Trùng khớp dung tích/khối lượng**: +15 điểm (chỉ cộng khi đã có bằng chứng độc lập).
- **Khác dung tích/khối lượng**: -40 điểm.
- **Ngưỡng sàn tối thiểu (`MATCH_THRESHOLD`)**: `35 điểm`.
- **Số lượng kết quả tối đa**: 5 sản phẩm.

---

## 5. Danh mục Kiểm thử Đơn vị (Unit Tests)

Toàn bộ 27 bài unit test được tổ chức trong thư mục `supabase/functions/search-product-image/`:

```powershell
# Chạy toàn bộ 27 bài unit test với Deno
npx -y deno test --allow-env supabase/functions/search-product-image/

# Kiểm tra toàn vẹn kiểu dữ liệu của toàn bộ Edge Function
npx -y deno check supabase/functions/search-product-image/index.ts
```

### Danh sách các ca kiểm thử:
1. **`matching.test.ts` (14 bài)**:
   - Chuẩn hóa tiếng Việt không dấu.
   - Ranh giới từ `containsWordBoundary` (chống khớp chuỗi con).
   - Chuẩn hóa dung tích (lít -> ml, kg -> g).
   - So sánh đơn vị 1 lít và 1000 ml.
   - Bỏ dung sai 2%: 980ml ≠ 1000ml.
   - Phát hiện mâu thuẫn loại sản phẩm (Sữa tắm vs Dầu gội).
   - Xử lý cùng Dove 500ml nhưng khác loại (Sữa tắm vs Dầu gội) cho ra điểm 0.
   - Ảnh chỉ có thương hiệu mà không có tên sản phẩm trả về mảng rỗng `[]`.
   - Khớp sản phẩm cùng thương hiệu và đúng dung tích đạt điểm cao nhất.
   - Cùng thương hiệu nhưng khác dung tích bị phạt điểm mạnh.
   - Sản phẩm không có trong kho trả về mảng rỗng.
   - Ảnh mờ hoặc readable = false trả về mảng rỗng.
   - **Regression test**: `product_name: "Dove"`, `brand: "Dove"`, dung tích 500ml, `visible_text: ["Dove"]` đối chiếu kho "Dầu gội Dove 500ml" bắt buộc trả về `[]`.
   - **Độ chính xác tích cực**: "Sữa tắm Dove 500ml" nhận diện đúng tên, thương hiệu và dung tích vẫn được tìm thấy với điểm cao và không lẫn sang dầu gội.
2. **`image_validator.test.ts` (7 bài)**:
   - Chữ ký Magic Bytes JPEG (`FF D8 FF`).
   - Chữ ký Magic Bytes PNG (`89 50 4E 47 0D 0A 1A 0A`).
   - Chữ ký Magic Bytes WebP (`RIFF....WEBP`).
   - Từ chối file text/pdf giả mạo đuôi ảnh.
   - Từ chối dữ liệu nhị phân quá ngắn (< 12 bytes).
   - Ngắt stream khi vượt quá `MAX_REQUEST_BYTES` và trả về HTTP 413.
   - Từ chối request không phải multipart/form-data.
3. **`cors_security.test.ts` (6 bài)**:
   - Cho phép Origin hợp lệ `http://localhost:5173`.
   - Cho phép request không có Origin (curl / ứng dụng native).
   - Từ chối Origin không hợp lệ trả về HTTP 403 và header `Vary: Origin`, không fallback về `*`.
   - Preflight OPTIONS từ Origin không hợp lệ trả về 403.
   - Preflight OPTIONS từ Origin hợp lệ trả về 204 No Content.
   - Kiểm tra runtime checking của Gemini từ chối dữ liệu giả mạo (chuỗi boolean, số âm, cắt ngắn text).

---

## 6. Hướng dẫn Triển khai Sau này (Khi người dùng yêu cầu)

> [!NOTE]
> Các bước dưới đây chỉ mang tính hướng dẫn kỹ thuật tham khảo. Tuyệt đối không tự động thực hiện deploy lên cloud hoặc áp dụng migration nếu người dùng chưa yêu cầu rõ ràng.

1. **Áp dụng Migration trên Database**:
   - Chạy nội dung file [`supabase/migrations/20260911000100_create_ai_usage_quota.sql`](file:///c:/Users/Ngoc%20Tan/Projects/family-inventory/supabase/migrations/20260911000100_create_ai_usage_quota.sql) trong SQL Editor trên Supabase Dashboard.
2. **Cấu hình Supabase Secrets**:
   - `GEMINI_API_KEY`: Lấy từ Google AI Studio.
   - `GEMINI_MODEL`: `gemini-2.5-flash`.
   - `ALLOWED_ORIGIN`: Domain production của web (nếu có).
3. **Deploy Edge Function**:
   ```bash
   supabase functions deploy search-product-image --no-verify-jwt
   ```
