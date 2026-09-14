import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateScanRegion,
  normalizeBarcode,
  createCameraConstraints,
  BarcodeScannerSessionManager,
  type MinimalHtml5QrcodeInstance,
} from './barcodeScannerController.ts';

describe('calculateScanRegion', () => {
  it('tính toán vùng quét cho màn hình điện thoại nhỏ (320x240)', () => {
    const region = calculateScanRegion(320, 240);
    assert.ok(region.width <= 320, 'Chiều rộng không được vượt quá 320');
    assert.ok(region.height <= 240, 'Chiều cao không được vượt quá 240');
    assert.ok(region.width >= 200, 'Chiều rộng cần đủ tối thiểu 200 cho mã 1D');
    assert.ok(region.width > region.height * 1.5, 'Tỷ lệ phải là hình chữ nhật ngang cho mã vạch');
  });

  it('tính toán vùng quét cho màn hình điện thoại phổ biến (375x281 & 412x309)', () => {
    const r375 = calculateScanRegion(375, 281);
    assert.ok(r375.width <= 375);
    assert.ok(r375.height <= 281);
    assert.ok(r375.width >= 250, 'Chiều rộng trên màn hình 375px phải đủ rộng');
    assert.ok(r375.height <= 160, 'Chiều cao không vượt quá 160px để tập trung mã vạch');

    const r412 = calculateScanRegion(412, 309);
    assert.ok(r412.width <= 412);
    assert.ok(r412.height <= 309);
    assert.ok(r412.width >= 300);
  });

  it('tính toán vùng quét cho video chuẩn 640x480 và 1280x720', () => {
    const r640 = calculateScanRegion(640, 480);
    assert.ok(r640.width <= 640);
    assert.ok(r640.height <= 480);
    assert.ok(r640.height <= 160);

    const r1280 = calculateScanRegion(1280, 720);
    assert.ok(r1280.width <= 1280);
    assert.ok(r1280.height <= 720);
  });

  it('xử lý an toàn các kích thước cực đoan', () => {
    const rSmall = calculateScanRegion(50, 40);
    assert.ok(rSmall.width <= 50);
    assert.ok(rSmall.height <= 40);
    assert.ok(rSmall.width >= 1);
    assert.ok(rSmall.height >= 1);
  });
});

describe('normalizeBarcode', () => {
  it('giữ nguyên các số 0 ở đầu mã vạch EAN/UPC', () => {
    const codeWithLeadingZero = '012345678905';
    assert.equal(normalizeBarcode(codeWithLeadingZero), '012345678905');
  });

  it('trim khoảng trắng ở hai đầu', () => {
    assert.equal(normalizeBarcode('  8935001234567  '), '8935001234567');
    assert.equal(normalizeBarcode('\n098765432101\t'), '098765432101');
  });

  it('xử lý chuỗi rỗng và giá trị không hợp lệ', () => {
    assert.equal(normalizeBarcode(''), '');
    assert.equal(normalizeBarcode(null), '');
    assert.equal(normalizeBarcode(undefined), '');
  });
});

describe('createCameraConstraints', () => {
  it('tạo constraints ưu tiên camera sau và 720p khi không có deviceId', () => {
    const { primary, fallback } = createCameraConstraints();
    assert.deepEqual(primary.facingMode, { ideal: 'environment' });
    assert.deepEqual(primary.width, { ideal: 1280 });
    assert.deepEqual(primary.height, { ideal: 720 });
    assert.equal(fallback.facingMode, 'environment');
  });

  it('tạo constraints với deviceId cụ thể khi có cameraIdOverride', () => {
    const { primary, fallback } = createCameraConstraints('cam-id-123');
    assert.deepEqual(primary.deviceId, { exact: 'cam-id-123' });
    assert.deepEqual(primary.width, { ideal: 1280 });
    assert.deepEqual(fallback.deviceId, { exact: 'cam-id-123' });
  });
});

describe('BarcodeScannerSessionManager', () => {
  it('tăng session ID mỗi khi bắt đầu phiên mới', () => {
    const manager = new BarcodeScannerSessionManager();
    const session1 = manager.startNewSession();
    const session2 = manager.startNewSession();

    assert.equal(session2, session1 + 1);
    assert.equal(manager.isSessionActive(session1), false, 'Session 1 phải không còn active');
    assert.equal(manager.isSessionActive(session2), true, 'Session 2 phải đang active');
  });

  it('vô hiệu hóa phiên hiện tại khi invalidateSession()', () => {
    const manager = new BarcodeScannerSessionManager();
    const session = manager.startNewSession();
    assert.equal(manager.isSessionActive(session), true);

    manager.invalidateSession();
    assert.equal(manager.isSessionActive(session), false);
  });

  it('tuần tự hóa các tác vụ async qua enqueueAction', async () => {
    const manager = new BarcodeScannerSessionManager();
    const order: number[] = [];

    const p1 = manager.enqueueAction(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return 'one';
    });

    const p2 = manager.enqueueAction(async () => {
      order.push(2);
      return 'two';
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    assert.equal(res1, 'one');
    assert.equal(res2, 'two');
    assert.deepEqual(order, [1, 2], 'Các tác vụ phải hoàn thành theo thứ tự tuần tự');
  });

  it('safeStopAndClear gọi stop trước rồi mới gọi clear', async () => {
    const manager = new BarcodeScannerSessionManager();
    const callOrder: string[] = [];

    const mockScanner: MinimalHtml5QrcodeInstance = {
      isScanning: true,
      stop: async () => {
        callOrder.push('stop');
      },
      clear: () => {
        callOrder.push('clear');
      },
    };

    await manager.safeStopAndClear(mockScanner);
    assert.deepEqual(callOrder, ['stop', 'clear']);
  });

  it('safeStopAndClear vẫn gọi clear kể cả khi stop() bị ném lỗi', async () => {
    const manager = new BarcodeScannerSessionManager();
    const callOrder: string[] = [];

    const mockScanner: MinimalHtml5QrcodeInstance = {
      isScanning: true,
      stop: async () => {
        callOrder.push('stop');
        throw new Error('Camera stream already closed');
      },
      clear: () => {
        callOrder.push('clear');
      },
    };

    await manager.safeStopAndClear(mockScanner);
    assert.deepEqual(callOrder, ['stop', 'clear'], 'clear() vẫn phải được gọi trong finally');
  });

  it('xử lý kịch bản race condition: start() hoàn thành sau khi modal đã đóng', async () => {
    const manager = new BarcodeScannerSessionManager();
    const sessionId = manager.startNewSession();

    let stoppedCalled = false;
    let clearedCalled = false;

    const mockScanner: MinimalHtml5QrcodeInstance = {
      isScanning: true,
      stop: async () => {
        stoppedCalled = true;
      },
      clear: () => {
        clearedCalled = true;
      },
    };

    // Mô phỏng người dùng đóng modal trong khi start() đang chạy
    manager.invalidateSession();

    // Giả lập khi start() bất đồng bộ hoàn thành, kiểm tra session
    if (!manager.isSessionActive(sessionId)) {
      await manager.safeStopAndClear(mockScanner);
    }

    assert.equal(stoppedCalled, true, 'Camera phải tự động dừng khi start muộn');
    assert.equal(clearedCalled, true, 'Scanner phải được clear sạch sẽ');
  });
});
