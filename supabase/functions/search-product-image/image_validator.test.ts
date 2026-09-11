// Unit tests for image validation, streaming limit, and magic bytes detection
import { assertEquals } from 'jsr:@std/assert@1';
import {
  detectImageMimeType,
  validateImageRequest,
} from './image_validator.ts';

Deno.test('Magic Bytes: Nhận diện chính xác chữ ký ảnh JPEG (FF D8 FF)', () => {
  const jpegBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  assertEquals(detectImageMimeType(jpegBytes), 'image/jpeg');
});

Deno.test('Magic Bytes: Nhận diện chính xác chữ ký ảnh PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  assertEquals(detectImageMimeType(pngBytes), 'image/png');
});

Deno.test('Magic Bytes: Nhận diện chính xác chữ ký ảnh WebP (RIFF....WEBP)', () => {
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // file size
    0x57, 0x45, 0x42, 0x50, // WEBP
  ]);
  assertEquals(detectImageMimeType(webpBytes), 'image/webp');
});

Deno.test('Magic Bytes: Từ chối file văn bản hoặc file giả mạo đuôi ảnh', () => {
  const fakeBytes = new TextEncoder().encode('Hello world! This is a text file posing as jpg.');
  assertEquals(detectImageMimeType(fakeBytes), null);

  const pdfBytes = new TextEncoder().encode('%PDF-1.5 fake pdf content');
  assertEquals(detectImageMimeType(pdfBytes), null);
});

Deno.test('Magic Bytes: Từ chối dữ liệu quá ngắn (< 12 bytes)', () => {
  const shortBytes = new Uint8Array([0xff, 0xd8, 0xff]);
  assertEquals(detectImageMimeType(shortBytes), null);
});

Deno.test('Streaming Limit: Từ chối request có stream body vượt quá MAX_REQUEST_BYTES (HTTP 413)', async () => {
  // Tạo ReadableStream phát ra các chunk vượt quá giới hạn
  const oversizedStream = new ReadableStream({
    start(controller) {
      const chunk = new Uint8Array(1024 * 1024); // 1 MiB mỗi chunk
      chunk.fill(0xaa);
      for (let i = 0; i < 6; i++) {
        controller.enqueue(chunk); // 6 MiB tổng cộng > MAX_REQUEST_BYTES (5MiB + 64KiB)
      }
      controller.close();
    },
  });

  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
      // Cố tình không gửi Content-Length để kiểm tra cơ chế ngắt stream chủ động
    },
    body: oversizedStream,
    // @ts-expect-error: duplex is required in Deno for streaming body
    duplex: 'half',
  });

  const result = await validateImageRequest(req);
  assertEquals(result.valid, false);
  assertEquals(result.status, 413);
  assertEquals(result.error, 'request_payload_too_large');
});

Deno.test('validateImageRequest: Từ chối request không có Content-Type multipart/form-data', async () => {
  const req = new Request('http://localhost:54321/functions/v1/search-product-image', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hello: 'world' }),
  });

  const result = await validateImageRequest(req);
  assertEquals(result.valid, false);
  assertEquals(result.status, 400);
  assertEquals(result.error, 'invalid_content_type');
});
