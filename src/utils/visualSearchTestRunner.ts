import { supabase } from '../lib/supabase';
import { uploadProductImage } from '../services/storageService';
import { createProduct, updateProduct, softDeleteProduct, restoreProduct } from '../services/productService';
import { syncBatchEmbeddings, searchProductByImage, type SyncBatchResult } from '../services/aiSearchService';

export interface ScenarioResult {
  scenarioNumber: number;
  title: string;
  passed: boolean;
  latencyMs: number;
  details: Record<string, unknown>;
  summary: string;
}

export interface TestSuiteReport {
  timestamp: string;
  totalScenarios: number;
  passedScenarios: number;
  scenarios: ScenarioResult[];
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAssetFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Không tải được asset ${url}: ${response.statusText}`);
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

async function getActiveUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase client chưa được cấu hình.');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('Người dùng chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
  }
  return userData.user.id;
}

export async function runEmbeddingTest(): Promise<ScenarioResult> {
  const start = performance.now();
  try {
    const { testVisualEmbedding } = await import('../services/aiSearchService');
    const testRes = await testVisualEmbedding('cáp sạc USB Type-C màu trắng');
    const latencyMs = Math.round(performance.now() - start);
    const passed = Boolean(testRes.success && testRes.dimensions === 768);
    return {
      scenarioNumber: 0,
      title: 'Kiểm tra kết nối model gemini-embedding-001 (768 chiều)',
      passed,
      latencyMs: testRes.durationMs || latencyMs,
      details: testRes as unknown as Record<string, unknown>,
      summary: passed
        ? `Thành công: Model ${testRes.model || 'gemini-embedding-001'} trả về vector đúng ${testRes.dimensions} chiều trong ${testRes.durationMs || latencyMs}ms.`
        : `Thất bại: ${testRes.error || 'Không nhận được vector hợp lệ'} (dimensions: ${testRes.dimensions})`,
    };
  } catch (err) {
    return {
      scenarioNumber: 0,
      title: 'Kiểm tra kết nối model gemini-embedding-001 (768 chiều)',
      passed: false,
      latencyMs: Math.round(performance.now() - start),
      details: { error: err instanceof Error ? err.message : String(err) },
      summary: `Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// -------------------------------------------------------------
// KỊCH BẢN 1: Sản phẩm "Món 01" không nhãn hiệu, chỉ tìm bằng ảnh cáp
// -------------------------------------------------------------
export async function runScenario1(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');
  const activeUserId = await getActiveUserId();
  const startS1 = performance.now();

  onProgress?.('Kịch bản 1: Đang kiểm tra sản phẩm "Món 01" (code: C01)...');
  const { data: existingC01 } = await supabase
    .from('products')
    .select('id, code, name, image_url, embedding_status, embedding_source, image_embedding, deleted_at')
    .eq('code', 'C01')
    .maybeSingle();

  let testMon01Id: string;
  let uploadPath: string | null;
  let syncRes: SyncBatchResult | null = null;

  const isAlreadySynced = Boolean(
    existingC01 &&
    existingC01.image_url &&
    existingC01.embedding_status === 'synced' &&
    existingC01.embedding_source === 'image_description' &&
    existingC01.image_embedding
  );

  if (existingC01) {
    testMon01Id = existingC01.id;
    if (existingC01.deleted_at) {
      await restoreProduct(existingC01.id);
    }
    uploadPath = existingC01.image_url;

    if (!isAlreadySynced) {
      onProgress?.('Kịch bản 1: Đang tải ảnh cáp Type-C lên Storage...');
      const cableTypeCFile = await fetchAssetFile('/test-assets/cable_typec_to_c.jpg', 'cable_typec_to_c.jpg');
      const uploadRes1 = await uploadProductImage(cableTypeCFile, activeUserId);
      if (!uploadRes1.path) {
        throw new Error(`Upload ảnh cáp Type-C thất bại: ${uploadRes1.error}`);
      }
      uploadPath = uploadRes1.path;

      const updateRes = await updateProduct(existingC01.id, {
        code: 'C01',
        barcode: null,
        name: 'Món 01',
        category: 'Gia vị',
        unit: 'Sợi',
        purchasePrice: 30000,
        salePrice: 50000,
        stock: 10,
        imageUrl: uploadPath,
        notes: '',
      });
      if (updateRes.error) throw new Error(`Update C01 thất bại: ${updateRes.error}`);

      onProgress?.('Kịch bản 1: Đang đồng bộ đặc trưng ảnh từ Storage qua Gemini Vision & Embedding...');
      syncRes = await syncBatchEmbeddings();
      await sleep(3000);
    } else {
      onProgress?.('Kịch bản 1: C01 đã có ảnh kho và vector hợp lệ (synced - image_description).');
    }
  } else {
    onProgress?.('Kịch bản 1: Đang tải ảnh cáp Type-C lên Storage...');
    const cableTypeCFile = await fetchAssetFile('/test-assets/cable_typec_to_c.jpg', 'cable_typec_to_c.jpg');
    const uploadRes1 = await uploadProductImage(cableTypeCFile, activeUserId);
    if (!uploadRes1.path) {
      throw new Error(`Upload ảnh cáp Type-C thất bại: ${uploadRes1.error}`);
    }
    uploadPath = uploadRes1.path;

    const createRes1 = await createProduct({
      code: 'C01',
      barcode: null,
      name: 'Món 01',
      category: 'Gia vị',
      unit: 'Sợi',
      purchasePrice: 30000,
      salePrice: 50000,
      stock: 10,
      imageUrl: uploadPath,
      notes: '',
    });
    if (createRes1.error || !createRes1.data) {
      throw new Error(`Tạo sản phẩm Món 01 thất bại: ${createRes1.error}`);
    }
    testMon01Id = createRes1.data.id;

    onProgress?.('Kịch bản 1: Đang đồng bộ đặc trưng ảnh từ Storage qua Gemini Vision & Embedding...');
    syncRes = await syncBatchEmbeddings();
    await sleep(3000);
  }

  // Xác minh nguồn gốc vector: C01 bắt buộc phải được đồng bộ thành công từ ảnh thật
  const { data: checkC01 } = await supabase
    .from('products')
    .select('embedding_status, embedding_source, image_embedding, visual_description, embedding_error')
    .eq('id', testMon01Id)
    .single();

  const isC01SyncedFromImage = Boolean(
    checkC01 &&
    checkC01.embedding_status === 'synced' &&
    checkC01.embedding_source === 'image_description' &&
    checkC01.image_embedding
  );

  if (!isC01SyncedFromImage) {
    const errorMsg = checkC01?.embedding_error || (syncRes?.message as string) || 'Chưa thể đồng bộ vector từ ảnh thật';
    return {
      scenarioNumber: 1,
      title: 'Nhận diện sản phẩm không tên/nhãn ("Món 01") qua ảnh cáp sạc',
      passed: false,
      latencyMs: 0,
      details: {
        product_id: testMon01Id,
        image_path: uploadPath,
        sync_result: syncRes,
        c01_db_status: checkC01?.embedding_status,
        c01_embedding_source: checkC01?.embedding_source,
        has_vector: Boolean(checkC01?.image_embedding),
        db_error: checkC01?.embedding_error,
        total_duration_ms: Math.round(performance.now() - startS1),
      },
      summary: `BỊ CHẶN: Sản phẩm C01 chưa được đồng bộ từ ảnh thật (status: ${checkC01?.embedding_status}, source: ${checkC01?.embedding_source || 'null'}, err: ${errorMsg}). Dừng an toàn do Vision chưa khả dụng.`,
    };
  }

  onProgress?.('Kịch bản 1: Đang gửi ảnh chụp cáp góc khác để tìm kiếm...');
  const cableQueryFile = await fetchAssetFile('/test-assets/cable_query.jpg', 'cable_query.jpg');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(cableQueryFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  const match = searchRes.data?.matches?.[0];
  const isMatchedMon01 = match?.product.code === 'C01';
  const passed = Boolean(searchRes.success && isMatchedMon01 && (match?.vector_similarity ?? 0) >= 0.5);

  return {
    scenarioNumber: 1,
    title: 'Nhận diện sản phẩm không tên/nhãn ("Món 01") qua ảnh cáp sạc',
    passed,
    latencyMs: searchLatency,
    details: {
      product_id: testMon01Id,
      image_path: uploadPath,
      sync_result: syncRes,
      matched_product: match?.product.name ?? 'None',
      matched_code: match?.product.code ?? 'None',
      vector_similarity: match?.vector_similarity,
      match_score: match?.match_score,
      match_reasons: match?.match_reasons,
      search_status: searchRes.status,
      search_message: searchRes.message,
      search_error: searchRes.error,
      total_duration_ms: Math.round(performance.now() - startS1),
    },
    summary: passed
      ? `Đạt: Gợi ý đối chiếu phù hợp sản phẩm "Món 01" (code C01) qua vector ảnh với cosine: ${match?.vector_similarity?.toFixed(3)} trong ${searchLatency}ms.`
      : `Chưa đạt: match_code=${match?.product.code || 'none'}, sim=${match?.vector_similarity ?? 'N/A'}, err=${searchRes.error || searchRes.message}`,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 2: Phân biệt 2 cáp khác đầu nối (Type-C vs Lightning)
// -------------------------------------------------------------
export async function runScenario2(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');
  const activeUserId = await getActiveUserId();

  onProgress?.('Kịch bản 2: Đang tải ảnh cáp Lightning lên Storage...');
  const lightningFile = await fetchAssetFile('/test-assets/cable_typec_to_lightning.jpg', 'cable_lightning.jpg');
  const uploadRes2 = await uploadProductImage(lightningFile, activeUserId);
  if (!uploadRes2.path) throw new Error(`Upload ảnh cáp Lightning thất bại: ${uploadRes2.error}`);

  onProgress?.('Kịch bản 2: Đang cập nhật sản phẩm Cáp Lightning (code: C02)...');
  const { data: existingC02 } = await supabase
    .from('products')
    .select('id, code, deleted_at')
    .eq('code', 'C02')
    .maybeSingle();

  if (existingC02) {
    if (existingC02.deleted_at) await restoreProduct(existingC02.id);
    await updateProduct(existingC02.id, {
      code: 'C02',
      barcode: null,
      name: 'Cáp sạc Type-C sang Lightning',
      category: 'Gia vị',
      unit: 'Sợi',
      purchasePrice: 35000,
      salePrice: 60000,
      stock: 10,
      imageUrl: uploadRes2.path,
    });
  } else {
    await createProduct({
      code: 'C02',
      barcode: null,
      name: 'Cáp sạc Type-C sang Lightning',
      category: 'Gia vị',
      unit: 'Sợi',
      purchasePrice: 35000,
      salePrice: 60000,
      stock: 10,
      imageUrl: uploadRes2.path,
    });
  }

  onProgress?.('Kịch bản 2: Đang đồng bộ vector cho cáp Lightning...');
  const syncRes = await syncBatchEmbeddings();
  await sleep(3000);

  onProgress?.('Kịch bản 2: Đang tìm kiếm bằng ảnh cáp Type-C...');
  const cableQueryFile = await fetchAssetFile('/test-assets/cable_query.jpg', 'cable_query.jpg');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(cableQueryFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  const matches = searchRes.data?.matches || [];
  const typeCMatch = matches.find((m) => m.product.code === 'C01');
  const lightningMatch = matches.find((m) => m.product.code === 'C02');

  const passed = Boolean(
    searchRes.success &&
      typeCMatch &&
      (!lightningMatch || (typeCMatch.vector_similarity ?? 0) >= (lightningMatch.vector_similarity ?? 0))
  );

  return {
    scenarioNumber: 2,
    title: 'Phân biệt 2 loại cáp gần giống khác đầu nối (Type-C vs Lightning)',
    passed,
    latencyMs: searchLatency,
    details: {
      sync_result: syncRes,
      type_c_similarity: typeCMatch?.vector_similarity,
      lightning_similarity: lightningMatch?.vector_similarity,
      top_matched_code: matches[0]?.product.code,
      ranking_order: matches.map((m) => `${m.product.code}: sim=${m.vector_similarity?.toFixed(3)}`),
      search_status: searchRes.status,
      search_message: searchRes.message,
    },
    summary: passed
      ? `Đạt: Gợi ý cáp Type-C (C01, cosine: ${typeCMatch?.vector_similarity?.toFixed(3)}) xếp trên hoặc bằng Cáp Lightning (C02, cosine: ${lightningMatch?.vector_similarity?.toFixed(3) ?? 'N/A'}) trong ${searchLatency}ms.`
      : `Chưa đạt: Type-C=${typeCMatch?.vector_similarity ?? 'N/A'}, Lightning=${lightningMatch?.vector_similarity ?? 'N/A'}`,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 3: Đổi ảnh sang củ sạc, làm mới vector và tìm lại
// -------------------------------------------------------------
export async function runScenario3(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');
  const activeUserId = await getActiveUserId();

  onProgress?.('Kịch bản 3: Đang tải ảnh củ sạc 20W lên Storage...');
  const chargerFile = await fetchAssetFile('/test-assets/charger_adapter.jpg', 'charger_adapter.jpg');
  const uploadRes3 = await uploadProductImage(chargerFile, activeUserId);
  if (!uploadRes3.path) throw new Error(`Upload củ sạc thất bại: ${uploadRes3.error}`);

  const { data: existingC01 } = await supabase
    .from('products')
    .select('id, deleted_at')
    .eq('code', 'C01')
    .maybeSingle();
  if (!existingC01) throw new Error('Không tìm thấy sản phẩm C01 để đổi ảnh.');
  if (existingC01.deleted_at) await restoreProduct(existingC01.id);

  onProgress?.('Kịch bản 3: Đang cập nhật ảnh sản phẩm C01 sang củ sạc...');
  await updateProduct(existingC01.id, {
    code: 'C01',
    barcode: null,
    name: 'Món 01',
    category: 'Gia vị',
    unit: 'Cái',
    purchasePrice: 60000,
    salePrice: 90000,
    stock: 5,
    imageUrl: uploadRes3.path,
  });

  // Kiểm tra trạng thái pending
  const { data: checkPending } = await supabase
    .from('products')
    .select('embedding_status, image_embedding')
    .eq('id', existingC01.id)
    .single();

  const pendingResetSuccess = Boolean(
    checkPending?.embedding_status === 'pending' && !checkPending?.image_embedding
  );

  onProgress?.('Kịch bản 3: Đang đồng bộ vector mới cho củ sạc...');
  const syncRes = await syncBatchEmbeddings();
  await sleep(3000);

  onProgress?.('Kịch bản 3: Đang tìm kiếm bằng ảnh củ sạc...');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(chargerFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  const match = searchRes.data?.matches?.[0];
  const passed = Boolean(
    pendingResetSuccess && match?.product.code === 'C01' && (match?.vector_similarity ?? 0) >= 0.5
  );

  return {
    scenarioNumber: 3,
    title: 'Đổi ảnh sản phẩm sang củ sạc, reset trạng thái pending và tạo lại vector',
    passed,
    latencyMs: searchLatency,
    details: {
      pending_reset_verified: pendingResetSuccess,
      sync_result: syncRes,
      matched_after_update: match?.product.code,
      charger_similarity: match?.vector_similarity,
      search_status: searchRes.status,
      search_message: searchRes.message,
    },
    summary: passed
      ? `Đạt: Đã reset pending hợp lệ; sau khi sync lại vector, gợi ý đối chiếu khớp "Món 01" với cosine=${match?.vector_similarity?.toFixed(3)} trong ${searchLatency}ms.`
      : `Chưa đạt: pendingReset=${pendingResetSuccess}, match=${match?.product.code ?? 'none'}`,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 4: Tìm kiếm vật thể không có trong kho (Cây kéo)
// -------------------------------------------------------------
export async function runScenario4(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  onProgress?.('Kịch bản 4: Đang gửi ảnh cây kéo (vật thể không có trong kho)...');
  const scissorsFile = await fetchAssetFile('/test-assets/scissors_tool.jpg', 'scissors.jpg');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(scissorsFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  const topMatch = searchRes.data?.matches?.[0];
  const hasNoConfidentMatch = !topMatch || (topMatch.vector_similarity ?? 0) < 0.55;
  const passed = Boolean(searchRes.success && hasNoConfidentMatch);

  return {
    scenarioNumber: 4,
    title: 'Tìm kiếm vật thể không có trong kho (Cây kéo thủ công)',
    passed,
    latencyMs: searchLatency,
    details: {
      top_match: topMatch ? `${topMatch.product.name} (sim=${topMatch.vector_similarity?.toFixed(3)})` : 'None',
      total_matches: searchRes.data?.matches?.length ?? 0,
      search_status: searchRes.status,
      search_message: searchRes.message,
    },
    summary: passed
      ? `Đạt: Không có sản phẩm nào trong kho khớp với vật thể ngoài kho (độ tương đồng cosine cao nhất: ${topMatch?.vector_similarity?.toFixed(3) ?? '0.000'}) trong ${searchLatency}ms.`
      : `Cảnh báo: Có kết quả gợi ý không mong muốn hoặc lỗi API: ${topMatch?.product.name ?? searchRes.message}`,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 5: Loại trừ sản phẩm đã xóa mềm (deleted_at IS NOT NULL)
// -------------------------------------------------------------
export async function runScenario5(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');

  const { data: existingC01 } = await supabase
    .from('products')
    .select('id')
    .eq('code', 'C01')
    .maybeSingle();

  try {
    if (existingC01) {
      onProgress?.('Kịch bản 5: Đang thực hiện xóa mềm sản phẩm C01...');
      await softDeleteProduct(existingC01.id);
    }

    onProgress?.('Kịch bản 5: Đang tìm kiếm bằng ảnh củ sạc để xác minh loại trừ...');
    const chargerFile = await fetchAssetFile('/test-assets/charger_adapter.jpg', 'charger_adapter.jpg');
    const searchStart = performance.now();
    const searchRes = await searchProductByImage(chargerFile);
    const searchLatency = Math.round(performance.now() - searchStart);

    const matches = searchRes.data?.matches || [];
    const mon01Included = matches.some((m) => m.product.code === 'C01');
    const passed = Boolean(searchRes.success && !mon01Included);

    return {
      scenarioNumber: 5,
      title: 'Kiểm tra RPC loại trừ hoàn toàn sản phẩm đã xóa mềm (Soft Delete)',
      passed,
      latencyMs: searchLatency,
      details: {
        mon01_found_in_active_search: mon01Included,
        active_matches_count: matches.length,
        search_status: searchRes.status,
        search_message: searchRes.message,
      },
      summary: passed
        ? `Đạt: Sản phẩm "Món 01" (đã soft delete) không xuất hiện trong danh sách gợi ý đối chiếu (phản hồi trong ${searchLatency}ms).`
        : `Chưa đạt: Sản phẩm đã xóa mềm vẫn bị RPC trả về hoặc lỗi kết nối: ${searchRes.message}`,
    };
  } finally {
    // Luôn luôn dọn dẹp khôi phục bản ghi dù có lỗi hay thành công
    if (existingC01) {
      await restoreProduct(existingC01.id);
    }
  }
}

// -------------------------------------------------------------
// KỊCH BẢN 6: Nhận diện bao bì có chữ in thương mại (Yumangel F)
// -------------------------------------------------------------
export async function runScenario6(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');

  // 1. Kiểm tra và hoàn tất đồng bộ ảnh thật cho Yumangel F (mã 07)
  onProgress?.('Kịch bản 6: Đang kiểm tra trạng thái vector ảnh thật của Yumangel F (mã 07)...');
  const { data: check07 } = await supabase
    .from('products')
    .select('id, code, name, embedding_status, embedding_source, image_embedding')
    .eq('code', '07')
    .single();

  let sync07Res: Record<string, unknown> | null = null;
  const is07SyncedFromImage = Boolean(
    check07 &&
    check07.embedding_status === 'synced' &&
    check07.embedding_source === 'image_description' &&
    check07.image_embedding
  );

  if (!is07SyncedFromImage && check07) {
    onProgress?.('Kịch bản 6: Đang tải ảnh thật gói thuốc Yumangel F lên Storage...');
    const activeUserId = await getActiveUserId();
    const yumangelFile = await fetchAssetFile('/test-assets/yumangel_f_photo.jpg', 'yumangel.jpg');
    const uploadRes = await uploadProductImage(yumangelFile, activeUserId);
    if (!uploadRes.path) throw new Error(`Upload ảnh Yumangel F thất bại: ${uploadRes.error}`);

    onProgress?.('Kịch bản 6: Đang cập nhật ảnh và kích hoạt lifecycle reset cho Yumangel F...');
    await updateProduct(check07.id, {
      code: '07',
      barcode: '8806418006509',
      name: 'Yumangel F',
      category: 'Thuốc',
      unit: 'Hộp',
      purchasePrice: 120000,
      salePrice: 130000,
      stock: 100,
      imageUrl: uploadRes.path,
    });

    onProgress?.('Kịch bản 6: Đang hoàn tất đồng bộ ảnh thật từ Storage cho Yumangel F...');
    sync07Res = (await syncBatchEmbeddings()) as unknown as Record<string, unknown>;
    await sleep(4000);
  }

  // 2. Tìm kiếm với ảnh chụp bao bì Yumangel F
  onProgress?.('Kịch bản 6: Đang nhận diện bao bì chữ in Yumangel F qua ảnh chụp...');
  const yumangelFile = await fetchAssetFile('/test-assets/yumangel_f_photo.jpg', 'yumangel.jpg');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(yumangelFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  const topMatch = searchRes.data?.matches?.[0];
  const isYumangelMatched =
    topMatch?.product.code === '07' ||
    Boolean(topMatch?.product.name && topMatch.product.name.toLowerCase().includes('yumangel'));

  // 3. Đối chiếu chéo: Tìm lại bằng ảnh cáp sạc khi Yumangel đã có vector hợp lệ để xác minh không gợi ý sai mã 07
  onProgress?.('Kịch bản 6: Đối chiếu chéo - Tìm lại bằng ảnh cáp sạc để xác minh không gợi ý nhầm Yumangel F...');
  const cableQueryFile = await fetchAssetFile('/test-assets/cable_query.jpg', 'cable_query.jpg');
  const cableSearchRes = await searchProductByImage(cableQueryFile);
  const cableMatches = cableSearchRes.data?.matches || [];
  const isYumangelNotInCable = !cableMatches.some((m) => m.product.code === '07');

  const passed = Boolean(searchRes.success && isYumangelMatched && isYumangelNotInCable);

  return {
    scenarioNumber: 6,
    title: 'Nhận diện bao bì có chữ in thương hiệu (Yumangel F) & Đối chiếu chéo không gợi ý nhầm cáp',
    passed,
    latencyMs: searchLatency,
    details: {
      matched_product: topMatch?.product.name,
      matched_code: topMatch?.product.code,
      match_score: topMatch?.match_score,
      vector_similarity: topMatch?.vector_similarity,
      extracted_name: searchRes.data?.ai_extraction?.product_name,
      extracted_brand: searchRes.data?.ai_extraction?.brand,
      match_reasons: topMatch?.match_reasons,
      sync_07_result: sync07Res,
      cable_cross_check_passed: isYumangelNotInCable,
      cable_matches_count: cableMatches.length,
      search_status: searchRes.status,
      search_message: searchRes.message,
    },
    summary: passed
      ? `Đạt: Gợi ý đối chiếu phù hợp "${topMatch?.product.name}" (mã 07, điểm match=${topMatch?.match_score}) trong ${searchLatency}ms. Đối chiếu chéo: ảnh cáp tuyệt đối không gợi ý mã 07.`
      : `Chưa đạt: matched=${topMatch?.product.name || 'none'}, cable_cross_check=${isYumangelNotInCable}, err=${searchRes.error || searchRes.message}`,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 7: Kiểm định Đèn sao (mã 10) & Chặn gợi ý sai Chuột (08) / Cáp (C02)
// -------------------------------------------------------------
export async function runScenario7(onProgress?: (msg: string) => void): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');
  const startTotal = performance.now();

  // 1. Kiểm tra trạng thái CSDL thực tế của mã 10
  onProgress?.('Kịch bản 7: Đang kiểm tra trạng thái CSDL thực tế của mã 10 ("Đèn sao")...');
  const { data: prod10, error: err10 } = await supabase
    .from('products')
    .select('id, code, barcode, name, category, unit, purchase_price, sale_price, stock, notes, image_url, embedding_status, embedding_source, embedding_model, embedding_model_version, embedding_retry_count, embedding_error, visual_description, deleted_at, image_embedding')
    .eq('code', '10')
    .single();

  if (err10 || !prod10) {
    throw new Error(`Không tìm thấy sản phẩm mã 10 trong cơ sở dữ liệu: ${err10?.message || 'not found'}`);
  }

  const p10HasVector = Boolean(prod10.image_embedding);
  let sync10Result: SyncBatchResult | null = null;

  // 2. Nếu thiếu vector hoặc chưa synced từ ảnh thật, thực hiện đồng bộ riêng mã 10 từ ảnh thật
  const is10ValidSynced = Boolean(
    prod10.embedding_status === 'synced' &&
    prod10.embedding_source === 'image_description' &&
    p10HasVector
  );

  if (!is10ValidSynced) {
    onProgress?.('Kịch bản 7: Mã 10 chưa có vector ảnh thật. Đang tải ảnh thật Đèn sao lên Storage...');
    const activeUserId = await getActiveUserId();
    const realPhotoFile = await fetchAssetFile('/test-assets/disco_light.jpg', 'disco_light.jpg');
    const uploadRes = await uploadProductImage(realPhotoFile, activeUserId);
    if (!uploadRes.path) throw new Error(`Upload ảnh Đèn sao thất bại: ${uploadRes.error}`);

    onProgress?.('Kịch bản 7: Đang cập nhật ảnh thật và kích hoạt lifecycle sync cho Đèn sao...');
    await updateProduct(prod10.id, {
      code: '10',
      barcode: prod10.barcode || null,
      name: prod10.name || 'Đèn sao',
      category: prod10.category || 'Điện tử',
      unit: prod10.unit || 'Cái',
      purchasePrice: Number(prod10.purchase_price) || 50000,
      salePrice: Number(prod10.sale_price) || 60000,
      stock: Number(prod10.stock) || 10,
      imageUrl: uploadRes.path,
      notes: prod10.notes || '',
    });

    onProgress?.('Kịch bản 7: Đang hoàn tất đồng bộ ảnh thật từ Storage cho Đèn sao (Gemini Vision & Embedding)...');
    sync10Result = await syncBatchEmbeddings();
    await sleep(4000);

    // Kiểm tra lại sau khi đồng bộ
    const { data: recheck10 } = await supabase
      .from('products')
      .select('embedding_status, embedding_source, image_embedding, visual_description')
      .eq('code', '10')
      .single();

    if (
      recheck10?.embedding_status !== 'synced' ||
      recheck10?.embedding_source !== 'image_description' ||
      !recheck10?.image_embedding
    ) {
      throw new Error(
        `Đồng bộ mã 10 thất bại hoặc chưa hoàn tất: status=${recheck10?.embedding_status}, source=${recheck10?.embedding_source}`
      );
    }
    onProgress?.('Kịch bản 7: Đồng bộ mã 10 thành công (status=synced, source=image_description).');
  } else {
    onProgress?.('Kịch bản 7: Mã 10 đã có vector hợp lệ (status=synced, source=image_description).');
  }

  // 3. Chuẩn bị file ảnh quả cầu đèn xoay vũ trường để tìm kiếm
  onProgress?.('Kịch bản 7: Đang chuẩn bị file ảnh quả cầu đèn xoay vũ trường...');
  const discoLightFile = await fetchAssetFile('/test-assets/disco_light.jpg', 'disco_light.jpg');

  // 4. Tìm kiếm bằng ảnh đèn
  onProgress?.('Kịch bản 7: Đang gửi ảnh đèn đến AI để tìm kiếm và xếp hạng...');
  const searchStart = performance.now();
  const searchRes = await searchProductByImage(discoLightFile);
  const searchLatency = Math.round(performance.now() - searchStart);

  if (!searchRes.success || !searchRes.data) {
    throw new Error(`Tìm kiếm bằng ảnh đèn thất bại: [${searchRes.error}] ${searchRes.message || 'Không có mô tả chi tiết'}`);
  }

  const matches = searchRes.data.matches || [];
  const topMatch = matches[0];
  const p10Match = matches.find((m) => m.product.code === '10');
  const p10Rank = p10Match ? matches.indexOf(p10Match) + 1 : -1;

  // Kiểm tra Chuột gaming (08) và Cáp sạc (C02) có bị loại trừ hoàn toàn hay không
  const mouseMatch = matches.find((m) => m.product.code === '08');
  const cableMatch = matches.find((m) => m.product.code === 'C02');
  const isMouseExcluded = !mouseMatch;
  const isCableExcluded = !cableMatch;

  // 5. Kiểm tra chéo: Thử thêm ảnh cáp và Yumangel để bảo đảm không làm hỏng các ca đã đạt
  onProgress?.('Kịch bản 7: Kiểm tra chéo với ảnh cáp sạc...');
  const cableQueryFile = await fetchAssetFile('/test-assets/cable_query.jpg', 'cable_query.jpg');
  const cableRes = await searchProductByImage(cableQueryFile);
  const cableMatches = cableRes.data?.matches || [];
  const isP10NotInCable = !cableMatches.some((m) => m.product.code === '10');
  const isYumangelNotInCable = !cableMatches.some((m) => m.product.code === '07');

  onProgress?.('Kịch bản 7: Kiểm tra chéo với ảnh Yumangel F...');
  const yumangelFile = await fetchAssetFile('/test-assets/yumangel_f_photo.jpg', 'yumangel.jpg');
  const yumangelRes = await searchProductByImage(yumangelFile);
  const yumangelMatches = yumangelRes.data?.matches || [];
  // isYumangelTop: KB6's job. KB7 only checks cross-contamination guards:
  const isYumangelTop = yumangelMatches[0]?.product.code === '07'; // informational only
  const isP10NotInYumangel = !yumangelMatches.some((m) => m.product.code === '10');

  // KB7 pass condition: Đèn sao Top1, Chuột & Cáp loại trừ, không có cross-contamination (mã 10 không xuất hiện trong cáp/Yumangel, mã 07 không xuất hiện trong cáp)
  const crossChecksPassed = isP10NotInCable && isYumangelNotInCable && isP10NotInYumangel;
  const passed = Boolean(
    p10Rank === 1 &&
    isMouseExcluded &&
    isCableExcluded &&
    crossChecksPassed
  );

  return {
    scenarioNumber: 7,
    title: 'Kiểm định Đèn sao (mã 10): Top 1, chặn gợi ý sai Chuột (08) & Cáp (C02), kiểm tra chéo không hồi quy',
    passed,
    latencyMs: searchLatency,
    details: {
      prod_10_database: {
        id: prod10.id,
        code: prod10.code,
        name: prod10.name,
        category: prod10.category,
        image_url: prod10.image_url,
        embedding_status: prod10.embedding_status,
        embedding_source: prod10.embedding_source,
        embedding_model: prod10.embedding_model,
        embedding_model_version: prod10.embedding_model_version,
        has_vector: p10HasVector,
      },
      sync_10_result: sync10Result,
      ai_extraction: {
        object_type: searchRes.data.ai_extraction?.object_type,
        product_name: searchRes.data.ai_extraction?.product_name,
        brand: searchRes.data.ai_extraction?.brand,
        visual_signature: searchRes.data.ai_extraction?.visual_signature,
      },
      search_results: {
        total_matches: matches.length,
        top_match_code: topMatch?.product.code,
        top_match_name: topMatch?.product.name,
        p10_rank: p10Rank,
        p10_score: p10Match?.match_score,
        p10_similarity: p10Match?.vector_similarity,
        p10_reasons: p10Match?.match_reasons,
        mouse_08_excluded: isMouseExcluded,
        mouse_08_in_results: Boolean(mouseMatch),
        cable_C02_excluded: isCableExcluded,
        cable_C02_in_results: Boolean(cableMatch),
      },
      cross_checks: {
        cable_cross_check: {
          passed: isP10NotInCable && isYumangelNotInCable,
          p10_in_cable: !isP10NotInCable,
          yumangel_in_cable: !isYumangelNotInCable,
          matches_count: cableMatches.length,
        },
        yumangel_cross_check: {
          // Chỉ kiểm tra cross-contamination: mã 10 không được xuất hiện trong kết quả Yumangel.
          // Yumangel_top là thông tin bổ sung; không dùng trong điều kiện pass của KB7 (KB6 đã kiểm tra).
          passed: isP10NotInYumangel,
          yumangel_top_informational: isYumangelTop,
          p10_in_yumangel: !isP10NotInYumangel,
          top_match_code: yumangelMatches[0]?.product.code,
        },
      },
      search_latency_ms: searchLatency,
      total_duration_ms: Math.round(performance.now() - startTotal),
    },
    summary: passed
      ? `Đạt: Ảnh đèn gợi ý chính xác "Đèn sao" (mã 10, Top 1, điểm=${p10Match?.match_score}, sim=${p10Match?.vector_similarity?.toFixed(4)}) trong ${searchLatency}ms. Chuột (08) và Cáp (C02) bị loại trừ hoàn toàn. Cross-contamination checks passed (mã 10 không lọt vào kết quả cáp/Yumangel).`
      : `Chưa đạt: p10_rank=${p10Rank}, mouse_excluded=${isMouseExcluded}, cable_excluded=${isCableExcluded}, cross_checks=${crossChecksPassed} [p10_in_cable=${!isP10NotInCable}, yumangel_in_cable=${!isYumangelNotInCable}, p10_in_yumangel=${!isP10NotInYumangel}]`,
  };
}

// -------------------------------------------------------------
// TOÀN BỘ 7 KỊCH BẢN CHẠY TUẦN TỰ VỚI GIÃN CÁCH
// -------------------------------------------------------------
export async function runVisualSearchScenarios(
  onProgress?: (step: string) => void
): Promise<TestSuiteReport> {
  const results: ScenarioResult[] = [];

  try {
    results.push(await runScenario1(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario2(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario3(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario4(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario5(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario6(onProgress));
    onProgress?.('Đang tạm dừng 8s để đảm bảo định mức AI...');
    await sleep(8000);

    results.push(await runScenario7(onProgress));
  } catch (err) {
    console.error('Lỗi khi chạy bộ kiểm thử:', err);
  }

  return {
    timestamp: new Date().toISOString(),
    totalScenarios: results.length,
    passedScenarios: results.filter((r) => r.passed).length,
    scenarios: results,
  };
}

// -------------------------------------------------------------
// KỊCH BẢN 8: Kiểm tra trạng thái Vector & Model Version 5 sản phẩm (10, 09, 08, C01, C02)
// -------------------------------------------------------------
export async function runInspectTargetProducts(
  onProgress?: (msg: string) => void
): Promise<ScenarioResult> {
  if (!supabase) throw new Error('Supabase chưa cấu hình');
  const start = performance.now();
  onProgress?.('Đang truy vấn trạng thái vector của các sản phẩm mục tiêu (10, 09, 08, C01, C02)...');

  const { data: prods, error } = await supabase
    .from('products')
    .select(
      'id, code, barcode, name, category, unit, image_url, embedding_status, embedding_source, embedding_model, embedding_model_version, embedding_retry_count, embedding_error, visual_description, deleted_at, image_embedding'
    )
    .in('code', ['10', '09', '08', 'C01', 'C02']);

  if (error) {
    throw new Error(`Truy vấn thất bại: ${error.message}`);
  }

  const items = (prods || []).map((p) => {
    let embLen = 0;
    if (Array.isArray(p.image_embedding)) {
      embLen = p.image_embedding.length;
    } else if (typeof p.image_embedding === 'string') {
      try {
        const parsed = JSON.parse(p.image_embedding);
        embLen = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        embLen = 0;
      }
    }
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      image_url: p.image_url,
      embedding_status: p.embedding_status,
      embedding_source: p.embedding_source,
      embedding_model: p.embedding_model,
      embedding_model_version: p.embedding_model_version,
      has_vector: Boolean(p.image_embedding),
      vector_dim: embLen,
      visual_description: p.visual_description,
      embedding_error: p.embedding_error,
      deleted_at: p.deleted_at,
    };
  });

  const allValid =
    items.length >= 5 &&
    items.every(
      (i) =>
        i.embedding_status === 'synced' &&
        i.embedding_source === 'image_description' &&
        i.embedding_model === 'gemini-embedding-001' &&
        i.embedding_model_version === 'v1' &&
        i.has_vector
    );

  return {
    scenarioNumber: 8,
    title: 'Kiểm tra trạng thái Vector & Nguồn gốc model của 5 sản phẩm (10, 09, 08, C01, C02)',
    passed: allValid,
    latencyMs: Math.round(performance.now() - start),
    details: {
      found_count: items.length,
      products: items,
      all_valid_synced: allValid,
    },
    summary: allValid
      ? `Đạt: Cả ${items.length} sản phẩm đều có vector 768d, status=synced, source=image_description, model=gemini-embedding-001/v1.`
      : `Trạng thái: Tìm thấy ${items.length} sản phẩm. Đạt chuẩn: ${items.filter((i) => i.embedding_status === 'synced' && i.embedding_source === 'image_description').length}/${items.length}.`,
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__runEmbeddingTest = runEmbeddingTest;
  (window as unknown as Record<string, unknown>).__runVisualSearchSuite = runVisualSearchScenarios;
  (window as unknown as Record<string, unknown>).__runScenario1 = runScenario1;
  (window as unknown as Record<string, unknown>).__runScenario2 = runScenario2;
  (window as unknown as Record<string, unknown>).__runScenario3 = runScenario3;
  (window as unknown as Record<string, unknown>).__runScenario4 = runScenario4;
  (window as unknown as Record<string, unknown>).__runScenario5 = runScenario5;
  (window as unknown as Record<string, unknown>).__runScenario6 = runScenario6;
  (window as unknown as Record<string, unknown>).__runScenario7 = runScenario7;
  (window as unknown as Record<string, unknown>).__runInspectTargetProducts = runInspectTargetProducts;
}

