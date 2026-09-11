// Unit tests for CORS allowlist, security validations, and Gemini runtime extraction checks
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  isOriginAllowed,
  validateOrigin,
  getCorsHeaders,
  handleCorsPreflight,
} from './cors.ts';
import { validateRuntimeExtraction } from './gemini.ts';

Deno.test('CORS: Origin hợp lệ (http://localhost:5173) được phép qua', () => {
  assertEquals(isOriginAllowed('http://localhost:5173'), true);

  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
  });

  const check = validateOrigin(req);
  assertEquals(check, null); // Cho phép đi tiếp

  const headers = getCorsHeaders(req);
  assertEquals(headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assertEquals(headers['Vary'], 'Origin');
});

Deno.test('CORS: Request không có Origin (curl, ứng dụng native) được phép qua', () => {
  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });

  const check = validateOrigin(req);
  assertEquals(check, null); // Cho phép đi tiếp
});

Deno.test('CORS: Origin không hợp lệ bị từ chối 403 Forbidden trước khi gọi AI và không có Allow-Origin', async () => {
  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'POST',
    headers: { origin: 'http://evil-attacker.com' },
  });

  const check = validateOrigin(req);
  assertNotEquals(check, null);
  assertEquals(check?.status, 403);

  const body = await check?.json();
  assertEquals(body.error, 'origin_not_allowed');
  assertEquals(check?.headers.get('Vary'), 'Origin');

  // getCorsHeaders không được fallback về '*' cho origin này
  const headers = getCorsHeaders(req);
  assertEquals(headers['Access-Control-Allow-Origin'], undefined);
});

Deno.test('CORS Preflight: OPTIONS request từ Origin không hợp lệ bị từ chối 403', () => {
  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'OPTIONS',
    headers: { origin: 'http://untrusted-site.org' },
  });

  const preflight = handleCorsPreflight(req);
  assertNotEquals(preflight, null);
  assertEquals(preflight?.status, 403);
});

Deno.test('CORS Preflight: OPTIONS request từ Origin hợp lệ trả về 204 No Content', () => {
  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173' },
  });

  const preflight = handleCorsPreflight(req);
  assertNotEquals(preflight, null);
  assertEquals(preflight?.status, 204);
  assertEquals(
    preflight?.headers.get('Access-Control-Allow-Origin'),
    'http://localhost:5173'
  );
  assertEquals(preflight?.headers.get('Vary'), 'Origin');
});

Deno.test('Gemini Validation: Runtime checking từ chối kiểu dữ liệu giả mạo từ JSON', () => {
  // 1. Trường readable là chuỗi "false" (phải bị từ chối trả về null thay vì ép kiểu)
  const fakePayload1 = {
    readable: 'false',
    product_name: 'Dầu gội',
    quantity_value: '500', // chuỗi số thay vì số thực
  };
  const extracted1 = validateRuntimeExtraction(fakePayload1);
  assertEquals(extracted1, null);

  // 2. Số lượng âm hoặc không hữu hạn bị từ chối hoàn toàn (trả về null)
  const fakePayload2 = {
    readable: true,
    product_name: 'Sữa tươi',
    quantity_value: -100,
    quantity_unit: 'ml',
  };
  const extracted2 = validateRuntimeExtraction(fakePayload2);
  assertEquals(extracted2, null);

  // 3. Payload hợp lệ nhưng visible_text nhiều hơn 10 phần tử phải được cắt gọn về 10
  const validPayload = {
    readable: true,
    product_name: 'Bánh gạo One One',
    quantity_value: 150,
    quantity_unit: 'g',
    visible_text: Array.from({ length: 25 }, (_, i) => `text-${i}`),
  };
  const extracted3 = validateRuntimeExtraction(validPayload);
  assertNotEquals(extracted3, null);
  assertEquals(extracted3?.readable, true);
  assertEquals(extracted3?.product_name, 'Bánh gạo One One');
  assertEquals(extracted3?.quantity_value, 150);
  assertEquals(extracted3?.quantity_unit, 'g');
  assertEquals(extracted3?.visible_text.length, 10);
});
