// Authentication & Family Member authorization module
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@^2.49.1';

export interface AuthContext {
  user: User;
  member: {
    display_name: string;
    is_active: boolean;
    can_edit: boolean;
  };
  userClient: SupabaseClient;
}

export interface AuthResult {
  success: boolean;
  status: number;
  error?: string;
  message?: string;
  context?: AuthContext;
}

/**
 * Xác thực Bearer access token qua Supabase Auth và kiểm tra quyền active trong family_members.
 * Sử dụng Supabase Client gắn token của người dùng để mọi truy vấn sau đó đều tuân thủ RLS.
 */
export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      success: false,
      status: 500,
      error: 'server_configuration_error',
      message: 'Thiếu cấu hình máy chủ Supabase URL hoặc Anon Key.',
    };
  }

  // 1. Trích xuất Authorization Bearer Header
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return {
      success: false,
      status: 401,
      error: 'missing_authorization_header',
      message: 'Thiếu hoặc sai định dạng header Authorization Bearer token.',
    };
  }

  const token = authHeader.replace(/^bearer\s+/i, '').trim();
  if (!token) {
    return {
      success: false,
      status: 401,
      error: 'empty_token',
      message: 'Access token không được để trống.',
    };
  }

  // 2. Tạo Supabase client chạy dưới ngữ cảnh quyền hạn của người dùng (giữ RLS)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // 3. Xác thực tính hợp lệ của token trực tiếp với Supabase Auth Server (không chỉ giải mã JWT)
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);

  if (userError || !user) {
    return {
      success: false,
      status: 401,
      error: 'invalid_token',
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
    };
  }

  // 4. Kiểm tra quyền thành viên gia đình trong public.family_members
  const { data: memberData, error: memberError } = await userClient
    .from('family_members')
    .select('display_name, is_active, can_edit')
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberError) {
    return {
      success: false,
      status: 500,
      error: 'database_error',
      message: 'Lỗi khi kiểm tra thông tin thành viên gia đình.',
    };
  }

  // Tài khoản chưa được cấp quyền hoặc đã bị vô hiệu hóa
  if (!memberData || !memberData.is_active) {
    return {
      success: false,
      status: 403,
      error: 'forbidden_inactive_member',
      message: 'Tài khoản chưa được cấp quyền truy cập hoặc đã bị vô hiệu hóa.',
    };
  }

  // Thành viên hợp lệ (bao gồm cả thành viên chỉ xem can_edit = false)
  return {
    success: true,
    status: 200,
    context: {
      user,
      member: memberData,
      userClient,
    },
  };
}
