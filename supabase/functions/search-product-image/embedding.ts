// Module sinh Vector Embedding từ đặc tính thị giác qua Google gemini-embedding-001
// Chuẩn hóa vector đầu ra dạng mảng 768 float số thực, phục vụ so sánh Cosine Similarity trên pgvector.

export interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  error?: string;
  durationMs?: number;
}

/**
 * Sinh vector embedding 768 chiều từ mô tả đặc tính thị giác (Visual Signature)
 * sử dụng model gemini-embedding-001 của Google AI Studio.
 */
export async function generateVisualEmbedding(text: string): Promise<EmbeddingResult> {
  const startTime = performance.now();
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const embeddingModel = Deno.env.get('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001';

  if (!apiKey) {
    return {
      success: false,
      error: 'missing_gemini_api_key',
    };
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return {
      success: false,
      error: 'empty_text_input',
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent`;

  const requestBody = {
    model: `models/${embeddingModel}`,
    content: {
      parts: [
        {
          text: cleanText,
        },
      ],
    },
    outputDimensionality: 768,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 12000); // 12s timeout

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        success: false,
        error: `embedding_api_error: ${response.status} - ${errorText.slice(0, 200)}`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const data = await response.json();
    const values = data?.embedding?.values;

    if (!Array.isArray(values) || values.length === 0) {
      return {
        success: false,
        error: 'invalid_embedding_response_structure',
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    return {
      success: true,
      embedding: values as number[],
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      success: false,
      error: isAbort ? 'embedding_request_timeout' : 'embedding_network_error',
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
