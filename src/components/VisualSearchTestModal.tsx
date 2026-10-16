import { useState, useEffect, useCallback, useRef } from 'react';
import {
  runEmbeddingTest,
  runScenario1,
  runScenario2,
  runScenario3,
  runScenario4,
  runScenario5,
  runScenario6,
  runScenario7,
  runInspectTargetProducts,
  runVisualSearchScenarios,
  type ScenarioResult,
  type TestSuiteReport,
} from '../utils/visualSearchTestRunner';
import { runAllLifecycleTests } from '../utils/vectorLifecycleTestRunner';

interface VisualSearchTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessReload?: () => void;
}

export function VisualSearchTestModal({ isOpen, onClose, onSuccessReload }: VisualSearchTestModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const autoRunTriggeredRef = useRef(false);

  const updateScenarioResult = useCallback((newRes: ScenarioResult) => {
    setResults((prev) => {
      const idx = prev.findIndex((r) => r.scenarioNumber === newRes.scenarioNumber);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = newRes;
        return next;
      }
      return [...prev, newRes].sort((a, b) => a.scenarioNumber - b.scenarioNumber);
    });
  }, []);

  const handleRunSingle = useCallback(
    async (
      name: string,
      runner: (onProgress?: (msg: string) => void) => Promise<ScenarioResult>
    ) => {
      setIsRunning(true);
      setCurrentStep(`Đang chạy: ${name}...`);
      setError(null);

      try {
        const res = await runner(setCurrentStep);
        updateScenarioResult(res);
        if (onSuccessReload) onSuccessReload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRunning(false);
        setCurrentStep(null);
      }
    },
    [onSuccessReload, updateScenarioResult]
  );

  // Tự động kích hoạt khi có query param autoRun
  useEffect(() => {
    if (!isOpen || autoRunTriggeredRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const autoRun = params.get('autoRun');
    if (!autoRun) return;

    autoRunTriggeredRef.current = true;
    const timer = window.setTimeout(() => {
      if (autoRun === 'inspect') {
        void handleRunSingle('Kiểm tra 5 sản phẩm (10, 09, 08, C01, C02)', runInspectTargetProducts);
      } else if (autoRun === '1') {
        void handleRunSingle('Kịch bản 1: Món 01 không nhãn', runScenario1);
      } else if (autoRun === '2') {
        void handleRunSingle('Kịch bản 2: Type-C vs Lightning', runScenario2);
      } else if (autoRun === '3') {
        void handleRunSingle('Kịch bản 3: Đổi ảnh C01', runScenario3);
      } else if (autoRun === '4') {
        void handleRunSingle('Kịch bản 4: Cây kéo ngoài kho', runScenario4);
      } else if (autoRun === '5') {
        void handleRunSingle('Kịch bản 5: Xóa mềm', runScenario5);
      } else if (autoRun === '6') {
        void handleRunSingle('Kịch bản 6: Yumangel F', runScenario6);
      } else if (autoRun === '7') {
        void handleRunSingle('Kịch bản 7: Đèn sao (mã 10)', runScenario7);
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [isOpen, handleRunSingle]);

  if (!isOpen) return null;

  const handleRunLifecycleTests = async () => {
    setIsRunning(true);
    setCurrentStep('Đang khởi chạy 8 ca kiểm tra vòng đời vector, bảo mật CSDL & giả lập lỗi Vision (Non-AI)...');
    setError(null);

    try {
      const lcResults = await runAllLifecycleTests();
      const mapped: ScenarioResult[] = lcResults.map((lc) => ({
        scenarioNumber: 100 + lc.testNumber,
        title: `Vòng đời [Ca ${lc.testNumber}]: ${lc.testName}`,
        passed: lc.passed,
        latencyMs: 0,
        details: lc.details,
        summary: lc.summary,
      }));
      setResults((prev) => {
        const nonLc = prev.filter((r) => r.scenarioNumber < 100);
        return [...nonLc, ...mapped].sort((a, b) => a.scenarioNumber - b.scenarioNumber);
      });
      if (onSuccessReload) onSuccessReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
    }
  };

  const handleRunAll = async () => {
    setIsRunning(true);
    setCurrentStep('Đang khởi chạy toàn bộ 6 kịch bản kiểm thử...');
    setError(null);
    setResults([]);

    try {
      const suiteReport: TestSuiteReport = await runVisualSearchScenarios(setCurrentStep);
      setResults(suiteReport.scenarios);
      if (onSuccessReload) onSuccessReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
    }
  };

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        className="modal-card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          padding: '1.5rem',
          color: '#1e293b',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0f172a', margin: 0 }}>
              🧪 Kiểm thử thực nghiệm 6 kịch bản Visual Search
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0 0' }}>
              Kiểm tra model gemini-embedding-001 (768 chiều), Storage vision extraction, pgvector và OCR matching
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 12px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              color: '#475569',
            }}
          >
            Đóng
          </button>
        </div>

        {/* Thanh điều khiển kiểm thử */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              onClick={() => handleRunSingle('Kiểm tra gemini-embedding-001', () => runEmbeddingTest())}
              disabled={isRunning}
              style={{
                backgroundColor: '#f8fafc',
                color: '#0284c7',
                border: '1px solid #bae6fd',
                borderRadius: '8px',
                padding: '8px 14px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              🔍 Test Embedding API (768d)
            </button>

            <button
              type="button"
              onClick={handleRunLifecycleTests}
              disabled={isRunning}
              style={{
                backgroundColor: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                borderRadius: '8px',
                padding: '8px 14px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              🛡️ Test Vòng đời Vector & Token Lease (8 ca Non-AI)
            </button>

            <button
              type="button"
              onClick={handleRunAll}
              disabled={isRunning}
              style={{
                backgroundColor: isRunning ? '#94a3b8' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isRunning ? '⏳ Đang thực thi...' : '▶ Chạy toàn bộ 6 kịch bản (giãn cách 8s)'}
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 1: Món 01 không nhãn', runScenario1)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 1 (Không nhãn)
            </button>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 2: Type-C vs Lightning', runScenario2)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 2 (Type-C / Lightning)
            </button>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 3: Đổi ảnh sang củ sạc', runScenario3)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 3 (Đổi ảnh C01)
            </button>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 4: Cây kéo ngoài kho', runScenario4)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 4 (Vật ngoài kho)
            </button>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 5: Xóa mềm', runScenario5)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 5 (Loại trừ Soft Delete)
            </button>
            <button
              type="button"
              onClick={() => handleRunSingle('Kịch bản 6: Yumangel F', runScenario6)}
              disabled={isRunning}
              style={{
                backgroundColor: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 6 (Yumangel F)
            </button>
            <button
              type="button"
              id="btn-run-kb7-disco-light"
              onClick={() => handleRunSingle('Kịch bản 7: Đèn sao (mã 10)', runScenario7)}
              disabled={isRunning}
              style={{
                backgroundColor: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Chạy KB 7 (Đèn sao mã 10)
            </button>
            <button
              type="button"
              id="btn-run-kb8-inspect"
              onClick={() => handleRunSingle('Kiểm tra 5 sản phẩm (10, 09, 08, C01, C02)', runInspectTargetProducts)}
              disabled={isRunning}
              style={{
                backgroundColor: '#e0e7ff',
                color: '#3730a3',
                border: '1px solid #c7d2fe',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              Kiểm tra 5 mã kho (10, 09, 08, C01, C02)
            </button>
          </div>

          {currentStep && (
            <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: '#0284c7', fontWeight: '500' }}>
              {currentStep}
            </p>
          )}
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.875rem',
            }}
          >
            <strong>Lỗi:</strong> {error}
          </div>
        )}

        {totalCount > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                backgroundColor: passedCount === totalCount ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${passedCount === totalCount ? '#bbf7d0' : '#fecaca'}`,
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontSize: '1.4rem' }}>{passedCount === totalCount ? '✅' : '⚠️'}</div>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
                  Đạt {passedCount} / {totalCount} kịch bản đã kiểm tra
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {results.map((s) => (
                <div
                  key={s.scenarioNumber}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    backgroundColor: s.passed ? '#f8fafc' : '#fff5f5',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontWeight: '600', fontSize: '0.9rem', color: '#0f172a' }}>
                      {s.scenarioNumber === 0 ? 'Kiểm tra' : `Kịch bản ${s.scenarioNumber}`}: {s.title}
                    </div>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: s.passed ? '#dcfce7' : '#fee2e2',
                        color: s.passed ? '#166534' : '#991b1b',
                      }}
                    >
                      {s.passed ? 'ĐẠT' : 'CHƯA ĐẠT'} • {s.latencyMs} ms
                    </span>
                  </div>
                  <div style={{ fontSize: '0.825rem', color: '#334155', marginTop: '4px', lineHeight: '1.4' }}>
                    {s.summary}
                  </div>
                  <details open={s.scenarioNumber === 7} style={{ marginTop: '4px' }}>
                    <summary style={{ fontSize: '0.75rem', color: '#64748b', cursor: 'pointer' }}>
                      Chi tiết kỹ thuật (JSON)
                    </summary>
                    <div
                      style={{
                        fontSize: '0.72rem',
                        fontFamily: 'monospace',
                        backgroundColor: '#f1f5f9',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        marginTop: '4px',
                        color: '#475569',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(s.details, null, 2)}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
