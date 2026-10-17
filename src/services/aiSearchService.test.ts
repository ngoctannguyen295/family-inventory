import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImageFileClient,
  MAX_IMAGE_FILE_SIZE,
  ALLOWED_IMAGE_TYPES,
} from './aiSearchService.ts';

test('aiSearchService - validateImageFileClient', async (t) => {
  await t.test('kiểm tra danh sách định dạng ảnh được hỗ trợ', () => {
    assert.deepEqual(ALLOWED_IMAGE_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  });

  await t.test('từ chối khi file null hoặc undefined', () => {
    const resNull = validateImageFileClient(null);
    assert.equal(resNull.valid, false);
    assert.match(resNull.errorMessage ?? '', /Vui lòng chọn một file ảnh/);

    const resUndefined = validateImageFileClient(undefined);
    assert.equal(resUndefined.valid, false);
  });

  await t.test('từ chối khi file rỗng (0 bytes)', () => {
    const emptyFile = new File([], 'test.jpg', { type: 'image/jpeg' });
    const res = validateImageFileClient(emptyFile);
    assert.equal(res.valid, false);
    assert.match(res.errorMessage ?? '', /rỗng \(0 bytes\)/);
  });

  await t.test('từ chối khi dung lượng vượt quá 5MB', () => {
    const largeBuffer = new Uint8Array(MAX_IMAGE_FILE_SIZE + 1024);
    const largeFile = new File([largeBuffer], 'large.jpg', { type: 'image/jpeg' });
    const res = validateImageFileClient(largeFile);
    assert.equal(res.valid, false);
    assert.match(res.errorMessage ?? '', /vượt quá giới hạn cho phép tối đa là 5 MB/);
  });

  await t.test('từ chối file định dạng HEIC/HEIF và hướng dẫn chuyển đổi', () => {
    const heicFile1 = new File(['dummy content'], 'photo.heic', { type: 'image/heic' });
    const res1 = validateImageFileClient(heicFile1);
    assert.equal(res1.valid, false);
    assert.match(res1.errorMessage ?? '', /HEIC\/HEIF/);

    const heicFile2 = new File(['dummy content'], 'photo.HEIF', { type: 'application/octet-stream' });
    const res2 = validateImageFileClient(heicFile2);
    assert.equal(res2.valid, false);
    assert.match(res2.errorMessage ?? '', /HEIC\/HEIF/);
  });

  await t.test('từ chối định dạng không hỗ trợ (PDF, TXT, GIF)', () => {
    const pdfFile = new File(['%PDF-1.4'], 'document.pdf', { type: 'application/pdf' });
    const res = validateImageFileClient(pdfFile);
    assert.equal(res.valid, false);
    assert.match(res.errorMessage ?? '', /không được hỗ trợ/);
  });

  await t.test('chấp nhận các định dạng chuẩn JPEG, PNG, WebP hợp lệ', () => {
    const jpgFile = new File(['fake-jpg-content'], 'product.jpg', { type: 'image/jpeg' });
    assert.equal(validateImageFileClient(jpgFile).valid, true);

    const pngFile = new File(['fake-png-content'], 'product.png', { type: 'image/png' });
    assert.equal(validateImageFileClient(pngFile).valid, true);

    const webpFile = new File(['fake-webp-content'], 'product.webp', { type: 'image/webp' });
    assert.equal(validateImageFileClient(webpFile).valid, true);
  });
});
