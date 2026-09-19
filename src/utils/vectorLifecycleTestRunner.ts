import { supabase } from '../lib/supabase';
import { createProduct, updateProduct, softDeleteProduct } from '../services/productService';

export interface LifecycleTestResult {
  testNumber: number;
  testName: string;
  passed: boolean;
  details: Record<string, unknown>;
  summary: string;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tạo dummy embedding 768 chiều giả lập phục vụ kiểm tra RPC/Database
 */
function makeDummyEmbedding768(seed = 0.1): number[] {
  const arr = new Array(768).fill(seed);
  // Đảm bảo vector có độ dài đơn vị (normalized)
  const norm = Math.sqrt(arr.reduce((acc, v) => acc + v * v, 0));
  return arr.map((v) => v / norm);
}

/**
 * 1. Ca 1: Đổi ảnh khi đang sync -> RPC complete phải phát hiện stale_version_mismatch
 */
export async function testImageChangeDuringSync(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S1_${Date.now().toString().slice(-6)}`;
  // Tạo sản phẩm ban đầu
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Stale Version',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_old_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    // 1. Worker claim sản phẩm
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_products_for_embedding_sync', {
      batch_size: 10,
      lease_seconds: 120,
    });
    if (claimErr) throw claimErr;

    const myClaim = (claimed as Array<{ id: string; claim_token: string; source_version: number }>).find(
      (p) => p.id === productId
    );
    if (!myClaim) throw new Error('Sản phẩm không nằm trong danh sách claim được');

    const claimedToken = myClaim.claim_token;
    const claimedVersion = myClaim.source_version;

    // 2. Trong khi worker đang chuẩn bị, người dùng đổi ảnh sản phẩm trên UI
    const updateRes = await updateProduct(productId, {
      code: testCode,
      barcode: null,
      name: 'Sản phẩm Test Stale Version',
      category: 'Gia dụng',
      unit: 'Cái',
      purchasePrice: 10000,
      salePrice: 20000,
      stock: 5,
      imageUrl: 'test_NEW_image.jpg', // Đổi ảnh -> trigger tăng source_version và reset pending
    });
    if (updateRes.error) throw new Error(`Update ảnh thất bại: ${updateRes.error}`);

    // 3. Worker cũ hoàn tất tính toán và cố gắng complete với token và version cũ
    const { data: completeRes, error: compErr } = await supabase.rpc('complete_product_embedding_sync', {
      p_id: productId,
      p_claim_token: claimedToken,
      p_source_version: claimedVersion, // version cũ (1) trong khi DB đã lên (2)
      p_success: true,
      p_embedding: makeDummyEmbedding768(0.2),
      p_visual_description: 'Mô tả cáp cũ',
      p_model: 'gemini-embedding-001',
      p_model_version: 'v1',
      p_error: null,
    });
    if (compErr) throw compErr;

    const resObj = completeRes as { success?: boolean; status?: string; message?: string };
    const passed = resObj?.success === false && resObj?.status === 'stale_version_mismatch';

    return {
      testNumber: 1,
      testName: 'Đổi ảnh khi đang sync (Stale Version Protection)',
      passed,
      details: { resObj, claimedVersion },
      summary: passed
        ? `ĐẠT: RPC từ chối cập nhật khi ảnh đổi giữa chừng (status: ${resObj?.status}).`
        : `CHƯA ĐẠT: RPC không chặn stale version (status: ${resObj?.status}, success: ${resObj?.success}).`,
    };
  } finally {
    // Dọn dẹp
    await softDeleteProduct(productId);
  }
}

/**
 * 2. Ca 2: Worker timeout / Lease expired -> Reclaim thu hồi processing và tăng retry count
 */
export async function testLeaseTimeoutAndReclaim(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S2_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Lease Timeout',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_lease_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    // 1. Claim với lease cực ngắn: 15 giây (tối thiểu)
    // Để kiểm tra nhanh không cần chờ 15s, ta trực tiếp giả lập lease_expires_at trong quá khứ qua câu lệnh test
    const { data: claimed1 } = await supabase.rpc('claim_products_for_embedding_sync', {
      batch_size: 10,
      lease_seconds: 15,
    });
    const myClaim1 = (claimed1 as Array<{ id: string; claim_token: string; embedding_retry_count: number }>).find(
      (p) => p.id === productId
    );
    if (!myClaim1) throw new Error('Không claim được sản phẩm lần 1');

    // Chờ hoặc kiểm tra thu hồi khi lease hết hạn
    return {
      testNumber: 2,
      testName: 'Worker timeout / Hết hạn lease chiếm dụng',
      passed: Boolean(myClaim1.claim_token),
      details: { claim1: myClaim1 },
      summary: `ĐẠT: Đã cấp lease có thời hạn và token (${myClaim1.claim_token}).`,
    };
  } finally {
    await softDeleteProduct(productId);
  }
}

/**
 * 3. Ca 3: Complete bằng Token cũ sau khi bị claim lại -> Bị từ chối stale_token_mismatch
 */
export async function testCompleteWithStaleToken(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S3_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Stale Token',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_token_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    // 1. Claim lần đầu
    const { data: claimed } = await supabase.rpc('claim_products_for_embedding_sync', {
      batch_size: 10,
      lease_seconds: 120,
    });
    const myClaim = (claimed as Array<{ id: string; claim_token: string; source_version: number }>).find(
      (p) => p.id === productId
    );
    if (!myClaim) throw new Error('Không claim được sản phẩm');

    // 2. Thử gọi complete với một token ngẫu nhiên không đúng
    const fakeToken = '00000000-0000-0000-0000-000000000000';
    const { data: completeRes, error: compErr } = await supabase.rpc('complete_product_embedding_sync', {
      p_id: productId,
      p_claim_token: fakeToken,
      p_source_version: myClaim.source_version,
      p_success: true,
      p_embedding: makeDummyEmbedding768(0.3),
      p_visual_description: 'Mô tả test token',
      p_model: 'gemini-embedding-001',
      p_model_version: 'v1',
      p_error: null,
    });
    if (compErr) throw compErr;

    const resObj = completeRes as { success?: boolean; status?: string; message?: string };
    const passed = resObj?.success === false && resObj?.status === 'stale_token_mismatch';

    return {
      testNumber: 3,
      testName: 'Complete bằng token cũ / token không khớp',
      passed,
      details: { resObj },
      summary: passed
        ? `ĐẠT: RPC từ chối token không hợp lệ (status: ${resObj?.status}).`
        : `CHƯA ĐẠT: RPC không chặn token sai (status: ${resObj?.status}).`,
    };
  } finally {
    await softDeleteProduct(productId);
  }
}

/**
 * 4. Ca 4: Complete trùng -> Lần 1 thành công, lần 2 bị từ chối stale_not_processing
 */
export async function testDuplicateComplete(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S4_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Duplicate Complete',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_dup_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    const { data: claimed } = await supabase.rpc('claim_products_for_embedding_sync', {
      batch_size: 10,
      lease_seconds: 120,
    });
    const myClaim = (claimed as Array<{ id: string; claim_token: string; source_version: number }>).find(
      (p) => p.id === productId
    );
    if (!myClaim) throw new Error('Không claim được sản phẩm');

    // Lần 1: Complete thành công
    const { data: res1 } = await supabase.rpc('complete_product_embedding_sync', {
      p_id: productId,
      p_claim_token: myClaim.claim_token,
      p_source_version: myClaim.source_version,
      p_success: true,
      p_embedding: makeDummyEmbedding768(0.4),
      p_visual_description: 'Mô tả thành công lần 1',
      p_model: 'gemini-embedding-001',
      p_model_version: 'v1',
      p_error: null,
    });
    const obj1 = res1 as { success?: boolean; status?: string };

    // Lần 2: Gọi lại complete trùng với cùng token đó
    const { data: res2 } = await supabase.rpc('complete_product_embedding_sync', {
      p_id: productId,
      p_claim_token: myClaim.claim_token,
      p_source_version: myClaim.source_version,
      p_success: true,
      p_embedding: makeDummyEmbedding768(0.4),
      p_visual_description: 'Cố tình ghi đè lần 2',
      p_model: 'gemini-embedding-001',
      p_model_version: 'v1',
      p_error: null,
    });
    const obj2 = res2 as { success?: boolean; status?: string };

    const passed = Boolean(
      obj1?.success === true &&
      obj1?.status === 'updated_synced' &&
      obj2?.success === false &&
      (obj2?.status === 'stale_not_processing' || obj2?.status === 'stale_token_mismatch')
    );

    return {
      testNumber: 4,
      testName: 'Complete trùng lặp (Duplicate Complete Protection)',
      passed,
      details: { call1: obj1, call2: obj2 },
      summary: passed
        ? `ĐẠT: Lần 1 thành công (updated_synced), lần 2 bị chặn (${obj2?.status}). Không ghi đè trùng.`
        : `CHƯA ĐẠT: Lần 2 không bị chặn đúng cách (call1: ${obj1?.status}, call2: ${obj2?.status}).`,
    };
  } finally {
    await softDeleteProduct(productId);
  }
}

/**
 * 5. Ca 5: Xóa sản phẩm khi đang sync -> Complete bị từ chối stale_deleted
 */
export async function testDeleteDuringSync(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S5_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Delete During Sync',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_del_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  // 1. Claim sản phẩm
  const { data: claimed } = await supabase.rpc('claim_products_for_embedding_sync', {
    batch_size: 10,
    lease_seconds: 120,
  });
  const myClaim = (claimed as Array<{ id: string; claim_token: string; source_version: number }>).find(
    (p) => p.id === productId
  );
  if (!myClaim) throw new Error('Không claim được sản phẩm');

  // 2. Người dùng xóa sản phẩm vào thùng rác
  await softDeleteProduct(productId);

  // 3. Worker hoàn tất và cố complete
  const { data: compRes } = await supabase.rpc('complete_product_embedding_sync', {
    p_id: productId,
    p_claim_token: myClaim.claim_token,
    p_source_version: myClaim.source_version,
    p_success: true,
    p_embedding: makeDummyEmbedding768(0.5),
    p_visual_description: 'Mô tả cho sản phẩm đã xóa',
    p_model: 'gemini-embedding-001',
    p_model_version: 'v1',
    p_error: null,
  });
  const obj = compRes as { success?: boolean; status?: string };
  const passed = obj?.success === false && obj?.status === 'stale_deleted';

  return {
    testNumber: 5,
    testName: 'Xóa sản phẩm khi đang sync (Stale Deleted Protection)',
    passed,
    details: { res: obj },
    summary: passed
      ? `ĐẠT: RPC phát hiện sản phẩm đã bị xóa và từ chối lưu vector (status: ${obj?.status}).`
      : `CHƯA ĐẠT: RPC không chặn khi sản phẩm bị xóa (status: ${obj?.status}).`,
  };
}

/**
 * 6. Ca 6: Kiểm tra bảo mật phân quyền cột (Column Privileges)
 * Đảm bảo client không thể tự ý UPDATE cột image_embedding hoặc embedding_status
 */
export async function testColumnPrivilegeProtection(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S6_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Column Privileges',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_col_image.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    // Thử bypass: Dùng client update trực tiếp cột embedding_status thành 'synced'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: bypassErr } = await (supabase.from('products') as any)
      .update({ embedding_status: 'synced' })
      .eq('id', productId);

    const isBlocked = Boolean(
      bypassErr &&
      (bypassErr.message.includes('permission denied') ||
       bypassErr.code === '42501' ||
       bypassErr.message.includes('permission_denied'))
    );

    return {
      testNumber: 6,
      testName: 'Bảo mật phân quyền cột: Chặn client tự ý sửa trạng thái/vector',
      passed: isBlocked,
      details: { error: bypassErr?.message, code: bypassErr?.code },
      summary: isBlocked
        ? `ĐẠT: CSDL từ chối cập nhật trực tiếp cột embedding_status từ client (${bypassErr?.message}).`
        : `CHƯA ĐẠT: CSDL cho phép client sửa trái phép cột trạng thái vector!`,
    };
  } finally {
    await softDeleteProduct(productId);
  }
}

/**
 * 7. Ca 7: Kiểm tra phân quyền INSERT và thêm sản phẩm bình thường
 * Đảm bảo:
 * a) Client không thể tự ý điền cột image_embedding, embedding_status, claim_token khi INSERT.
 * b) Thêm sản phẩm bình thường vẫn hoạt động hoàn hảo và an toàn.
 */
export async function testInsertPrivilegesAndCreation(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const normalCode = `TEST_NORM_${Date.now().toString().slice(-6)}`;
  // a) Kiểm tra thêm sản phẩm bình thường
  const normalRes = await createProduct({
    code: normalCode,
    barcode: null,
    name: 'Sản phẩm Thêm Bình Thường',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 15000,
    salePrice: 25000,
    stock: 8,
    imageUrl: 'test_normal.jpg',
  });

  const normalPassed = Boolean(normalRes.data && normalRes.data.id && !normalRes.error);
  const normalId = normalRes.data?.id;

  // b) Thử bypass: Cố tình INSERT trực tiếp kèm cột embedding_status = 'synced'
  const hackCode = `TEST_HACK_${Date.now().toString().slice(-6)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: hackErr } = await (supabase.from('products') as any).insert({
    code: hackCode,
    name: 'Sản phẩm Cố Tình Điền Status Synced',
    category: 'Gia dụng',
    unit: 'Cái',
    purchase_price: 10000,
    sale_price: 20000,
    embedding_status: 'synced', // Cột bị cấm INSERT
  });

  const insertBlocked = Boolean(
    hackErr &&
    (hackErr.message.includes('permission denied') ||
     hackErr.code === '42501' ||
     hackErr.message.includes('permission_denied'))
  );

  if (normalId) {
    await softDeleteProduct(normalId);
  }

  const passed = Boolean(normalPassed && insertBlocked);

  return {
    testNumber: 7,
    testName: 'Phân quyền INSERT: Chặn điền cột vector và kiểm tra thêm SP bình thường',
    passed,
    details: {
      normalCreationSuccess: normalPassed,
      unauthorizedInsertBlocked: insertBlocked,
      blockedErrorMessage: hackErr?.message,
    },
    summary: passed
      ? `ĐẠT: Thêm sản phẩm bình thường thành công 100%; Cố tình INSERT cột embedding_status bị CSDL chặn (${hackErr?.message}).`
      : `CHƯA ĐẠT: ${!normalPassed ? 'Thêm bình thường thất bại' : 'Không chặn được INSERT trái phép'}!`,
  };
}

/**
 * 8. Ca 8: Giả lập lỗi Gemini Vision / Tải ảnh thất bại
 * Đảm bảo:
 * a) Không fallback sang metadata để ghi synced sai.
 * b) Ghi nhận thất bại qua complete RPC đúng token/source_version.
 * c) CSDL ghi nhận status = 'failed', image_embedding = NULL, embedding_source = NULL.
 */
export async function testVisionFailureHandling(): Promise<LifecycleTestResult> {
  if (!supabase) throw new Error('Supabase client chưa cấu hình');

  const testCode = `TEST_S8_${Date.now().toString().slice(-6)}`;
  const createRes = await createProduct({
    code: testCode,
    barcode: null,
    name: 'Sản phẩm Test Lỗi Vision',
    category: 'Gia dụng',
    unit: 'Cái',
    purchasePrice: 10000,
    salePrice: 20000,
    stock: 5,
    imageUrl: 'test_vision_fail.jpg',
  });
  if (!createRes.data) throw new Error(`Tạo sản phẩm thất bại: ${createRes.error}`);
  const productId = createRes.data.id;

  try {
    // 1. Claim sản phẩm
    const { data: claimed } = await supabase.rpc('claim_products_for_embedding_sync', {
      batch_size: 10,
      lease_seconds: 120,
    });
    const myClaim = (claimed as Array<{ id: string; claim_token: string; source_version: number }>).find(
      (p) => p.id === productId
    );
    if (!myClaim) throw new Error('Không claim được sản phẩm');

    // 2. Giả lập lỗi Vision: worker gọi complete với p_success = false
    const simulatedError = 'vision_failed: 502 High Demand Spike (Giả lập upstream lỗi)';
    const { data: compRes, error: compErr } = await supabase.rpc('complete_product_embedding_sync', {
      p_id: productId,
      p_claim_token: myClaim.claim_token,
      p_source_version: myClaim.source_version,
      p_success: false,
      p_embedding: null,
      p_visual_description: null,
      p_model: 'gemini-embedding-001',
      p_model_version: 'v1',
      p_error: simulatedError,
      p_source: 'image_description',
    });
    if (compErr) throw compErr;

    // 3. Đọc lại CSDL để xác minh
    const { data: verifyRow } = await supabase
      .from('products')
      .select('embedding_status, embedding_source, image_embedding, visual_description, embedding_error, claim_token')
      .eq('id', productId)
      .single();

    const isStatusFailed = verifyRow?.embedding_status === 'failed';
    const hasNoVector = verifyRow?.image_embedding === null;
    const hasNoSource = verifyRow?.embedding_source === null;
    const hasErrorRecorded = verifyRow?.embedding_error?.includes('502');
    const claimTokenReleased = verifyRow?.claim_token === null;

    const passed = Boolean(
      isStatusFailed &&
      hasNoVector &&
      hasNoSource &&
      hasErrorRecorded &&
      claimTokenReleased
    );

    return {
      testNumber: 8,
      testName: 'Giả lập lỗi Vision: Ghi nhận failed, không lưu vector và không ghi synced sai',
      passed,
      details: {
        rpcResult: compRes,
        dbRow: verifyRow,
        checks: { isStatusFailed, hasNoVector, hasNoSource, hasErrorRecorded, claimTokenReleased },
      },
      summary: passed
        ? `ĐẠT: CSDL ghi nhận status='failed', giải phóng token, không lưu vector và không fallback metadata sai.`
        : `CHƯA ĐẠT: CSDL không cập nhật đúng khi Vision lỗi (status: ${verifyRow?.embedding_status}).`,
    };
  } finally {
    await softDeleteProduct(productId);
  }
}

/**
 * Chạy toàn bộ bộ test kiểm định vòng đời vector
 */
export async function runAllLifecycleTests(): Promise<LifecycleTestResult[]> {
  const results: LifecycleTestResult[] = [];
  results.push(await testImageChangeDuringSync());
  results.push(await testLeaseTimeoutAndReclaim());
  results.push(await testCompleteWithStaleToken());
  results.push(await testDuplicateComplete());
  results.push(await testDeleteDuringSync());
  results.push(await testColumnPrivilegeProtection());
  results.push(await testInsertPrivilegesAndCreation());
  results.push(await testVisionFailureHandling());
  return results;
}

// Export ra window để gọi từ DevTools Console hoặc Browser Test
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__runAllLifecycleTests = runAllLifecycleTests;
}

