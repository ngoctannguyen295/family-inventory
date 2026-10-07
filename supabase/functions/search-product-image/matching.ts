// Product matching and ranking engine
import type { GeminiExtraction, ProductMatchResult, ProductRecord } from './types.ts';

/**
 * Loại bỏ dấu tiếng Việt và chuẩn hóa chuỗi về chữ thường không dấu
 */
export function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * Kiểm tra xem chuỗi văn bản có chứa từ/cụm từ theo đúng ranh giới từ (word boundary) hay không.
 * Tránh trường hợp so khớp chuỗi con gây nhầm lẫn (ví dụ: "ca" trong "cay", "omo" trong "homophones").
 */
export function containsWordBoundary(text: string, term: string): boolean {
  if (!text || !term) return false;
  const trimmedTerm = term.trim();
  if (!trimmedTerm) return false;
  const escaped = trimmedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  return regex.test(text);
}

export interface StandardizedQuantity {
  value: number;
  baseUnit: 'ml' | 'g';
}

/**
 * Chuẩn hóa dung tích hoặc khối lượng về đơn vị cơ sở (ml hoặc g)
 * Hỗ trợ: 1 lít = 1000 ml, 1 l = 1000 ml, 1 kg = 1000 g, 1000 gram = 1000 g
 */
export function standardizeQuantity(
  value: number,
  unitStr: string
): StandardizedQuantity | null {
  if (!value || value <= 0 || !unitStr) return null;
  const unit = removeVietnameseTones(unitStr).replace(/\./g, '').trim();

  // Đơn vị thể tích -> quy về ml
  if (['ml', 'mililit', 'mili lit'].includes(unit)) {
    return { value, baseUnit: 'ml' };
  }
  if (['l', 'lit', 'liter', 'litre'].includes(unit)) {
    return { value: Math.round(value * 1000), baseUnit: 'ml' };
  }

  // Đơn vị khối lượng -> quy về g
  if (['g', 'gram', 'gam', 'gr'].includes(unit)) {
    return { value, baseUnit: 'g' };
  }
  if (['kg', 'kilogram', 'kilo', 'ky', 'k'].includes(unit)) {
    return { value: Math.round(value * 1000), baseUnit: 'g' };
  }

  return null;
}

/**
 * Trích xuất dung tích / khối lượng từ chuỗi văn bản (ví dụ "Dầu ăn Cái Lân 1L", "Gạo ST25 5kg")
 */
export function extractQuantityFromText(text: string): StandardizedQuantity | null {
  if (!text) return null;

  // Regex nhận dạng số kèm đơn vị (ví dụ: 1.5l, 500ml, 5 kg, 900 g)
  const regex = /(\d+(?:[.,]\d+)?)\s*(lít|lit|l|ml|kg|kilo|gram|gam|g)\b/i;
  const match = text.match(regex);
  if (!match) return null;

  const rawNum = parseFloat(match[1].replace(',', '.'));
  const rawUnit = match[2];

  if (isNaN(rawNum) || rawNum <= 0) return null;
  return standardizeQuantity(rawNum, rawUnit);
}

/**
 * Kiểm tra xem chuỗi văn bản có chỉ chứa thương hiệu hoặc quy cách dung tích/khối lượng hay không.
 * Dùng để loại trừ các từ khóa trong visible_text hoặc product_name không mang lại bằng chứng
 * độc lập về tên/loại sản phẩm (ví dụ: "Dove", "500ml", "1L", "Dove 500ml").
 */
export function isOnlyBrandOrQuantity(text: string, brand?: string | null): boolean {
  if (!text) return true;
  let normalized = removeVietnameseTones(text);

  // Loại bỏ brand nếu có
  if (brand) {
    const brandNorm = removeVietnameseTones(brand);
    if (brandNorm) {
      const brandRegex = new RegExp(
        `(?:^|[^a-z0-9])${brandNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
        'gi'
      );
      normalized = normalized.replace(brandRegex, ' ').trim();
    }
  }

  // Loại bỏ các mẫu dung tích/khối lượng (ví dụ 500ml, 1l, 5kg, 900g, 1.5 lít)
  const qtyRegex = /(\d+(?:[.,]\d+)?)\s*(lit|liter|litre|l|ml|mililit|kg|kilogram|kilo|gram|gam|g)\b/gi;
  normalized = normalized.replace(qtyRegex, ' ').trim();

  // Loại bỏ các từ quy cách bao bì phụ trợ
  const packagingWords = /\b(chai|hop|goi|tui|lon|can|thung|lo|binh)\b/gi;
  normalized = normalized.replace(packagingWords, ' ').trim();

  // Loại bỏ ký tự không phải chữ số
  normalized = normalized.replace(/[^a-z0-9]+/gi, ' ').trim();

  // Nếu phần còn lại rỗng hoặc không còn từ khóa có nghĩa (độ dài < 2 ký tự)
  return normalized.length < 2;
}

/**
 * So sánh hai dung tích/khối lượng đã chuẩn hóa:
 * - Trả về true nếu trùng khớp quy cách (cho phép sai số làm tròn số thực < 0.001 khi đổi đơn vị).
 * - Trả về false nếu cùng loại (ví dụ cùng thể tích) nhưng khác quy cách (980ml != 1000ml). Không dùng dung sai 2%.
 * - Trả về null nếu khác loại đơn vị đo (ví dụ 1 cái thể tích, 1 cái khối lượng) hoặc không có đủ dữ liệu.
 */
export function compareQuantities(
  q1: StandardizedQuantity | null,
  q2: StandardizedQuantity | null
): boolean | null {
  if (!q1 || !q2) return null;
  if (q1.baseUnit !== q2.baseUnit) return null;

  const diff = Math.abs(q1.value - q2.value);
  // Chỉ cho phép sai số epsilon cực nhỏ do làm tròn số thực khi đổi đơn vị (ví dụ 1 l = 1000 ml)
  return diff < 0.001;
}

/**
 * Các nhóm loại sản phẩm không tương thích / loại trừ lẫn nhau trong cùng một ngành hàng.
 * Nếu AI nhận diện loại A mà sản phẩm trong kho là loại B (cùng nhóm) thì coi là mâu thuẫn loại sản phẩm.
 */
export const INCOMPATIBLE_TYPE_GROUPS: string[][] = [
  // Hóa mỹ phẩm & chăm sóc cá nhân
  ['sua tam', 'dau goi', 'dau xa', 'sua rua mat', 'kem danh rang', 'nuoc suc mieng', 'lan khu mui', 'kem duong', 'tay trang'],
  // Giặt tẩy vệ sinh gia đình
  ['nuoc giat', 'bot giat', 'nuoc xa vai', 'nuoc lau san', 'nuoc rua chen', 'nuoc tay bon cau', 'nuoc tay', 'sap thom', 'xit phong'],
  // Gia vị & thực phẩm nấu nướng
  ['dau an', 'nuoc mam', 'nuoc tuong', 'xi dau', 'tuong ot', 'tuong ca', 'hat nem', 'muoi', 'duong', 'bot ngot', 'mi chinh', 'giam'],
  // Đồ uống & sữa
  ['nuoc ngot', 'nuoc suoi', 'nuoc khoang', 'nuoc ep', 'bia', 'ruou', 'tra', 'ca phe', 'sua tuoi', 'sua chua', 'sua dac'],
  // Lương thực tinh bột
  ['gao', 'nep', 'mi goi', 'mi tom', 'bun', 'pho', 'mien', 'banh canh'],
  // Thiết bị & phụ kiện điện tử / chiếu sáng
  ['cap sac', 'day sac', 'day cap', 'cu sac', 'sac nhanh', 'chuot', 'ban phim', 'tai nghe', 'pin du phong', 'sac du phong', 'den', 'bong den'],
  // Dụng cụ cơ khí, cắt tỉa & thủ công
  ['keo', 'cay keo', 'keo cat', 'dao roc giay', 'kem cat', 'tua vit', 'kim'],
];

/**
 * Phát hiện mâu thuẫn loại sản phẩm giữa ảnh và sản phẩm trong kho.
 * Ví dụ: Cùng thương hiệu Dove 500ml nhưng bao bì là "sữa tắm" còn kho là "dầu gội".
 */
export function detectProductTypeConflict(
  aiText: string,
  prodText: string,
  prodName?: string,
  vectorSimilarity?: number
): { hasConflict: boolean; aiType?: string; prodType?: string } {
  const aiNorm = removeVietnameseTones(aiText);
  const prodNorm = removeVietnameseTones(prodText);

  for (const group of INCOMPATIBLE_TYPE_GROUPS) {
    const matchedAiTypes = group.filter((type) => containsWordBoundary(aiNorm, type));
    const matchedProdTypes = group.filter((type) => containsWordBoundary(prodNorm, type));

    if (matchedAiTypes.length > 0 && matchedProdTypes.length > 0) {
      const hasOverlap = matchedAiTypes.some((t) => matchedProdTypes.includes(t));
      if (!hasOverlap) {
        return {
          hasConflict: true,
          aiType: matchedAiTypes[0],
          prodType: matchedProdTypes[0],
        };
      }
    }
  }

  // Phát hiện mâu thuẫn chéo giữa Phụ kiện điện tử và Dược phẩm / Thực phẩm
  const isAiElectronics = ['cap sac', 'day sac', 'day cap', 'cu sac', 'sac nhanh', 'chuot', 'ban phim', 'tai nghe', 'pin du phong', 'do dien tu'].some(
    (t) => containsWordBoundary(aiNorm, t)
  );
  // Kiểm tra từ khóa thuốc/dược phẩm rõ ràng (luôn cấm nếu ảnh là phụ kiện điện tử)
  const isProdPharma = ['thuoc', 'duoc pham', 'men tieu hoa', 'siro', 'dung dich uong', 'hon dich uong', 'vien uong', 'khang sinh', 'giam dau', 'ha sot', 'da day', 'yumangel'].some(
    (t) => containsWordBoundary(prodNorm, t)
  );
  if (isAiElectronics && isProdPharma) {
    return {
      hasConflict: true,
      aiType: 'thiết bị/phụ kiện điện tử',
      prodType: 'thuốc / dược phẩm',
    };
  }

  // Kiểm tra thực phẩm rõ ràng dựa trên tên sản phẩm thực tế (trừ khi có độ tương đồng vector thị giác cao >= 0.50)
  const prodNameNorm = prodName ? removeVietnameseTones(prodName) : prodNorm;
  const isProdFood = ['dau an', 'nuoc mam', 'nuoc tuong', 'xi dau', 'tuong ot', 'hat nem', 'gao', 'mi tom', 'mi goi', 'banh'].some(
    (t) => containsWordBoundary(prodNameNorm, t)
  );
  if (isAiElectronics && isProdFood && !(vectorSimilarity !== undefined && vectorSimilarity >= 0.50)) {
    return {
      hasConflict: true,
      aiType: 'thiết bị/phụ kiện điện tử',
      prodType: 'thực phẩm / gia vị',
    };
  }

  // Phát hiện mâu thuẫn chéo giữa Dụng cụ cắt/thủ công và Thiết bị điện tử
  const isAiTools = ['keo', 'cay keo', 'keo cat', 'dao roc giay', 'kem cat', 'tua vit'].some(
    (t) => containsWordBoundary(aiNorm, t)
  );
  const isProdElectronics = ['chuot', 'ban phim', 'tai nghe', 'cap sac', 'cu sac', 'pin du phong', 'do dien tu'].some(
    (t) => containsWordBoundary(prodNorm, t)
  );
  if (isAiTools && isProdElectronics) {
    return {
      hasConflict: true,
      aiType: 'dụng cụ cắt / thủ công',
      prodType: 'thiết bị / phụ kiện điện tử',
    };
  }

  return { hasConflict: false };
}

/**
 * Chuẩn hóa chuỗi văn bản: không dấu, bỏ ký tự đặc biệt, đưa về chữ thường
 */
export function normalizeCleanText(str: string): string {
  if (!str) return '';
  return removeVietnameseTones(str)
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách các từ khóa có nghĩa từ chuỗi:
 * - Giữ các từ >= 2 ký tự.
 * - Giữ các hậu tố 1 ký tự (như "F" trong "Yumangel F", "C" trong "Vitamin C") khi nó đi liền sau một từ >= 2 ký tự.
 * - Loại bỏ các ký tự đơn lẻ đứng cô lập không có từ gốc đi kèm (tránh nhiễu ký tự rời rạc từ nền ảnh).
 */
export function extractSignificantTokens(str: string): string[] {
  const clean = normalizeCleanText(str);
  if (!clean) return [];
  const rawTokens = clean.split(/\s+/).filter(Boolean);
  const result: string[] = [];

  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    if (t.length >= 2) {
      result.push(t);
    } else if (t.length === 1 && /^[a-z0-9]$/i.test(t)) {
      // Giữ hậu tố 1 ký tự nếu nó đi liền sau một từ có nghĩa (độ dài >= 2)
      // Ví dụ: "Yumangel F" -> giữ cả "yumangel" và "f"
      if (i > 0 && rawTokens[i - 1].length >= 2) {
        result.push(t);
      }
    }
  }

  return result;
}

/**
 * Tính điểm tương đồng đối chiếu giữa thông tin trích xuất từ ảnh và sản phẩm trong kho (0 đến 100).
 *
 * LƯU Ý KỸ THUẬT:
 * Điểm match_score là chỉ số heuristic đối chiếu chuỗi và thuộc tính dựa trên tập luật (rule-based heuristic),
 * KHÔNG PHẢI xác suất thống kê hay độ tin cậy trực tiếp từ mô hình AI.
 */
export function calculateMatchScore(
  product: ProductRecord,
  ai: GeminiExtraction,
  vectorSimilarity?: number
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const prodRawText = `${product.name} ${product.notes || ''} ${product.category || ''}`;
  const prodCleanText = normalizeCleanText(prodRawText);
  const prodCleanName = normalizeCleanText(product.name);
  const prodNameTokens = extractSignificantTokens(product.name);

  // 0. Phát hiện mâu thuẫn loại sản phẩm (ví dụ: sữa tắm Dove vs dầu gội Dove)
  const aiCombinedText = `${ai.product_name || ''} ${ai.variant || ''} ${(ai.visible_text || []).join(' ')}`;
  const conflictCheck = detectProductTypeConflict(aiCombinedText, prodRawText, product.name, vectorSimilarity);

  if (conflictCheck.hasConflict) {
    return {
      score: 0,
      reasons: [
        `Mâu thuẫn loại sản phẩm (Ảnh nhận diện: "${conflictCheck.aiType}" ≠ Kho: "${conflictCheck.prodType}")`,
      ],
    };
  }

  let brandScore = 0;
  let nameScore = 0;
  let variantScore = 0;
  let visibleScore = 0;

  // 1. Đối chiếu thương hiệu / Nhà sản xuất (Brand) theo word boundary
  // Không bắt buộc kho phải chứa tên nhà sản xuất. Thiếu NSX trong kho không bị phạt.
  if (ai.brand) {
    const brandClean = normalizeCleanText(ai.brand);
    if (brandClean.length >= 2 && containsWordBoundary(prodCleanText, brandClean)) {
      brandScore = 20;
      reasons.push(`Trùng thương hiệu / NSX "${ai.brand}"`);
    }
  }

  // 2. Đối chiếu Tên sản phẩm thương mại (Product Name)
  const isNameJustBrand = Boolean(
    ai.brand && ai.product_name && isOnlyBrandOrQuantity(ai.product_name, ai.brand)
  );

  const aiNameClean = ai.product_name && !isNameJustBrand ? normalizeCleanText(ai.product_name) : '';
  const aiNameTokens = ai.product_name && !isNameJustBrand ? extractSignificantTokens(ai.product_name) : [];

  if (aiNameClean) {
    // 2a. Khớp toàn bộ cụm tên sản phẩm (Full phrase match)
    if (
      (prodCleanName.length >= 3 && aiNameClean.includes(prodCleanName)) ||
      (aiNameClean.length >= 3 && prodCleanName.includes(aiNameClean)) ||
      (prodCleanName.length >= 3 && containsWordBoundary(prodCleanText, aiNameClean))
    ) {
      nameScore = 45;
      reasons.push(`Khớp chính xác tên sản phẩm "${ai.product_name}"`);
    } else {
      // 2b. Khớp theo tập từ khóa
      if (prodNameTokens.length > 0 && aiNameTokens.length > 0) {
        let matchedCount = 0;
        for (let i = 0; i < prodNameTokens.length; i++) {
          const token = prodNameTokens[i];
          if (token.length === 1) {
            // Hậu tố 1 ký tự (ví dụ: "F" trong "Yumangel F", "C" trong "Vitamin C"):
            // KHÔNG ĐƯỢC khớp đơn lẻ nếu không có từ gốc đứng trước đi kèm!
            const prevToken = i > 0 ? prodNameTokens[i - 1] : null;
            if (prevToken && (aiNameTokens.includes(prevToken) || containsWordBoundary(aiNameClean, prevToken))) {
              if (aiNameTokens.includes(token) || containsWordBoundary(aiNameClean, token)) {
                matchedCount++;
              }
            }
          } else {
            if (aiNameTokens.includes(token) || containsWordBoundary(aiNameClean, token)) {
              matchedCount++;
            }
          }
        }
        const ratio = matchedCount / prodNameTokens.length;
        if (ratio >= 0.5) {
          nameScore = Math.round(ratio * 35);
          reasons.push(`Trùng ${matchedCount}/${prodNameTokens.length} từ khóa tên sản phẩm`);
        }
      }
    }
  }

  // 3. Đối chiếu biến thể / phân loại / quy cách (Variant)
  if (ai.variant) {
    const variantClean = normalizeCleanText(ai.variant);
    if (variantClean.length >= 2 && containsWordBoundary(prodCleanText, variantClean)) {
      variantScore = 15;
      reasons.push(`Khớp phân loại / dòng "${ai.variant}"`);
    }
  }

  // 4. Đối chiếu từ khóa đọc được trên bao bì (Visible Text)
  // ĐẶC BIỆT QUAN TRỌNG:
  // Nếu AI nhận diện product_name là tên loại chung (ví dụ "Hỗn dịch uống"), nhưng trong visible_text
  // có chứa tên thương mại trùng khớp với tên trong kho (ví dụ "Yumangel F"),
  // thì đây là BẰNG CHỨNG TRỰC TIẾP MẠNH MẼ và phải được tính điểm cao.
  let visibleEvidenceCount = 0;
  let visibleFullMatch = false;

  if (ai.visible_text && ai.visible_text.length > 0) {
    let matchedVisibleCount = 0;

    for (const text of ai.visible_text) {
      const textClean = normalizeCleanText(text);
      if (!textClean || textClean.length < 2) continue;

      // 4a. Kiểm tra khớp toàn bộ cụm tên sản phẩm trong kho với một dòng trong visible_text
      // Chỉ tính khi tên sản phẩm không chỉ là tên thương hiệu/quy cách
      if (
        prodCleanName.length >= 3 &&
        !isOnlyBrandOrQuantity(product.name, ai.brand) &&
        (textClean === prodCleanName || containsWordBoundary(textClean, prodCleanName))
      ) {
        visibleFullMatch = true;
        reasons.push(`Khớp trọn vẹn tên sản phẩm từ bao bì: "${text}"`);
        visibleEvidenceCount += 2;
        break;
      }

      // 4b. Khớp từng phần theo từ ngữ (không tính khi text chỉ là thương hiệu / dung tích)
      if (containsWordBoundary(prodCleanText, textClean)) {
        matchedVisibleCount++;
        if (!isOnlyBrandOrQuantity(text, ai.brand)) {
          visibleEvidenceCount++;
        }
      }
    }

    if (visibleFullMatch) {
      // Bằng chứng mạnh từ visible_text khớp tên sản phẩm
      visibleScore = Math.max(visibleScore, 40);
    } else if (matchedVisibleCount > 0) {
      visibleScore = Math.min(15, matchedVisibleCount * 4);
      reasons.push(`Khớp ${matchedVisibleCount} cụm từ trên bao bì`);
    }
  }

  // 4c. Kiểm tra bao phủ từ khóa tên sản phẩm trên toàn bộ dữ liệu nhận diện của AI
  // Loại bỏ các token trùng với brand để tránh việc trùng tên NSX bị tính là trùng tên sản phẩm
  const prodTokensNonBrand = prodNameTokens.filter((token) => {
    if (ai.brand) {
      const brandClean = normalizeCleanText(ai.brand);
      if (brandClean === token || containsWordBoundary(brandClean, token)) {
        return false;
      }
    }
    return true;
  });

  if (nameScore < 35 && !visibleFullMatch && prodTokensNonBrand.length > 0) {
    const allAiCleanText = normalizeCleanText(
      `${ai.product_name || ''} ${ai.variant || ''} ${(ai.visible_text || []).join(' ')}`
    );
    let matchedAllTokens = 0;
    for (let i = 0; i < prodTokensNonBrand.length; i++) {
      const token = prodTokensNonBrand[i];
      if (token.length === 1) {
        // Hậu tố 1 ký tự: chỉ tính nếu từ đứng liền trước cũng xuất hiện trong allAiCleanText
        const prevToken = i > 0 ? prodTokensNonBrand[i - 1] : null;
        if (prevToken && containsWordBoundary(allAiCleanText, prevToken)) {
          if (containsWordBoundary(allAiCleanText, token)) {
            matchedAllTokens++;
          }
        }
      } else {
        if (containsWordBoundary(allAiCleanText, token)) {
          matchedAllTokens++;
        }
      }
    }
    const overallRatio = matchedAllTokens / prodTokensNonBrand.length;
    if (overallRatio === 1.0) {
      // Khớp 100% tất cả các từ của tên sản phẩm (không tính brand) trên bao bì
      const coverageScore = 40;
      if (coverageScore > nameScore + visibleScore) {
        visibleScore = coverageScore;
        reasons.push(
          `Khớp đầy đủ ${prodTokensNonBrand.length}/${prodTokensNonBrand.length} từ của tên sản phẩm trên bao bì`
        );
        visibleEvidenceCount += 2;
      }
    } else if (overallRatio >= 0.65) {
      const coverageScore = Math.round(overallRatio * 30);
      if (coverageScore > nameScore + visibleScore) {
        visibleScore = coverageScore;
        reasons.push(
          `Khớp ${matchedAllTokens}/${prodTokensNonBrand.length} từ của tên sản phẩm trên bao bì`
        );
        visibleEvidenceCount += 1;
      }
    }
  }

  // 4d. Đối chiếu loại đồ vật thông dụng (Object Type) - Đặc biệt hiệu quả cho hàng không nhãn mác
  let objectTypeScore = 0;
  if (ai.object_type) {
    const objTypeClean = normalizeCleanText(ai.object_type);
    if (objTypeClean.length >= 2 && containsWordBoundary(prodCleanText, objTypeClean)) {
      objectTypeScore = 35;
      reasons.push(`Khớp loại đồ vật "${ai.object_type}"`);
    } else {
      // Khớp theo từ khóa cốt lõi của loại đồ vật (ví dụ "đèn" trong "đèn led xoay" khớp "đèn sao")
      const objTokens = extractSignificantTokens(ai.object_type);
      const matchedObjTokens = objTokens.filter(
        (t) => t.length >= 2 && containsWordBoundary(prodCleanText, t)
      );
      if (matchedObjTokens.length > 0) {
        objectTypeScore = Math.min(25, matchedObjTokens.length * 15);
        reasons.push(`Khớp loại đồ vật ("${matchedObjTokens.join(', ')}")`);
      }
    }
  }

  // 4e. Đối chiếu đặc điểm thị giác (màu sắc, hình dáng, chất liệu)
  let visualFeatureScore = 0;
  if (ai.visual_features) {
    const vfTokens = extractSignificantTokens(ai.visual_features);
    let vfMatched = 0;
    for (const t of vfTokens) {
      if (t.length >= 3 && containsWordBoundary(prodCleanText, t)) {
        vfMatched++;
      }
    }
    if (vfMatched > 0) {
      visualFeatureScore = Math.min(15, vfMatched * 5);
      reasons.push(`Khớp đặc điểm thị giác nhận diện (${vfMatched} từ khóa)`);
    }
  }

  // 4f. Đối chiếu gợi ý ngành hàng / danh mục
  let categoryHintScore = 0;
  if (ai.category_hint) {
    const catClean = normalizeCleanText(ai.category_hint);
    const prodCatClean = normalizeCleanText(product.category || '');
    if (
      (catClean.length >= 3 && prodCatClean.includes(catClean)) ||
      (prodCatClean.length >= 3 && catClean.includes(prodCatClean))
    ) {
      categoryHintScore = 10;
      reasons.push(`Phù hợp ngành hàng "${product.category}"`);
    }
  }

  // YÊU CẦU BẮT BUỘC: Phải có bằng chứng độc lập về tên, loại sản phẩm, hoặc độ tương đồng vector cao.
  const hasTextOrBrandEvidence =
    nameScore >= 20 ||
    variantScore >= 15 ||
    objectTypeScore >= 20 ||
    visibleFullMatch ||
    visibleEvidenceCount >= 2 ||
    (nameScore >= 15 && visibleEvidenceCount >= 1);

  // Nếu không có bất kỳ bằng chứng văn bản/nhãn hiệu nào, yêu cầu tương đồng thị giác phải thực sự cao (>= 0.75)
  // để tránh việc đồ vật ngoài kho hoặc thiết bị khác loại bị gán nhầm do tương đồng trung bình (0.50-0.70).
  const hasStrongVisualEvidence =
    vectorSimilarity !== undefined &&
    (hasTextOrBrandEvidence ? vectorSimilarity >= 0.50 : vectorSimilarity >= 0.75);

  const hasSubstantiveEvidence = hasTextOrBrandEvidence || hasStrongVisualEvidence;

  // 4g. Điểm tương đồng từ Vector Embedding (pgvector)
  let vectorScore = 0;
  if (vectorSimilarity !== undefined && vectorSimilarity > 0) {
    if (hasTextOrBrandEvidence) {
      if (vectorSimilarity >= 0.50) {
        vectorScore = Math.round(35 + (vectorSimilarity - 0.50) * 50);
      } else {
        vectorScore = Math.round(vectorSimilarity * 50);
      }
    } else {
      if (vectorSimilarity >= 0.75) {
        vectorScore = Math.round(35 + (vectorSimilarity - 0.75) * 60);
      } else {
        vectorScore = Math.round(vectorSimilarity * 40);
      }
    }
    reasons.push(`Tương đồng hình ảnh thị giác (cosine: ${vectorSimilarity.toFixed(2)})`);
  }

  if (!hasSubstantiveEvidence) {
    return {
      score: 0,
      reasons: reasons.length > 0 ? reasons : ['Thiếu bằng chứng độc lập về tên hoặc loại sản phẩm phù hợp'],
    };
  }

  // 5. Đối chiếu dung tích / khối lượng tịnh
  let score =
    brandScore +
    nameScore +
    variantScore +
    visibleScore +
    objectTypeScore +
    visualFeatureScore +
    categoryHintScore +
    vectorScore;

  const prodUnitClean = normalizeCleanText(product.unit || '');
  const isPackagingUnit = ['hop', 'thung', 'loc', 'vi', 'goi', 'cai', 'chiec'].includes(prodUnitClean);

  let aiQuantity: StandardizedQuantity | null = null;
  if (ai.quantity_value && ai.quantity_unit) {
    aiQuantity = standardizeQuantity(ai.quantity_value, ai.quantity_unit);
  } else if (ai.product_name) {
    aiQuantity = extractQuantityFromText(ai.product_name);
  }

  // Chỉ trích xuất dung tích sản phẩm trong kho nếu có ghi rõ số trong tên hoặc ghi chú
  const prodQuantity = extractQuantityFromText(`${product.name} ${product.notes || ''}`);

  if (aiQuantity && prodQuantity) {
    const isQtyMatch = compareQuantities(aiQuantity, prodQuantity);
    if (isQtyMatch === true) {
      score += 15;
      reasons.push(`Khớp dung tích / trọng lượng (${aiQuantity.value} ${aiQuantity.baseUnit})`);
    } else if (isQtyMatch === false && !isPackagingUnit) {
      // Chỉ phạt nặng khi cả hai bên là sản phẩm bán lẻ theo chai/lọ có dung tích khác nhau (ví dụ 500ml vs 1L)
      score -= 40;
      reasons.push(
        `Khác dung tích / trọng lượng (Bao bì: ${aiQuantity.value} ${aiQuantity.baseUnit} ≠ Kho: ${prodQuantity.value} ${prodQuantity.baseUnit})`
      );
    }
  }

  const finalScore = Math.max(0, Math.min(100, score));

  return {
    score: finalScore,
    reasons,
  };
}

export const MATCH_THRESHOLD = 35; // Ngưỡng điểm sàn tối thiểu để được coi là kết quả phù hợp
export const MAX_MATCHES = 5; // Tối đa 5 sản phẩm

/**
 * Đối chiếu thông tin AI trích xuất với danh sách sản phẩm trong kho và xếp hạng kết quả.
 * Hỗ trợ cả sản phẩm có bao bì nhãn mác lẫn đồ vật trơn không có chữ.
 */
export function rankProductMatches(
  products: ProductRecord[],
  ai: GeminiExtraction,
  vectorMatchesMap?: Map<string, number>
): ProductMatchResult[] {
  // Bắt buộc phải đọc được
  if (!ai.readable) {
    return [];
  }

  // Phải có tên sản phẩm, chữ bao bì, loại đồ vật nhận diện được, hoặc kết quả vector matching
  const hasSubstantiveVisible = Boolean(
    ai.visible_text &&
      ai.visible_text.some((t) => !isOnlyBrandOrQuantity(t, ai.brand))
  );

  const hasSubstantiveName = Boolean(
    ai.product_name &&
      !isOnlyBrandOrQuantity(ai.product_name, ai.brand)
  );

  const hasObjectType = Boolean(ai.object_type && ai.object_type.trim().length >= 2);
  const hasVectorMatches = Boolean(vectorMatchesMap && vectorMatchesMap.size > 0);

  if (!hasSubstantiveName && !hasSubstantiveVisible && !hasObjectType && !hasVectorMatches) {
    return [];
  }

  const scoredList: ProductMatchResult[] = [];

  for (const product of products) {
    const vecSim = vectorMatchesMap?.get(product.id);
    const { score, reasons } = calculateMatchScore(product, ai, vecSim);
    if (score >= MATCH_THRESHOLD && reasons.length > 0) {
      scoredList.push({
        product,
        match_score: score,
        match_reasons: reasons,
        vector_similarity: vecSim,
      });
    }
  }

  // Sắp xếp giảm dần theo match_score, nếu bằng điểm thì ưu tiên sản phẩm có nhiều lý do hơn
  scoredList.sort((a, b) => {
    if (b.match_score !== a.match_score) {
      return b.match_score - a.match_score;
    }
    return b.match_reasons.length - a.match_reasons.length;
  });

  return scoredList.slice(0, MAX_MATCHES);
}
