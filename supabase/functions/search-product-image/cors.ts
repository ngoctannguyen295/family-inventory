// CORS helper for Supabase Edge Function
// Strict allowlist: http://localhost:5173 and ALLOWED_ORIGIN env var

/**
 * Lấy danh sách các Origin được phép truy cập
 */
export function getAllowedOrigins(): string[] {
  const origins = ['http://localhost:5173'];
  let envOrigin: string | undefined;
  try {
    envOrigin = Deno.env.get('ALLOWED_ORIGIN');
  } catch {
    // Không có quyền truy cập env trong một số môi trường kiểm thử
  }
  if (envOrigin) {
    for (const o of envOrigin.split(',')) {
      const trimmed = o.trim();
      if (trimmed && !origins.includes(trimmed)) {
        origins.push(trimmed);
      }
    }
  }
  return origins;
}

/**
 * Kiểm tra xem Origin có nằm trong allowlist hay không
 */
export function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

/**
 * Kiểm tra tính hợp lệ của header Origin.
 * - Nếu không có Origin (như curl, native app): Cho phép đi tiếp (trả về null).
 * - Nếu có Origin nhưng không thuộc allowlist: Trả về HTTP 403 Forbidden trước khi xử lý tiếp.
 */
export function validateOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin');
  if (!origin) {
    return null;
  }

  if (!isOriginAllowed(origin)) {
    return new Response(
      JSON.stringify({
        error: 'origin_not_allowed',
        message: 'Nguồn gốc yêu cầu không được phép (Origin Forbidden).',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Vary': 'Origin',
        },
      }
    );
  }

  return null;
}

/**
 * Tạo các header CORS chuẩn bảo mật với Vary: Origin
 * Không fallback về '*' nếu Origin không nằm trong allowlist.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin');
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/**
 * Xử lý preflight OPTIONS request
 */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const originCheck = validateOrigin(req);
    if (originCheck) {
      return originCheck;
    }

    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(req),
    });
  }
  return null;
}

/**
 * Tạo JSON Response chuẩn kèm theo CORS headers và Vary: Origin
 */
export function jsonResponse(
  body: unknown,
  status = 200,
  req?: Request,
  extraHeaders?: Record<string, string>
): Response {
  const headers = {
    ...getCorsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    ...(extraHeaders || {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}
