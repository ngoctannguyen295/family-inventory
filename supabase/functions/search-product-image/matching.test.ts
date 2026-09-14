// Unit tests for product matching logic
import { assertEquals } from 'jsr:@std/assert@1';
import {
  removeVietnameseTones,
  standardizeQuantity,
  compareQuantities,
  containsWordBoundary,
  detectProductTypeConflict,
  calculateMatchScore,
  rankProductMatches,
} from './matching.ts';
import type { GeminiExtraction, ProductRecord } from './types.ts';

const mockProducts: ProductRecord[] = [
  {
    id: 'prod-1',
    code: '00101',
    barcode: '8935001111111',
    name: 'Dầu ăn Cái Lân chai 1 lít',
    category: 'Gia vị & Dầu ăn',
    unit: 'chai',
    image_url: null,
    purchase_price: 35000,
    sale_price: 42000,
    stock: 10,
    notes: 'Dầu thực vật tinh luyện Cái Lân chai 1L',
  },
  {
    id: 'prod-2',
    code: '00102',
    barcode: '8935002222222',
    name: 'Dầu ăn Cái Lân chai 500ml',
    category: 'Gia vị & Dầu ăn',
    unit: 'chai',
    image_url: null,
    purchase_price: 20000,
    sale_price: 25000,
    stock: 15,
    notes: 'Dung tích nhỏ 500ml',
  },
  {
    id: 'prod-3',
    code: '00103',
    barcode: '8935003333333',
    name: 'Nước mắm Nam Ngư Đệ Nhị 900ml',
    category: 'Gia vị & Dầu ăn',
    unit: 'chai',
    image_url: null,
    purchase_price: 28000,
    sale_price: 32000,
    stock: 20,
    notes: 'Nước mắm cá cơm Nam Ngư',
  },
  {
    id: 'prod-4',
    code: '00104',
    barcode: '8935004444444',
    name: 'Gạo ST25 Ông Cua túi 5kg',
    category: 'Lương thực',
    unit: 'túi',
    image_url: null,
    purchase_price: 170000,
    sale_price: 195000,
    stock: 8,
    notes: 'Gạo thơm đặc sản Sóc Trăng 5 kg',
  },
  {
    id: 'prod-5',
    code: '00105',
    barcode: '8935005555555',
    name: 'Dầu gội Dove Phục Hồi Hư Tổn 500ml',
    category: 'Chăm sóc cá nhân',
    unit: 'chai',
    image_url: null,
    purchase_price: 120000,
    sale_price: 135000,
    stock: 12,
    notes: 'Dầu gội dưỡng chất Dove 500ml',
  },
  {
    id: 'prod-6',
    code: '00106',
    barcode: '8935006666666',
    name: 'Sữa tắm Dove Dưỡng Ẩm Sâu 500ml',
    category: 'Chăm sóc cá nhân',
    unit: 'chai',
    image_url: null,
    purchase_price: 130000,
    sale_price: 145000,
    stock: 10,
    notes: 'Sữa tắm dưỡng thể Dove Deep Moisture 500ml',
  },
];

Deno.test('removeVietnameseTones: Chuẩn hóa chuỗi tiếng Việt không dấu chính xác', () => {
  assertEquals(removeVietnameseTones('Nước mắm Nam Ngư Đệ Nhị'), 'nuoc mam nam ngu de nhi');
  assertEquals(removeVietnameseTones('Gạo ST25 Ông Cua 5kg'), 'gao st25 ong cua 5kg');
  assertEquals(removeVietnameseTones('  Dầu Ăn Cái Lân  '), 'dau an cai lan');
});

Deno.test('containsWordBoundary: Tách token theo ranh giới từ, tránh khớp chuỗi con gây nhầm lẫn', () => {
  // "ca" không được khớp trong "bánh cay"
  assertEquals(containsWordBoundary('banh cay nong', 'ca'), false);
  // "ca" khớp đúng trong "ca hop ba co gai"
  assertEquals(containsWordBoundary('ca hop ba co gai', 'ca'), true);
  // "dove" không được khớp trong "undovered"
  assertEquals(containsWordBoundary('undovered product', 'dove'), false);
  // "dove" khớp đúng trong "dau goi dove 500ml"
  assertEquals(containsWordBoundary('dau goi dove 500ml', 'dove'), true);
});

Deno.test('standardizeQuantity: Chuẩn hóa đơn vị đo lường tương đương (lít -> ml, kg -> g)', () => {
  const q1 = standardizeQuantity(1, 'lít');
  assertEquals(q1, { value: 1000, baseUnit: 'ml' });

  const q2 = standardizeQuantity(1000, 'ml');
  assertEquals(q2, { value: 1000, baseUnit: 'ml' });

  const q3 = standardizeQuantity(5, 'kg');
  assertEquals(q3, { value: 5000, baseUnit: 'g' });

  const q4 = standardizeQuantity(5000, 'gram');
  assertEquals(q4, { value: 5000, baseUnit: 'g' });
});

Deno.test('compareQuantities: 1 lít và 1000 ml phải khớp nhau', () => {
  const q1 = standardizeQuantity(1, 'l');
  const q2 = standardizeQuantity(1000, 'ml');
  assertEquals(compareQuantities(q1, q2), true);
});

Deno.test('compareQuantities: Không dùng dung sai 2% giữa các quy cách sản phẩm (980ml != 1000ml)', () => {
  const q980 = standardizeQuantity(980, 'ml');
  const q1000 = standardizeQuantity(1000, 'ml');
  // 980ml và 1000ml lệch 20ml (2%), phải coi là KHÁC quy cách đóng gói
  assertEquals(compareQuantities(q980, q1000), false);
});

Deno.test('detectProductTypeConflict: Phát hiện mâu thuẫn loại sản phẩm (Sữa tắm vs Dầu gội)', () => {
  const conflict = detectProductTypeConflict(
    'Sữa tắm dưỡng thể Dove Deep Moisture',
    'Dầu gội Dove Phục Hồi Hư Tổn 500ml'
  );
  assertEquals(conflict.hasConflict, true);
  assertEquals(conflict.aiType, 'sua tam');
  assertEquals(conflict.prodType, 'dau goi');
});

Deno.test('Matching: Cùng thương hiệu Dove 500ml nhưng khác loại sản phẩm (Sữa tắm vs Dầu gội) bị loại bỏ (score = 0)', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Sữa tắm dưỡng ẩm chuyên sâu',
    brand: 'Dove',
    variant: 'Dưỡng ẩm',
    quantity_value: 500,
    quantity_unit: 'ml',
    visible_text: ['Dove', 'Sữa tắm', '500ml'],
    readable: true,
  };

  // Đối chiếu với prod-5 (Dầu gội Dove Phục Hồi Hư Tổn 500ml)
  const scoreResult = calculateMatchScore(mockProducts[4], aiExtraction);
  assertEquals(scoreResult.score, 0);
  assertEquals(scoreResult.reasons.some((r) => r.includes('Mâu thuẫn loại sản phẩm')), true);

  // Khi xếp hạng danh sách, không được trả về prod-5
  const matches = rankProductMatches(mockProducts, aiExtraction);
  const foundDoveShampoo = matches.some((m) => m.product.id === 'prod-5');
  assertEquals(foundDoveShampoo, false);
});

Deno.test('Matching: Chỉ có thương hiệu mà không có tên sản phẩm phải trả về mảng rỗng []', () => {
  const aiOnlyBrand: GeminiExtraction = {
    product_name: null,
    brand: 'Dove',
    variant: null,
    quantity_value: null,
    quantity_unit: null,
    visible_text: ['Dove'],
    readable: true,
  };

  const matches = rankProductMatches(mockProducts, aiOnlyBrand);
  assertEquals(matches.length, 0);
});

Deno.test('Matching: Khớp sản phẩm cùng thương hiệu và đúng dung tích đạt điểm cao nhất', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Dầu ăn',
    brand: 'Cái Lân',
    variant: 'Tinh luyện',
    quantity_value: 1000,
    quantity_unit: 'ml',
    visible_text: ['Cái Lân', 'Dầu ăn', '1L'],
    readable: true,
  };

  const matches = rankProductMatches(mockProducts, aiExtraction);
  assertEquals(matches.length > 0, true);

  // Sản phẩm đứng đầu phải là chai 1 lít (prod-1), không phải chai 500ml (prod-2)
  assertEquals(matches[0].product.id, 'prod-1');
  assertEquals(matches[0].match_score >= 70, true);
});

Deno.test('Matching: Cùng thương hiệu nhưng khác dung tích bị phạt điểm mạnh, không coi là khớp cao', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Dầu ăn',
    brand: 'Cái Lân',
    variant: null,
    quantity_value: 1,
    quantity_unit: 'lít',
    visible_text: ['Cái Lân', '1 lít'],
    readable: true,
  };

  const scoreProd1 = calculateMatchScore(mockProducts[0], aiExtraction); // Chai 1L
  const scoreProd2 = calculateMatchScore(mockProducts[1], aiExtraction); // Chai 500ml

  // Điểm của chai 1L phải cao hơn vượt trội so với chai 500ml
  assertEquals(scoreProd1.score > scoreProd2.score + 30, true);

  // Chai 500ml phải có lý do ghi rõ khác dung tích
  const hasDiffReason = scoreProd2.reasons.some((r) => r.includes('Khác dung tích'));
  assertEquals(hasDiffReason, true);
});

Deno.test('Matching: Sản phẩm không có trong kho phải trả về mảng rỗng (không cố lấy top 5)', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Bột giặt OMO Matic',
    brand: 'OMO',
    variant: 'Cửa trước',
    quantity_value: 3,
    quantity_unit: 'kg',
    visible_text: ['OMO', 'Matic'],
    readable: true,
  };

  const matches = rankProductMatches(mockProducts, aiExtraction);
  assertEquals(matches.length, 0);
});

Deno.test('Matching: Ảnh mờ hoặc readable = false trả về mảng rỗng', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: null,
    brand: null,
    variant: null,
    quantity_value: null,
    quantity_unit: null,
    visible_text: [],
    readable: false,
  };

  const matches = rankProductMatches(mockProducts, aiExtraction);
  assertEquals(matches.length, 0);
});

Deno.test('Regression: product_name sau chuẩn hóa chỉ bằng brand ("Dove"), có dung tích 500ml và visible_text ["Dove"], đối chiếu kho "Dầu gội Dove 500ml" bắt buộc trả về []', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Dove',
    brand: 'Dove',
    variant: null,
    quantity_value: 500,
    quantity_unit: 'ml',
    visible_text: ['Dove'],
    readable: true,
  };

  // 1. Kiểm tra trực tiếp hàm calculateMatchScore:
  // Vì không có bằng chứng độc lập về tên/loại sản phẩm (visible_text chỉ lặp lại brand "Dove"),
  // điểm bắt buộc = 0 và không được cộng điểm dung tích.
  const scoreResult = calculateMatchScore(mockProducts[4], aiExtraction); // mockProducts[4] là "Dầu gội Dove Phục Hồi Hư Tổn 500ml"
  assertEquals(scoreResult.score, 0);

  // 2. Kiểm tra hàm rankProductMatches: Kết quả bắt buộc phải là mảng rỗng []
  const matches = rankProductMatches(mockProducts, aiExtraction);
  assertEquals(matches, []);
});

Deno.test('Matching: "Sữa tắm Dove 500ml" nhận diện đúng tên, thương hiệu và dung tích vẫn được tìm thấy', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Sữa tắm',
    brand: 'Dove',
    variant: 'Dưỡng ẩm sâu',
    quantity_value: 500,
    quantity_unit: 'ml',
    visible_text: ['Dove', 'Sữa tắm', '500ml'],
    readable: true,
  };

  const matches = rankProductMatches(mockProducts, aiExtraction);
  assertEquals(matches.length > 0, true);

  // Sản phẩm đứng đầu phải là "Sữa tắm Dove Dưỡng Ẩm Sâu 500ml" (prod-6)
  assertEquals(matches[0].product.id, 'prod-6');
  assertEquals(matches[0].match_score >= 70, true);

  // Không được lẫn sang "Dầu gội Dove Phục Hồi Hư Tổn 500ml" (prod-5) do mâu thuẫn loại sản phẩm
  const hasShampoo = matches.some((m) => m.product.id === 'prod-5');
  assertEquals(hasShampoo, false);
});

// =========================================================================
// REGRESSION TESTS: CA THỰC TẾ YUMANGEL F & CÁC CA BIÊN
// =========================================================================

const mockYumangelProducts: ProductRecord[] = [
  {
    id: 'prod-07',
    code: '07',
    barcode: null,
    name: 'Yumangel F',
    category: 'Thuốc',
    unit: 'Hộp',
    image_url: 'yumangel-f.jpg',
    purchase_price: 120000,
    sale_price: 130000,
    stock: 100,
    notes: '',
  },
  {
    id: 'prod-08',
    code: '08',
    barcode: null,
    name: 'Yumangel',
    category: 'Thuốc',
    unit: 'Hộp',
    image_url: 'yumangel.jpg',
    purchase_price: 100000,
    sale_price: 110000,
    stock: 50,
    notes: 'Thuốc dạ dày chữ Y gói xanh lá',
  },
  {
    id: 'prod-09',
    code: '09',
    barcode: null,
    name: 'Viên sủi Vitamin C Yuhan 1000mg',
    category: 'Thuốc',
    unit: 'Tuýp',
    image_url: null,
    purchase_price: 50000,
    sale_price: 65000,
    stock: 20,
    notes: 'Sản phẩm bổ sung vitamin C',
  },
];

Deno.test('Regression: Ca thực tế Yumangel F - AI nhận diện [Yuhan] Hỗn dịch uống 300ml, có "Yumangel F" trong visible_text, kho có mã 07 "Yumangel F" PHẢI TÌM THẤY', () => {
  const aiExtractionActual: GeminiExtraction = {
    product_name: 'Hỗn dịch uống',
    brand: 'Yuhan',
    variant: 'Gói hỗn dịch uống',
    quantity_value: 300,
    quantity_unit: 'ml',
    visible_text: ['Yumangel F', 'Yuhan', 'Hỗn dịch uống', 'Y'],
    readable: true,
  };

  // 1. Tính điểm trực tiếp cho prod-07 (Yumangel F):
  const scoreResult = calculateMatchScore(mockYumangelProducts[0], aiExtractionActual);
  assertEquals(scoreResult.score >= 35, true, `Điểm phải đạt >= 35 nhưng chỉ đạt ${scoreResult.score}`);

  // 2. Xếp hạng đối chiếu:
  const matches = rankProductMatches(mockYumangelProducts, aiExtractionActual);
  assertEquals(matches.length > 0, true, 'Phải tìm thấy sản phẩm Yumangel F');
  assertEquals(matches[0].product.code, '07');
  assertEquals(matches[0].product.name, 'Yumangel F');
});

Deno.test('Regression: Yumangel F khi AI nhận diện chính xác product_name là "Yumangel F" đạt điểm khớp cao (>= 70)', () => {
  const aiExtractionAccurate: GeminiExtraction = {
    product_name: 'Yumangel F',
    brand: 'Yuhan',
    variant: 'Hỗn dịch uống',
    quantity_value: null,
    quantity_unit: null,
    visible_text: ['Yumangel F', 'Yuhan', 'Hỗn dịch uống'],
    readable: true,
  };

  const matches = rankProductMatches(mockYumangelProducts, aiExtractionAccurate);
  assertEquals(matches.length > 0, true);
  assertEquals(matches[0].product.code, '07');
  assertEquals(matches[0].match_score >= 70, true);
});

Deno.test('Regression: Không để thiếu nhà sản xuất trong dữ liệu kho trở thành bằng chứng mâu thuẫn (kho chỉ có "Yumangel F" vẫn khớp tốt)', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Yumangel F',
    brand: 'Yuhan Corporation Korea',
    variant: null,
    quantity_value: null,
    quantity_unit: null,
    visible_text: ['Yumangel F', 'Yuhan'],
    readable: true,
  };

  const scoreResult = calculateMatchScore(mockYumangelProducts[0], aiExtraction);
  // Không có lý do nào bị phạt vì thiếu NSX
  const hasConflict = scoreResult.reasons.some((r) => r.toLowerCase().includes('mâu thuẫn'));
  assertEquals(hasConflict, false);
  assertEquals(scoreResult.score >= 45, true);
});

Deno.test('Regression: Sản phẩm không liên quan (Viên sủi Vitamin C Yuhan) KHÔNG BỊ GỢI Ý chỉ vì trùng nhà sản xuất Yuhan', () => {
  const aiYumangel: GeminiExtraction = {
    product_name: 'Hỗn dịch uống',
    brand: 'Yuhan',
    variant: null,
    quantity_value: 300,
    quantity_unit: 'ml',
    visible_text: ['Yumangel F', 'Yuhan', 'Hỗn dịch uống'],
    readable: true,
  };

  // Tính điểm cho prod-09 (Viên sủi Vitamin C Yuhan 1000mg)
  const scoreResult = calculateMatchScore(mockYumangelProducts[2], aiYumangel);
  // Vì tên sản phẩm ("Viên sủi Vitamin C") không hề khớp với "Hỗn dịch uống" hay "Yumangel F",
  // không có bằng chứng độc lập về tên sản phẩm phù hợp -> Điểm phải dưới ngưỡng sàn (35) hoặc = 0
  assertEquals(scoreResult.score < 35, true, `Điểm không được vượt ngưỡng nhưng đạt ${scoreResult.score}`);

  // Khi xếp hạng, Viên sủi Vitamin C Yuhan không được xuất hiện trong matches
  const matches = rankProductMatches(mockYumangelProducts, aiYumangel);
  const foundVitaminC = matches.some((m) => m.product.id === 'prod-09');
  assertEquals(foundVitaminC, false);
});

Deno.test('Regression: Phân biệt dung tích mỗi gói với tổng cả hộp; không loại sản phẩm chỉ vì đơn vị bán là "Hộp"', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Yumangel F',
    brand: 'Yuhan',
    variant: 'Hỗn dịch uống',
    quantity_value: 300, // AI đọc tổng 300ml (20 gói x 15ml)
    quantity_unit: 'ml',
    visible_text: ['Yumangel F', '300ml', '20 gói'],
    readable: true,
  };

  // prod-07 có unit là 'Hộp', không ghi rõ số ml trong tên
  const scoreResult = calculateMatchScore(mockYumangelProducts[0], aiExtraction);
  // Không được có lý do "Khác dung tích" dẫn đến bị phạt -40 điểm
  const hasDiffPenalty = scoreResult.reasons.some((r) => r.includes('Khác dung tích'));
  assertEquals(hasDiffPenalty, false);
  assertEquals(scoreResult.score >= 45, true);
});

Deno.test('Regression: Phân biệt biến thể hậu tố: "Yumangel F" phải ưu tiên đứng trước "Yumangel" thường', () => {
  const aiExtraction: GeminiExtraction = {
    product_name: 'Yumangel F',
    brand: 'Yuhan',
    variant: null,
    quantity_value: null,
    quantity_unit: null,
    visible_text: ['Yumangel F', 'Yuhan'],
    readable: true,
  };

  const matches = rankProductMatches(mockYumangelProducts, aiExtraction);
  assertEquals(matches.length >= 1, true);
  // Sản phẩm đứng đầu bắt buộc phải là Yumangel F (prod-07)
  assertEquals(matches[0].product.code, '07');
  assertEquals(matches[0].product.name, 'Yumangel F');
});


