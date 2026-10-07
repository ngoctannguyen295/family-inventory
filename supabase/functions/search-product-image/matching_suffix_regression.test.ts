import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSignificantTokens,
  calculateMatchScore,
  rankProductMatches,
} from './matching.ts';
import type { GeminiExtraction, ProductRecord } from './types.ts';

test('1. extractSignificantTokens preserves single-character suffix with head word and ignores isolated noise', () => {
  // Cụm từ có hậu tố 1 ký tự: phải giữ cả từ gốc và hậu tố
  const tokensYumangelF = extractSignificantTokens('Thuốc đau dạ dày Yumangel F');
  assert.deepEqual(tokensYumangelF, ['thuoc', 'dau', 'da', 'day', 'yumangel', 'f']);

  const tokensUsbC = extractSignificantTokens('Cáp sạc USB-C');
  assert.deepEqual(tokensUsbC, ['cap', 'sac', 'usb', 'c']);

  // Ký tự đơn lẻ cô lập trong nền ảnh: phải loại bỏ
  assert.deepEqual(extractSignificantTokens('F'), []);
  assert.deepEqual(extractSignificantTokens('A B C'), []);
  assert.deepEqual(extractSignificantTokens('Ctrl Alt F'), ['ctrl', 'alt', 'f']); // 'f' following 'alt'
});

test('2. Regression Test: Ký tự "F" đơn lẻ trong nền ảnh bàn phím KHÔNG khớp Yumangel F', () => {
  const yumangelProduct: ProductRecord = {
    id: 'prod-yumangel-07',
    code: '07',
    name: 'Thuốc đau dạ dày Yumangel F',
    category: 'Thuốc',
    unit: 'Gói',
    purchase_price: 5000,
    sale_price: 10000,
    stock: 20,
    notes: 'Dạng hỗn dịch',
    image_url: 'path/yumangel.jpg',
  };

  // Giả lập ảnh chụp cáp sạc đặt trên bàn phím máy tính:
  // OCR nhận dạng được chữ "F" từ phím bàn phím
  const aiExtractionWithKeyF: GeminiExtraction = {
    readable: true,
    product_name: 'Cáp sạc Type-C',
    object_type: 'cáp sạc',
    brand: null,
    variant: 'Type-C',
    visible_text: ['F', 'Ctrl', 'USB'],
    visual_features: 'dây bện dù màu trắng',
    category_hint: 'phụ kiện điện tử',
  };

  const matchResult = calculateMatchScore(yumangelProduct, aiExtractionWithKeyF);

  // Điểm số đối chiếu phải bằng 0 do mâu thuẫn ngành hàng và ký tự "F" đơn lẻ bị loại bỏ
  assert.equal(matchResult.score, 0, 'Ký tự F đơn lẻ trong nền không được tăng điểm cho Yumangel F');
  assert.ok(
    matchResult.reasons.some((r) => r.includes('Mâu thuẫn loại sản phẩm') || r.includes('Thiếu bằng chứng')),
    'Phải ghi nhận mâu thuẫn loại sản phẩm hoặc thiếu bằng chứng'
  );

  const ranked = rankProductMatches([yumangelProduct], aiExtractionWithKeyF);
  assert.equal(ranked.length, 0, 'Yumangel F tuyệt đối không được xuất hiện trong danh sách gợi ý của cáp sạc');
});

test('3. Regression Test: Bao bì chữ in "Yumangel F" khớp đầy đủ tên và hậu tố F', () => {
  const yumangelProduct: ProductRecord = {
    id: 'prod-yumangel-07',
    code: '07',
    name: 'Yumangel F',
    category: 'Thuốc',
    unit: 'Gói',
    purchase_price: 5000,
    sale_price: 10000,
    stock: 20,
    notes: 'Dạng hỗn dịch uống',
    image_url: 'path/yumangel.jpg',
  };

  // Giả lập ảnh chụp bao bì thật Yumangel F:
  const aiExtractionYumangel: GeminiExtraction = {
    readable: true,
    product_name: 'Thuốc dạ dày Yumangel F',
    object_type: 'gói thuốc',
    brand: 'Yuhan',
    variant: 'Gói hỗn dịch',
    visible_text: ['Yumangel F', 'Yuhan', 'Hỗn dịch uống'],
    visual_features: 'gói thuốc màu xanh lá cây và trắng',
    category_hint: 'dược phẩm',
  };

  const matchResult = calculateMatchScore(yumangelProduct, aiExtractionYumangel);

  assert.ok(
    matchResult.score >= 35,
    `Điểm đối chiếu phải vượt ngưỡng MATCH_THRESHOLD=35 (thực tế: ${matchResult.score})`
  );
  assert.ok(
    matchResult.reasons.some((r) => r.toLowerCase().includes('yumangel f')),
    'Phải khớp trọn vẹn cụm tên có hậu tố F'
  );

  const ranked = rankProductMatches([yumangelProduct], aiExtractionYumangel);
  assert.equal(ranked.length, 1, 'Phải trả về đúng Yumangel F');
  assert.equal(ranked[0].product.code, '07');
});

test('4. Regression Test: Phân biệt biến thể hậu tố Yumangel F vs Yumangel S', () => {
  const yumangelProductF: ProductRecord = {
    id: 'prod-yumangel-07',
    code: '07',
    name: 'Yumangel F',
    category: 'Thuốc',
    unit: 'Gói',
    purchase_price: 5000,
    sale_price: 10000,
    stock: 20,
    notes: '',
    image_url: 'path/yumangel_f.jpg',
  };

  // Ảnh nhận diện là biến thể "Yumangel S"
  const aiExtractionYumangelS: GeminiExtraction = {
    readable: true,
    product_name: 'Yumangel S',
    object_type: 'gói thuốc',
    brand: null,
    variant: null,
    visible_text: ['Yumangel S'],
    visual_features: 'gói thuốc',
    category_hint: 'thuốc',
  };

  // Ảnh nhận diện đúng là "Yumangel F"
  const aiExtractionYumangelF: GeminiExtraction = {
    readable: true,
    product_name: 'Yumangel F',
    object_type: 'gói thuốc',
    brand: null,
    variant: null,
    visible_text: ['Yumangel F'],
    visual_features: 'gói thuốc',
    category_hint: 'thuốc',
  };

  const scoreF = calculateMatchScore(yumangelProductF, aiExtractionYumangelF).score;
  const scoreS = calculateMatchScore(yumangelProductF, aiExtractionYumangelS).score;

  assert.ok(
    scoreF > scoreS,
    `Khớp đúng hậu tố F (score=${scoreF}) phải có điểm cao hơn biến thể khác hậu tố S (score=${scoreS})`
  );
});

test('5. Regression Test: Ảnh đèn LED xoay vũ trường mini phải gợi ý Đèn sao (mã 10), loại trừ Chuột (08) và Cáp (C02)', () => {
  const denSaoProduct: ProductRecord = {
    id: 'prod-den-sao-10',
    code: '10',
    name: 'Đèn sao',
    category: 'Điện tử',
    unit: 'Cái',
    purchase_price: 50000,
    sale_price: 60000,
    stock: 10,
    notes: '',
    image_url: 'path/den_sao.jpg',
  };

  const chuotProduct: ProductRecord = {
    id: 'prod-chuot-08',
    code: '08',
    name: 'Chuột Gaming',
    category: 'Đồ điện tử',
    unit: 'Cái',
    purchase_price: 150000,
    sale_price: 170000,
    stock: 10,
    notes: '',
    image_url: 'path/chuot.jpg',
  };

  const capProduct: ProductRecord = {
    id: 'prod-cap-c02',
    code: 'C02',
    name: 'Cáp sạc Type-C sang Lightning',
    category: 'Gia vị',
    unit: 'Sợi',
    purchase_price: 40000,
    sale_price: 60000,
    stock: 10,
    notes: '',
    image_url: 'path/cap.jpg',
  };

  // AI nhận diện từ ảnh chụp quả cầu xoay:
  const aiExtractionDiscoLight: GeminiExtraction = {
    readable: true,
    product_name: 'Đèn LED xoay vũ trường mini',
    object_type: 'đèn led xoay',
    brand: null,
    variant: 'xoay 7 màu',
    visible_text: [],
    visual_features: 'quả cầu trong suốt đế nhựa màu đen xanh',
    category_hint: 'thiết bị chiếu sáng',
  };

  // Giả lập map độ tương đồng vector:
  // Đèn sao: 0.88 (ảnh cùng loại)
  // Chuột: 0.70 (do cùng màu đen/nhựa/LED)
  // Cáp: 0.65 (do cùng phụ kiện)
  const vectorMap = new Map<string, number>([
    [denSaoProduct.id, 0.88],
    [chuotProduct.id, 0.70],
    [capProduct.id, 0.65],
  ]);

  const ranked = rankProductMatches(
    [denSaoProduct, chuotProduct, capProduct],
    aiExtractionDiscoLight,
    vectorMap
  );

  // 1. Chuột và Cáp phải bị loại bỏ hoàn toàn do mâu thuẫn loại sản phẩm (Đèn ≠ Chuột, Đèn ≠ Cáp)
  const chuotScore = calculateMatchScore(chuotProduct, aiExtractionDiscoLight, 0.70).score;
  const capScore = calculateMatchScore(capProduct, aiExtractionDiscoLight, 0.65).score;
  assert.equal(chuotScore, 0, 'Chuột Gaming phải có score = 0 khi tìm đèn');
  assert.equal(capScore, 0, 'Cáp sạc phải có score = 0 khi tìm đèn');

  // 2. Đèn sao phải được giữ lại và xếp thứ 1
  assert.equal(ranked.length, 1, 'Chỉ duy nhất Đèn sao được gợi ý');
  assert.equal(ranked[0].product.code, '10', 'Đèn sao (mã 10) phải đứng Top 1');
  assert.ok(ranked[0].match_score >= 80, `Điểm đối chiếu của Đèn sao phải cao (thực tế: ${ranked[0].match_score})`);
});

