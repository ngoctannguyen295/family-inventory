// Supabase Edge Function: search-product-image
// Phân tích ảnh bao bì sản phẩm qua Google Gemini và đối chiếu thông minh với kho hàng Family Inventory
import { handleCorsPreflight, jsonResponse, validateOrigin } from './cors.ts';
import { authenticateRequest } from './auth.ts';
import { validateImageRequest } from './image_validator.ts';
import { checkAndConsumeQuota } from './quota.ts';
import { analyzeProductImage } from './gemini.ts';
import { generateVisualEmbedding } from './embedding.ts';
import { rankProductMatches, isOnlyBrandOrQuantity } from './matching.ts';
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

  const requestId = crypto.randomUUID();
  const requestStartTime = performance.now();
  let authTimeMs: number | undefined;
  let dbTimeMs: number | undefined;
  let quotaTimeMs: number | undefined;
  let geminiTimeMs: number | undefined;
  let matchingTimeMs: number | undefined;

  try {
    // 4. Xác thực Bearer Token qua Supabase Auth và kiểm tra quyền thành viên gia đình (Active)
    const authStartTime = performance.now();
    const authResult = await authenticateRequest(req);
    authTimeMs = Math.round(performance.now() - authStartTime);

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

    // Helper chuyển đổi ArrayBuffer sang Base64 an toàn cho file nhị phân
    const convertUint8ToBase64 = (bytes: Uint8Array): string => {
      const chunkSize = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    };

    // 4b. Xử lý các action JSON (test-embedding, sync-batch-embeddings)
    const reqContentType = req.headers.get('content-type') || '';
    if (reqContentType.includes('application/json')) {
      try {
        const jsonBody = await req.json();

        // 4b.1 Endpoint kiểm tra xác minh model embedding thực tế (Chỉ dành cho Editor có quyền can_edit)
        if (jsonBody?.action === 'test-embedding') {
          if (!authResult.context.member.can_edit) {
            return jsonResponse(
              {
                success: false,
                error: 'permission_denied',
                message: 'Chỉ thành viên có quyền chỉnh sửa mới được thực hiện kiểm tra embedding.',
              },
              403,
              req
            );
          }

          const testText = typeof jsonBody.text === 'string' && jsonBody.text.trim().length > 0
            ? jsonBody.text.trim()
            : 'dây cáp sạc USB Type-C màu trắng bọc dù';
          const embRes = await generateVisualEmbedding(testText);
          return jsonResponse(
            {
              success: embRes.success,
              model: Deno.env.get('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001',
              dimensions: embRes.embedding?.length ?? 0,
              duration_ms: embRes.durationMs,
              error: embRes.error,
              sample_first_3_values: embRes.embedding?.slice(0, 3) ?? [],
            },
            embRes.success ? 200 : 500,
            req
          );
        }

        // 4b.2 Action đồng bộ Vector theo Batch có kiểm soát (chống race condition, retry hữu hạn)
        if (jsonBody?.action === 'sync-batch-embeddings' || jsonBody?.action === 'sync-all-embeddings') {
          if (!authResult.context.member.can_edit) {
            return jsonResponse(
              {
                success: false,
                error: 'permission_denied',
                message: 'Chỉ thành viên có quyền chỉnh sửa mới được thực hiện đồng bộ vector kho hàng.',
              },
              403,
              req
            );
          }

          // Lấy batch tối đa 5 sản phẩm qua atomic RPC với khóa FOR UPDATE SKIP LOCKED
          const { data: claimedProducts, error: claimErr } = await userClient.rpc(
            'claim_products_for_embedding_sync',
            { batch_size: 5 }
          );

          if (claimErr) {
            return jsonResponse(
              {
                success: false,
                error: 'claim_error',
                message: `Lỗi khi lấy batch đồng bộ: ${claimErr.message}`,
              },
              500,
              req
            );
          }

          const listToSync = (claimedProducts as Array<{
            id: string;
            name: string;
            category: string;
            notes: string | null;
            image_url: string | null;
            claim_token: string;
            source_version: number;
            lease_expires_at: string;
            embedding_retry_count: number;
          }>) || [];

          let syncedCount = 0;
          let failedCount = 0;
          let staleCount = 0;
          const syncLogs: Array<{
            id: string;
            name: string;
            has_image: boolean;
            success: boolean;
            visual_source: string;
            complete_status?: string;
            error?: string;
            image_diag?: string;
          }> = [];

          for (const item of listToSync) {
            let visualDescription = '';
            let isVisualExtractedFromImage = false;
            let imageDiagError: string | undefined;

            // 1. Nếu sản phẩm có ảnh trong Storage, tải ảnh thật từ private bucket để phân tích đặc trưng thị giác
            if (item.image_url && item.image_url.trim().length > 0) {
              try {
                const { data: fileBlob, error: downloadErr } = await userClient.storage
                  .from('product-images')
                  .download(item.image_url.trim());

                if (!downloadErr && fileBlob) {
                  const arrayBuffer = await fileBlob.arrayBuffer();
                  const base64 = convertUint8ToBase64(new Uint8Array(arrayBuffer));
                  const ext = item.image_url.toLowerCase();
                  const mimeType: 'image/jpeg' | 'image/png' | 'image/webp' =
                    ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

                  const visionRes = await analyzeProductImage(base64, mimeType);
                  if (visionRes.success && visionRes.data) {
                    const extData = visionRes.data;
                    const visualSig = extData.visual_signature ||
                      `vật thể: ${extData.object_type || item.name}; đặc tính: ${extData.visual_features || ''}; ngành hàng: ${extData.category_hint || item.category}`;
                    visualDescription = visualSig;
                    isVisualExtractedFromImage = true;
                  } else {
                    imageDiagError = `vision_failed: ${visionRes.error || visionRes.message}`;
                  }
                } else if (downloadErr) {
                  imageDiagError = `download_failed: ${downloadErr.message}`;
                  console.warn(`[SYNC_DOWNLOAD_WARN] Product ${item.id} image download failed:`, downloadErr.message);
                }
              } catch (err: unknown) {
                imageDiagError = `exception: ${err instanceof Error ? err.message : String(err)}`;
                console.error(`[SYNC_STORAGE_IMAGE_ERROR] Product ${item.id}:`, err);
              }
            } else {
              imageDiagError = 'no_image_url: Sản phẩm không có ảnh trong Storage để trích xuất đặc trưng thị giác';
            }

            // 2. NẾU CÓ ẢNH VÀ TRÍCH XUẤT ĐẶC TRƯNG THỊ GIÁC THÀNH CÔNG -> TẠO EMBEDDING VÀ LƯU SYNCED
            if (isVisualExtractedFromImage && visualDescription) {
              const embRes = await generateVisualEmbedding(visualDescription);

              if (embRes.success && embRes.embedding && embRes.embedding.length === 768) {
                const { data: completeRes } = await userClient.rpc('complete_product_embedding_sync', {
                  p_id: item.id,
                  p_claim_token: item.claim_token,
                  p_source_version: item.source_version,
                  p_success: true,
                  p_embedding: embRes.embedding,
                  p_visual_description: visualDescription,
                  p_model: 'gemini-embedding-001',
                  p_model_version: 'v1',
                  p_error: null,
                  p_source: 'image_description',
                });

                const cRes = completeRes as { success?: boolean; status?: string; message?: string } | null;
                if (cRes?.status === 'updated_synced') {
                  syncedCount++;
                  syncLogs.push({
                    id: item.id,
                    name: item.name,
                    has_image: true,
                    visual_source: 'image_description',
                    success: true,
                    complete_status: cRes.status,
                  });
                } else {
                  staleCount++;
                  syncLogs.push({
                    id: item.id,
                    name: item.name,
                    has_image: true,
                    visual_source: 'image_description',
                    success: false,
                    complete_status: cRes?.status || 'stale_unknown',
                    error: cRes?.message || 'Tác vụ đồng bộ đã bị hủy bỏ hoặc dữ liệu cũ',
                  });
                }
              } else {
                // Embedding thất bại
                const errMsg = embRes.error || 'Lỗi không xác định khi tạo embedding';
                await userClient.rpc('complete_product_embedding_sync', {
                  p_id: item.id,
                  p_claim_token: item.claim_token,
                  p_source_version: item.source_version,
                  p_success: false,
                  p_embedding: null,
                  p_visual_description: null,
                  p_model: 'gemini-embedding-001',
                  p_model_version: 'v1',
                  p_error: errMsg,
                  p_source: 'image_description',
                });

                failedCount++;
                syncLogs.push({
                  id: item.id,
                  name: item.name,
                  has_image: true,
                  visual_source: 'image_description',
                  success: false,
                  complete_status: 'failed',
                  error: errMsg,
                });
              }
            } else {
              // 3. NẾU TẢI ẢNH HOẶC PHÂN TÍCH GEMINI VISION THẤT BẠI:
              // TUYỆT ĐỐI KHÔNG FALLBACK TÊN/DANH MỤC ĐỂ ĐÁNH DẤU VECTOR HÌNH ẢNH SYNCED.
              // Ghi nhận thất bại qua complete RPC đúng token/source_version, giữ cơ chế retry hữu hạn.
              const failureReason = imageDiagError || 'Phân tích đặc trưng thị giác từ ảnh thất bại';
              const { data: completeRes } = await userClient.rpc('complete_product_embedding_sync', {
                p_id: item.id,
                p_claim_token: item.claim_token,
                p_source_version: item.source_version,
                p_success: false,
                p_embedding: null,
                p_visual_description: null,
                p_model: 'gemini-embedding-001',
                p_model_version: 'v1',
                p_error: failureReason,
                p_source: 'image_description',
              });

              const cRes = completeRes as { success?: boolean; status?: string; message?: string } | null;
              failedCount++;
              syncLogs.push({
                id: item.id,
                name: item.name,
                has_image: Boolean(item.image_url),
                visual_source: 'none',
                success: false,
                complete_status: cRes?.status || 'updated_failed',
                error: failureReason,
                image_diag: imageDiagError,
              });
            }
          }

          // Kiểm tra số sản phẩm pending còn lại
          const { count: pendingCount } = await userClient
            .from('products')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('embedding_status', 'pending');

          return jsonResponse(
            {
              success: true,
              message: `Đã xử lý batch ${listToSync.length} sản phẩm: thành công ${syncedCount}, thất bại ${failedCount}, bỏ qua/stale ${staleCount}. Còn lại ${pendingCount ?? 0} sản phẩm cần đồng bộ.`,
              batch_processed: listToSync.length,
              synced_count: syncedCount,
              failed_count: failedCount,
              stale_count: staleCount,
              remaining_pending: pendingCount ?? 0,
              logs: syncLogs,
            },
            200,
            req
          );
        }

        return jsonResponse(
          {
            success: false,
            error: 'unknown_action',
            message: `Hành động JSON không được hỗ trợ: ${jsonBody?.action}`,
          },
          400,
          req
        );
      } catch (jsonErr: unknown) {
        return jsonResponse(
          {
            success: false,
            error: 'json_error',
            message: `Lỗi xử lý request JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`,
          },
          500,
          req
        );
      }
    }
    // Tiết kiệm chi phí và hạn mức của người dùng nếu kho rỗng hoặc vượt quá 500 sản phẩm
    const dbStartTime = performance.now();
    const { data: productsData, error: productsError } = await userClient
      .from('products')
      .select('id, code, barcode, name, category, unit, image_url, purchase_price, sale_price, stock, notes')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_SUPPORTED_PRODUCTS + 1);
    dbTimeMs = Math.round(performance.now() - dbStartTime);

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
        timing: {
          server_total_ms: Math.round(performance.now() - requestStartTime),
          gemini_ms: 0,
          auth_ms: authTimeMs,
          db_ms: dbTimeMs,
        },
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
    const quotaStartTime = performance.now();
    const quotaResult = await checkAndConsumeQuota(userClient);
    quotaTimeMs = Math.round(performance.now() - quotaStartTime);

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
    const aiStartTime = performance.now();
    const aiResult = await analyzeProductImage(
      imageResult.base64,
      imageResult.mimeType
    );
    geminiTimeMs = aiResult.durationMs ?? Math.round(performance.now() - aiStartTime);

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
          timing: {
            server_total_ms: Math.round(performance.now() - requestStartTime),
            gemini_ms: geminiTimeMs,
            auth_ms: authTimeMs,
            db_ms: dbTimeMs,
            quota_ms: quotaTimeMs,
          },
        },
        aiResult.status,
        req
      );
    }

    const aiExtraction = aiResult.data;

    // 9. Kiểm tra xem ảnh có nhận diện được thông tin (bao gồm cả chữ in hoặc loại đồ vật không nhãn mác)
    const hasVisibleWords = Boolean(
      aiExtraction.visible_text &&
        aiExtraction.visible_text.some((t) => !isOnlyBrandOrQuantity(t, aiExtraction.brand))
    );
    const hasObjectType = Boolean(
      aiExtraction.object_type && aiExtraction.object_type.trim().length >= 2
    );
    const hasSubstantiveName = Boolean(
      aiExtraction.product_name && !isOnlyBrandOrQuantity(aiExtraction.product_name, aiExtraction.brand)
    );

    const isUnrecognized =
      !aiExtraction.readable ||
      (!hasSubstantiveName && !hasVisibleWords && !hasObjectType);

    if (isUnrecognized) {
      const totalServerTimeMs = Math.round(performance.now() - requestStartTime);
      console.log(
        `[SEARCH_TIMING] reqId: ${requestId} | auth: ${authTimeMs}ms | db: ${dbTimeMs}ms | quota: ${quotaTimeMs}ms | gemini: ${geminiTimeMs}ms | not_recognized | total: ${totalServerTimeMs}ms`
      );

      const notRecognizedResponse: ApiResponse = {
        success: true,
        recognized: false,
        message:
          'Không thể nhận diện rõ sản phẩm hoặc đồ vật từ ảnh này. Vui lòng chụp rõ nét hơn hoặc chụp gần hơn.',
        ai_extraction: aiExtraction,
        matches: [],
        total_inventory_scanned: productsToScan.length,
        quota: {
          remaining_minute: quotaResult.remaining_minute ?? 0,
          remaining_day: quotaResult.remaining_day ?? 0,
        },
        timing: {
          server_total_ms: totalServerTimeMs,
          gemini_ms: geminiTimeMs,
          auth_ms: authTimeMs,
          db_ms: dbTimeMs,
          quota_ms: quotaTimeMs,
        },
      };

      return jsonResponse(notRecognizedResponse, 200, req);
    }

    // 10. Tính Vector Embedding và truy vấn độ tương đồng hình ảnh qua pgvector (nếu có dữ liệu)
    const vectorMap = new Map<string, number>();
    let vectorTimeMs: number | undefined;

    const textToEmbed =
      aiExtraction.visual_signature ||
      `vật thể: ${aiExtraction.object_type || aiExtraction.product_name || ''}; đặc điểm: ${
        aiExtraction.visual_features || ''
      }; ngành hàng: ${aiExtraction.category_hint || ''}`;

    let vectorWarning: string | undefined;

    if (textToEmbed.trim().length >= 3) {
      const vecStartTime = performance.now();
      try {
        const embeddingRes = await generateVisualEmbedding(textToEmbed);
        vectorTimeMs = Math.round(performance.now() - vecStartTime);

        if (embeddingRes.success && embeddingRes.embedding) {
          const { data: vectorHits, error: vectorErr } = await userClient.rpc(
            'match_products_by_visual_embedding',
            {
              query_embedding: embeddingRes.embedding,
              match_threshold: 0.45,
              match_count: 8,
              target_model: 'gemini-embedding-001',
              target_model_version: 'v1',
            }
          );

          if (!vectorErr && Array.isArray(vectorHits)) {
            console.log(
              `[VECTOR_RPC_HITS] hits_count: ${vectorHits.length} | hits:`,
              vectorHits.map((h: Record<string, unknown>) => ({ id: h.id, code: h.code, similarity: h.similarity }))
            );
            for (const hit of vectorHits) {
              if (hit && hit.id && typeof hit.similarity === 'number') {
                vectorMap.set(hit.id, hit.similarity);
              }
            }
          } else if (vectorErr) {
            vectorWarning = `Truy vấn tương đồng hình ảnh gặp lỗi: ${vectorErr.message}`;
            console.error('[VECTOR_RPC_ERROR]', vectorErr);
          }
        } else {
          vectorWarning = `Tạo vector thất bại: ${embeddingRes.error || 'không thể tạo vector'}`;
          console.error('[VECTOR_EMBEDDING_ERROR]', embeddingRes.error);
        }
      } catch (err: unknown) {
        vectorWarning = 'Lỗi kết nối khi so khớp vector hình ảnh';
        console.error('[VECTOR_SEARCH_ERROR]', err);
      }
    }

    // 11. Thực hiện thuật toán đối chiếu thông minh và xếp hạng kết quả (kết hợp OCR + Visual Vector)
    const matchStartTime = performance.now();
    const matches = rankProductMatches(productsToScan, aiExtraction, vectorMap);
    matchingTimeMs = Math.round(performance.now() - matchStartTime);

    const totalServerTimeMs = Math.round(performance.now() - requestStartTime);

    // Ghi log máy chủ có cấu trúc an toàn: Tuyệt đối không log ảnh, base64, token, hoặc API key
    console.log(
      `[SEARCH_TIMING] reqId: ${requestId} | auth: ${authTimeMs}ms | db: ${dbTimeMs}ms | quota: ${quotaTimeMs}ms | gemini: ${geminiTimeMs}ms | vector: ${
        vectorTimeMs ?? 0
      }ms | matching: ${matchingTimeMs}ms | total: ${totalServerTimeMs}ms | matches: ${matches.length} | vecHits: ${
        vectorMap.size
      }`
    );

    // Log an toàn: mô tả vật thể AI trích xuất, trạng thái vector mã 10, điểm và lý do mã 10 được giữ hoặc bị loại
    const p10Prod = productsToScan.find((p) => p.code === '10');
    const p10InVec = p10Prod ? vectorMap.has(p10Prod.id) : false;
    const p10Sim = p10Prod ? vectorMap.get(p10Prod.id) : undefined;
    const p10Match = matches.find((m) => m.product.code === '10');
    const p10Rank = p10Match ? matches.indexOf(p10Match) + 1 : null;

    console.log(
      `[SEARCH_AUDIT] reqId: ${requestId} | ai_obj: "${aiExtraction.object_type || ''}" | ai_name: "${aiExtraction.product_name || ''}" | ai_sig: "${aiExtraction.visual_signature || ''}" | p10_in_inv: ${Boolean(p10Prod)} | p10_in_vec_hits: ${p10InVec} | p10_sim: ${p10Sim ?? 'none'}`
    );
    console.log(
      `[PROD_10_EVAL] code_10_kept: ${Boolean(p10Match)} | rank: ${p10Rank ?? 'filtered'} | score: ${p10Match?.match_score ?? 0} | reasons:`,
      p10Match?.match_reasons ?? ['không vượt qua bộ lọc hoặc mâu thuẫn loại sản phẩm']
    );

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
          : vectorWarning
          ? `Đã nhận diện đặc điểm vật thể nhưng so khớp vector bị gián đoạn (${vectorWarning}). Chưa tìm thấy sản phẩm phù hợp.`
          : 'Đã nhận diện được thông tin nhưng không có sản phẩm nào phù hợp trong kho.',
      visual_search_warning: vectorWarning,
      quota: {
        remaining_minute: quotaResult.remaining_minute ?? 0,
        remaining_day: quotaResult.remaining_day ?? 0,
      },
      timing: {
        server_total_ms: totalServerTimeMs,
        gemini_ms: geminiTimeMs,
        auth_ms: authTimeMs,
        db_ms: dbTimeMs,
        quota_ms: quotaTimeMs,
        matching_ms: matchingTimeMs,
      },
    };

    return jsonResponse(responsePayload, 200, req);
  } catch (err: unknown) {
    const totalServerTimeMs = Math.round(performance.now() - requestStartTime);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[SEARCH_ERROR] reqId: ${requestId} | unhandled error after ${totalServerTimeMs}ms:`,
      err
    );

    return jsonResponse(
      {
        success: false,
        error: 'internal_server_error',
        message: `Đã xảy ra lỗi trên máy chủ xử lý tìm kiếm ảnh: ${errMsg}`,
      },
      500,
      req
    );
  }
});
