// Supabase Edge Function: search-product-image
// Phân tích ảnh bao bì sản phẩm qua Google Gemini và đối chiếu thông minh với kho hàng Family Inventory
import { handleCorsPreflight, jsonResponse, validateOrigin } from './cors.ts';
import { authenticateRequest } from './auth.ts';
import { validateImageRequest } from './image_validator.ts';
import { checkAndConsumeQuota } from './quota.ts';
import { analyzeProductImage } from './gemini.ts';
import {
  rankProductMatches,
  removeVietnameseTones,
  isOnlyBrandOrQuantity,
} from './matching.ts';
import type { ApiResponse, ProductRecord } from './types.ts';

const MAX_SUPPORTED_PRODUCTS = 500;

Deno.serve(async (req: Request) => {
  // 1. Xử lý yêu cầu CORS Preflight (OPTIONS)
  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) {
    return preflightResponse;
  }

  // 2. Kiểm tra tính hợp lệ của Origin (trả 403 nếu Origin không thuộc allowlist)
  const originCheck = validateOrigin(req);
  if (originCheck) {
    return originCheck;
  }

  // 3. Chỉ chấp nhận phương thức HTTP POST
  if (req.method !== 'POST') {
    return jsonResponse(
      {
        success: false,
        error: 'method_not_allowed',
        message: 'Chỉ chấp nhận phương thức POST.',
      },
      405,
      req,
      { Allow: 'POST, OPTIONS' }
    );
  }

  try {
    // 4. Xác thực Bearer Token qua Supabase Auth và kiểm tra quyền thành viên gia đình (Active)
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.context) {
      return jsonResponse(
        {
          success: false,
          error: authResult.error || 'unauthorized',
          message: authResult.message || 'Xác thực không thành công.',
        },
        authResult.status,
        req
      );
    }

    const { userClient } = authResult.context;

    // 5. Kiểm tra kho hàng TRƯỚC KHI trừ quota và trước khi gọi Gemini
    // Tiết kiệm chi phí và hạn mức của người dùng nếu kho rỗng hoặc vượt quá 500 sản phẩm
    const { data: productsData, error: productsError } = await userClient
      .from('products')
      .select('id, code, barcode, name, category, unit, image_url, purchase_price, sale_price, stock, notes')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_SUPPORTED_PRODUCTS + 1);

    if (productsError) {
      return jsonResponse(
        {
          success: false,
          error: 'inventory_fetch_error',
          message: 'Không thể truy vấn danh mục hàng hóa từ cơ sở dữ liệu để đối chiếu.',
        },
        500,
        req
      );
    }

    const rawList = (productsData as ProductRecord[]) || [];

    // 5a. Trường hợp kho rỗng: Kết thúc sớm mà không trừ quota
    if (rawList.length === 0) {
      const emptyInventoryResponse: ApiResponse = {
        success: true,
        recognized: false,
        message: 'Kho hàng hiện tại chưa có sản phẩm nào để đối chiếu.',
        matches: [],
        total_inventory_scanned: 0,
        inventory_limit_exceeded: false,
      };
      return jsonResponse(emptyInventoryResponse, 200, req);
    }

    // 5b. Trường hợp kho vượt quá 500 sản phẩm: Từ chối sớm mà không trừ quota
    if (rawList.length > MAX_SUPPORTED_PRODUCTS) {
      return jsonResponse(
        {
          success: false,
          error: 'inventory_limit_exceeded',
          message:
            'Kho hàng hiện vượt quá giới hạn 500 sản phẩm được hỗ trợ bởi tính năng tìm kiếm AI thử nghiệm.',
          total_inventory_scanned: rawList.length,
          inventory_limit_exceeded: true,
        },
        400,
        req
      );
    }

    const productsToScan = rawList;

    // 6. Nhận và kiểm tra ảnh (stream giới hạn <= 5MB, duy nhất trường image, chữ ký Magic Bytes JPEG/PNG/WebP)
    const imageResult = await validateImageRequest(req);
    if (!imageResult.valid || !imageResult.base64 || !imageResult.mimeType) {
      return jsonResponse(
        {
          success: false,
          error: imageResult.error || 'invalid_image',
          message: imageResult.message || 'File ảnh không hợp lệ.',
        },
        imageResult.status,
        req
      );
    }

    // 7. Kiểm tra và tăng định mức sử dụng AI nguyên tử (Tối đa 5 lượt/phút, 50 lượt/ngày UTC)
    // Sau khi kho và ảnh đều hợp lệ, tiến hành trừ quota
    const quotaResult = await checkAndConsumeQuota(userClient);
    if (!quotaResult.allowed) {
      return jsonResponse(
        {
          success: false,
          error: quotaResult.error || 'rate_limit_exceeded',
          message: quotaResult.message,
          quota: {
            remaining_minute: quotaResult.remaining_minute ?? 0,
            remaining_day: quotaResult.remaining_day ?? 0,
          },
        },
        quotaResult.status,
        req,
        quotaResult.retry_after_seconds
          ? { 'Retry-After': String(quotaResult.retry_after_seconds) }
          : undefined
      );
    }

    // 8. Gửi ảnh sang Google Gemini 3.6 Flash để trích xuất thông tin bao bì (Timeout 20s)
    const aiResult = await analyzeProductImage(
      imageResult.base64,
      imageResult.mimeType
    );

    if (!aiResult.success || !aiResult.data) {
      return jsonResponse(
        {
          success: false,
          error: aiResult.error || 'ai_service_error',
          message: aiResult.message || 'Lỗi khi phân tích ảnh qua dịch vụ AI.',
          quota: {
            remaining_minute: quotaResult.remaining_minute ?? 0,
            remaining_day: quotaResult.remaining_day ?? 0,
          },
        },
        aiResult.status,
        req
      );
    }

    const aiExtraction = aiResult.data;

    // 9. Nếu ảnh không đọc được, hoặc product_name sau chuẩn hóa chỉ bằng brand
    const normName = aiExtraction.product_name
      ? removeVietnameseTones(aiExtraction.product_name)
      : '';
    const normBrand = aiExtraction.brand
      ? removeVietnameseTones(aiExtraction.brand)
      : '';
    const isNameOnlyBrand = Boolean(
      normBrand &&
        (normName === normBrand ||
          isOnlyBrandOrQuantity(aiExtraction.product_name || '', aiExtraction.brand))
    );

    if (!aiExtraction.readable || !aiExtraction.product_name || isNameOnlyBrand) {
      const notRecognizedResponse: ApiResponse = {
        success: true,
        recognized: false,
        message:
          'Không thể nhận diện rõ tên sản phẩm từ ảnh này. Vui lòng chụp rõ nét hơn phần tên hoặc mặt trước bao bì.',
        ai_extraction: aiExtraction,
        matches: [],
        total_inventory_scanned: productsToScan.length,
        quota: {
          remaining_minute: quotaResult.remaining_minute ?? 0,
          remaining_day: quotaResult.remaining_day ?? 0,
        },
      };

      return jsonResponse(notRecognizedResponse, 200, req);
    }

    // 10. Thực hiện thuật toán đối chiếu thông minh và xếp hạng kết quả
    const matches = rankProductMatches(productsToScan, aiExtraction);

    // 11. Trả về kết quả hoàn tất
    const responsePayload: ApiResponse = {
      success: true,
      recognized: true,
      ai_extraction: aiExtraction,
      matches,
      total_inventory_scanned: productsToScan.length,
      inventory_limit_exceeded: false,
      message:
        matches.length > 0
          ? `Đã tìm thấy ${matches.length} sản phẩm phù hợp trong danh mục.`
          : 'Đã nhận diện được thông tin bao bì nhưng không có sản phẩm nào phù hợp trong kho.',
      quota: {
        remaining_minute: quotaResult.remaining_minute ?? 0,
        remaining_day: quotaResult.remaining_day ?? 0,
      },
    };

    return jsonResponse(responsePayload, 200, req);
  } catch {
    // 12. Bắt lỗi không xác định và chỉ trả thông báo lỗi an toàn cố định, không lộ err.message
    return jsonResponse(
      {
        success: false,
        error: 'internal_server_error',
        message: 'Đã xảy ra lỗi không xác định trên máy chủ xử lý tìm kiếm ảnh.',
      },
      500,
      req
    );
  }
});
