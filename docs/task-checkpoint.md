# Task Checkpoint: Visual Search, Vector Lifecycle & Suffix Disambiguation

**Thời điểm cập nhật:** 19/09/2026  
**Trạng thái hệ thống:** 
- **100% ĐẠT (Kiểm thử Hồi quy Thuật toán Token & Hậu tố):** Bộ test hồi quy `matching_suffix_regression.test.ts` đạt 4/4 tests (100% PASS, thời gian 214ms). Phân biệt rạch ròi giữa ký tự đơn lẻ trong nền ảnh (noise) và hậu tố 1 ký tự thuộc cụm tên hợp lệ (`Yumangel F`, `Vitamin C`).
- **100% ĐẠT (8 Ca Vòng đời Vector & Bảo mật CSDL - Non-AI):** Chạy trực tiếp từ giao diện Web Test Modal (Ca 101 -> Ca 108) đạt 8/8 (100% PASSED). CSDL bảo vệ qua trigger, phân quyền cột INSERT/UPDATE, token lease và phân định nguồn gốc vector rõ ràng.
- **100% ĐẠT TOÀN BỘ CÁC KỊCH BẢN THỊ GIÁC TRÊN KHO THỰC TẾ (KB1 -> KB6):**
  - **KB 1 ("Món 01" không nhãn, ghi chú trống, tìm bằng ảnh cáp mới):** **ĐẠT**. Gợi ý đối chiếu phù hợp `C01`, độ tương đồng vector đạt `0.930` (cosine distance: 0.930), thời gian tìm kiếm `21,055 ms` (lần đầu) và `6,313 ms` (lần 2).
  - **KB 2 (Phân biệt 2 cáp khác đầu nối: Type-C vs Lightning):** **ĐẠT**. Cáp Type-C `C01` (cosine: `0.947`) xếp trên cáp Lightning `C02` (cosine: `0.852`), thời gian: `7,427 ms`.
  - **KB 3 (Đổi ảnh sản phẩm sang củ sạc):** **ĐẠT**. Trigger CSDL tự động reset `embedding_status = 'pending'`, xóa vector cũ. Sau khi đồng bộ lại từ ảnh mới, tìm kiếm khớp đúng `C01` (cosine: `0.978`, thời gian: `9,729 ms`).
  - **KB 4 (Vật thể ngoài kho - Cây kéo thủ công):** **ĐẠT**. Trả về `0 matches` (Top match: `None`), thời gian: `14,429 ms`. Loại trừ hoàn toàn hiện tượng gán nhầm sang Chuột Gaming hay Cáp sạc.
  - **KB 5 (Loại trừ sản phẩm đã xóa mềm):** **ĐẠT**. Thời gian: `13,424 ms`. Khi `C01` bị soft-delete, tìm kiếm bằng ảnh củ sạc trả về HTTP 200 không chứa `C01` (`mon01_found_in_active_search: false`, `active_matches_count: 0`). Khối `finally` khôi phục `C01` tự động.
  - **KB 6 (Nhận diện Yumangel F mã 07 qua ảnh bao bì thật):** **ĐẠT 100%**. Trả về đúng mã `07` (`Yumangel F`), điểm match: `100`, độ tương đồng vector: `0.896` (~0.90), tổng thời gian tìm kiếm: **`9,158 ms`**.
  - **Đối chiếu chéo Cáp sạc vs Yumangel F khi 07 đã synced:** **ĐẠT 100%**. Gửi ảnh cáp sạc `cable_query.jpg`, danh sách gợi ý cáp trả về 2 kết quả cáp sạc, tuyệt đối KHÔNG có mã `07` (`cable_cross_check_passed: true`).

---

## 1. Thuật toán Xử lý Hậu tố 1 Ký tự & Tinh chỉnh Ngành hàng

### A. Nguyên lý Thiết kế (Dependent Suffix Matching & Category Fix)
1. **Trích xuất Token (`extractSignificantTokens`):**
   - Giữ lại các từ có độ dài $\ge 2$ ký tự.
   - Giữ lại ký tự đơn 1 chữ cái nếu nó đi liền sau một từ có độ dài $\ge 2$ ký tự (ví dụ: `"Yumangel F"` $\rightarrow$ `["yumangel", "f"]`). Ký tự đơn đứng cô lập (như chữ `"F"` đứng một mình trong nền ảnh) bị loại bỏ hoàn toàn (`[]`).
2. **Đối chiếu Token (`calculateMatchScore`):**
   - Ký tự đơn 1 chữ cái (như `"f"`) **chỉ được tính là trùng khớp** nếu từ gốc đứng liền trước (head word `"yumangel"`) cũng có mặt và trùng khớp trong dữ liệu nhận diện của AI.
   - Trong `visible_text`: Cụm đầy đủ `["Yumangel F"]` kích hoạt khớp toàn bộ cụm tên.
3. **Loại bỏ Danh mục Thuốc chung khỏi `INCOMPATIBLE_TYPE_GROUPS`:**
   - Trước đây, `thuoc` bị xếp chung hàng với các dạng bào chế (`hon dich uong`, `siro`, `men tieu hoa`). Khi sản phẩm kho có `category = "Thuốc"` và AI đọc bao bì là `variant = "Hỗn dịch uống"`, hệ thống bị hiểu nhầm là mâu thuẫn loại sản phẩm và xóa điểm về 0.
   - Đã loại bỏ nhóm thuốc chung khỏi bảng mâu thuẫn cục bộ, đồng thời giữ nguyên chốt chặn mâu thuẫn chéo cốt lõi: phụ kiện điện tử vs thuốc (`isAiElectronics && isProdPharma`), dụng cụ thủ công vs điện tử (`isAiTools && isProdElectronics`).

### B. Kết quả Regression Test (`matching_suffix_regression.test.ts`)
```
✔ 1. extractSignificantTokens preserves single-character suffix with head word and ignores isolated noise (5.05ms)
✔ 2. Regression Test: Ký tự "F" đơn lẻ trong nền ảnh bàn phím KHÔNG khớp Yumangel F (5.90ms)
✔ 3. Regression Test: Bao bì chữ in "Yumangel F" khớp đầy đủ tên và hậu tố F (1.65ms)
✔ 4. Regression Test: Phân biệt biến thể hậu tố Yumangel F vs Yumangel S (1.53ms)
ℹ tests 4 | pass 4 | fail 0 | cancelled 0 | skipped 0 | duration_ms 214.14ms
```

---

## 2. Bảng Kết quả Thực tế Kiểm thử trên Hệ thống Live

### A. 8 Ca Vòng đời Vector & Token Lease (Thực thi Live qua Browser UI)

| Ca kiểm định | Tên ca kiểm thử | Kết quả thực tế | Trạng thái |
| :--- | :--- | :--- | :---: |
| **Ca 101** | Đổi ảnh khi đang sync (Stale Version Protection) | RPC từ chối cập nhật khi ảnh đổi giữa chừng (`status: stale_version_mismatch`) | **ĐẠT** |
| **Ca 102** | Worker timeout / Hết hạn lease chiếm dụng | Cấp lại lease có thời hạn và token mới thành công | **ĐẠT** |
| **Ca 103** | Complete bằng token cũ / token không khớp | RPC từ chối token không hợp lệ (`status: stale_token_mismatch`) | **ĐẠT** |
| **Ca 104** | Complete trùng lặp (Duplicate Complete Protection) | Lần 1 thành công (`updated_synced`), lần 2 bị chặn (`stale_not_processing`) | **ĐẠT** |
| **Ca 105** | Xóa sản phẩm khi đang sync (Stale Deleted Protection) | RPC phát hiện sản phẩm đã bị xóa mềm, từ chối lưu vector (`status: stale_deleted`) | **ĐẠT** |
| **Ca 106** | Bảo mật phân quyền cột UPDATE (Client UPDATE nhạy cảm) | CSDL từ chối trực tiếp cập nhật cột `embedding_status` (`permission denied 42501`) | **ĐẠT** |
| **Ca 107** | Phân quyền INSERT: Chặn điền cột vector & Thêm SP thường | Thêm sản phẩm bình thường 100% OK; Cố tình INSERT cột vector bị từ chối `42501` | **ĐẠT** |
| **Ca 108** | Giả lập lỗi Vision: Ghi nhận failed, không lưu vector | CSDL ghi nhận `status = 'failed'`, giải phóng token, không lưu vector và không fallback metadata sai | **ĐẠT** |

### B. Bảng Đối chiếu Kịch bản Thị giác & Đối chiếu Chéo Thực tế

| Kịch bản | Mô tả kịch bản | Mã mong đợi | Mã thực tế | Độ tương đồng (Cosine) | Thời gian tìm kiếm | Kết quả & Đánh giá |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **KB 1** | "Món 01", notes trống, ảnh cáp mới | `C01` | **`C01`** | **`cosine: 0.930`** | 21,055 ms / 6,313 ms | **ĐẠT**: Gợi ý đối chiếu phù hợp `C01` thuần túy qua vector ảnh thật |
| **KB 2** | Type-C vs Lightning (2 cáp khác đầu) | `C01` > `C02` | **`C01` > `C02`** | `C01`: `0.947` / `C02`: `0.852` | 7,427 ms | **ĐẠT**: Xếp hạng đúng cáp Type-C trên cáp Lightning |
| **KB 3** | Đổi ảnh `C01` sang củ sạc | `C01` | **`C01`** | **`cosine: 0.978`** | 9,729 ms | **ĐẠT**: Reset pending thành công, vector tạo mới từ củ sạc |
| **KB 4** | Vật thể ngoài kho (Cây kéo thủ công) | Không có | **Không có (0 hits)** | N/A | 14,429 ms | **ĐẠT**: Loại trừ hoàn toàn, không gợi ý nhầm sang chuột hay cáp |
| **KB 5** | Loại trừ sản phẩm đã xóa mềm | Không có | **Không có (0 hits)** | N/A | 13,424 ms | **ĐẠT**: `mon01_found_in_active_search: false`, khôi phục bản ghi qua `finally` |
| **KB 6** | Nhận diện bao bì Yumangel F qua ảnh thật | `07` | **`07`** | **`cosine: 0.896`** | 9,158 ms | **ĐẠT 100%**: Gợi ý đối chiếu phù hợp `Yumangel F` (match score: 100) |
| **Đối chiếu chéo** | Tìm ảnh cáp khi 07 đã synced, xác minh không gợi ý nhầm `07` | Không có `07` | **Loại trừ `07`** | N/A | 8,920 ms | **ĐẠT**: `cable_cross_check_passed: true`, danh sách cáp chỉ có 2 cáp, không có 07 |

---

## 3. Trạng thái Triển khai Hệ thống

1. **Database Migrations (Supabase Cloud `jrbaktngyqcokqmxbyxl`):**
   - Đầy đủ 12 migrations đã áp dụng tuần tự từ `20260909000100` đến `20260917000200`.
   - Không chạy lại bất kỳ migration nào; không reset toàn kho; giữ nguyên vẹn các vector đã đồng bộ từ ảnh thật (`C01, C02, 07, 08`).
2. **Supabase Edge Function (`search-product-image`):**
   - Đã deploy bản mới nhất lên Supabase Cloud.
   - Timeout Vision 35 giây có AbortController bảo vệ cả fetch và đọc body stream.
   - Dependent suffix matching, format metric cosine, và loại bỏ mâu thuẫn giả định giữa thuốc và hỗn dịch uống.
3. **Frontend Application:**
   - `npm run lint`: **PASS 100%** (0 errors, 0 warnings).
   - `npm run build`: **PASS 100%** (TypeScript compile sạch, Vite bundle sạch).
   - **Xác nhận triển khai Cloudflare:** **CHƯA DEPLOY**. Bản frontend mới nhất hiện chỉ đang chạy trên môi trường cục bộ/dev server, chưa tạo commit và chưa push lên Git remote để kích hoạt deploy Cloudflare Pages.
