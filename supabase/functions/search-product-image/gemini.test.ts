// Unit tests for Gemini error sanitization and diagnostic logging
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { sanitizeErrorMessage } from './gemini.ts';

Deno.test('sanitizeErrorMessage: Che toàn bộ giá trị API key hiện tại', () => {
  const currentKey = 'AIzaSySecretCustomKey123456789012345';
  const rawMsg = `API request failed with key ${currentKey} in project 123456`;
  const sanitized = sanitizeErrorMessage(rawMsg, currentKey);

  assertEquals(sanitized.includes(currentKey), false);
  assertStringIncludes(sanitized, '[REDACTED_API_KEY]');
});

Deno.test('sanitizeErrorMessage: Che chuỗi định dạng Google API key (AIza...)', () => {
  const rawMsg = 'Invalid API key provided: AIzaSyD-abc1234567890_XYZ123456789012. Please check Google Cloud Console.';
  const sanitized = sanitizeErrorMessage(rawMsg);

  assertEquals(sanitized.includes('AIzaSyD-abc1234567890_XYZ123456789012'), false);
  assertStringIncludes(sanitized, '[REDACTED_API_KEY]');
});

Deno.test('sanitizeErrorMessage: Che chuỗi query parameter key= và token=', () => {
  const rawMsg = 'Failed URL: https://generativelanguage.googleapis.com/v1beta?key=abc1234567890&token=xyz987654321';
  const sanitized = sanitizeErrorMessage(rawMsg);

  assertEquals(sanitized.includes('abc1234567890'), false);
  assertEquals(sanitized.includes('xyz987654321'), false);
  assertStringIncludes(sanitized, 'key=[REDACTED]');
});

Deno.test('sanitizeErrorMessage: Cắt ngắn chuỗi tối đa 500 ký tự', () => {
  const longMsg = 'Error details: ' + 'A'.repeat(600);
  const sanitized = sanitizeErrorMessage(longMsg);

  assertEquals(sanitized.length <= 500, true);
  assertEquals(sanitized.length, 500);
});

Deno.test('sanitizeErrorMessage: Giữ nguyên thông báo an toàn không chứa key', () => {
  const safeMsg = 'models/gemini-3.6-flash is not found for API version v1beta';
  const sanitized = sanitizeErrorMessage(safeMsg);

  assertEquals(sanitized, safeMsg);
});

// Tests cho extractJsonText
import { extractJsonText, validateRuntimeExtraction } from './gemini.ts';

Deno.test('extractJsonText: Bóc tách thành công JSON thuần', () => {
  const raw = '{"readable":true,"product_name":"Mì Hảo Hảo","brand":"Acecook"}';
  const result = extractJsonText(raw);
  assertEquals(result, raw);
  assertEquals(JSON.parse(result).product_name, 'Mì Hảo Hảo');
});

Deno.test('extractJsonText: Bóc tách thành công JSON bọc trong Markdown codeblock ```json', () => {
  const raw = '```json\n{\n  "readable": true,\n  "product_name": "Sữa tắm Dove",\n  "brand": "Dove"\n}\n```';
  const result = extractJsonText(raw);
  assertEquals(JSON.parse(result).product_name, 'Sữa tắm Dove');
});

Deno.test('extractJsonText: Bóc tách thành công JSON có BOM và khoảng trắng', () => {
  const raw = '\uFEFF  \n{"readable":false,"product_name":null}  \n';
  const result = extractJsonText(raw);
  assertEquals(JSON.parse(result).readable, false);
});

Deno.test('extractJsonText: Trích xuất JSON khi có văn bản phụ bao ngoài', () => {
  const raw = 'Dưới đây là kết quả phân tích bao bì sản phẩm:\n{"readable":true,"product_name":"Dầu gội Clear","brand":"Clear"}\nChúc bạn một ngày tốt lành!';
  const result = extractJsonText(raw);
  assertEquals(JSON.parse(result).product_name, 'Dầu gội Clear');
});

Deno.test('validateRuntimeExtraction: Kiểm tra hợp lệ dữ liệu trích xuất đầy đủ', () => {
  const validObj = {
    readable: true,
    product_name: 'Nước mắm Nam Ngư',
    brand: 'Nam Ngư',
    variant: 'Đệ Nhị',
    quantity_value: 900,
    quantity_unit: 'ml',
    visible_text: ['Nam Ngư', 'Đệ Nhị', '900ml'],
  };
  const validated = validateRuntimeExtraction(validObj);
  assertEquals(validated?.readable, true);
  assertEquals(validated?.product_name, 'Nước mắm Nam Ngư');
  assertEquals(validated?.quantity_value, 900);
});

Deno.test('validateRuntimeExtraction: Từ chối dữ liệu thiếu readable boolean hoặc sai kiểu', () => {
  const invalid1 = { readable: 'true', product_name: 'Test' };
  assertEquals(validateRuntimeExtraction(invalid1), null);

  const invalid2 = { readable: true, quantity_value: -50 };
  assertEquals(validateRuntimeExtraction(invalid2), null);
});

// Tests cho buildGeminiThinkingConfig
import { buildGeminiThinkingConfig } from './gemini.ts';

Deno.test('buildGeminiThinkingConfig: Tự động tắt thinking (thinkingBudget: 0) cho Gemini 2.5', () => {
  const cfg = buildGeminiThinkingConfig('gemini-2.5-flash');
  assertEquals(cfg, { thinkingBudget: 0 });
});

Deno.test('buildGeminiThinkingConfig: Tự động đặt thinkingLevel: MINIMAL cho Gemini 3', () => {
  const cfg = buildGeminiThinkingConfig('gemini-3.6-flash');
  assertEquals(cfg, { thinkingLevel: 'MINIMAL' });
});

Deno.test('buildGeminiThinkingConfig: Ưu tiên biến môi trường GEMINI_THINKING_BUDGET nếu có', () => {
  const cfg = buildGeminiThinkingConfig('gemini-3.6-flash', '512');
  assertEquals(cfg, { thinkingBudget: 512 });
});

Deno.test('buildGeminiThinkingConfig: Ưu tiên biến môi trường GEMINI_THINKING_LEVEL nếu có', () => {
  const cfg = buildGeminiThinkingConfig('gemini-2.5-flash', undefined, 'low');
  assertEquals(cfg, { thinkingLevel: 'LOW' });
});

Deno.test('buildGeminiThinkingConfig: Trả undefined cho các model không thuộc 2.5 hoặc 3', () => {
  const cfg = buildGeminiThinkingConfig('gemini-1.5-flash');
  assertEquals(cfg, undefined);
});
