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
