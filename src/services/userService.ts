// Service xử lý quản lý thông tin tài khoản người dùng và đổi mật khẩu
import { supabase } from '../lib/supabase';
import type { FamilyMember } from '../types/database';

export interface UpdateProfileResult {
  success: boolean;
  member?: FamilyMember;
  error?: string;
}

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Cập nhật tên hiển thị và số điện thoại của người dùng hiện tại
 */
export async function updateUserProfile(
  displayName: string,
  phone: string | null
): Promise<UpdateProfileResult> {
  if (!supabase) {
    return { success: false, error: 'Chưa cấu hình Supabase Client.' };
  }

  const trimmedName = displayName.trim();
  if (trimmedName.length < 2 || trimmedName.length > 60) {
    return { success: false, error: 'Tên hiển thị phải có độ dài từ 2 đến 60 ký tự.' };
  }

  const trimmedPhone = phone ? phone.trim() : null;
  if (trimmedPhone) {
    const phoneRegex = /^[+0-9][0-9\s.-]{7,19}$/;
    if (!phoneRegex.test(trimmedPhone)) {
      return { success: false, error: 'Số điện thoại không đúng định dạng (8-20 ký tự số).' };
    }
  }

  try {
    // 1. Gọi RPC update_own_profile trên Supabase
    const { data, error } = await supabase.rpc('update_own_profile', {
      p_display_name: trimmedName,
      p_phone: trimmedPhone || null,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Lỗi khi cập nhật thông tin cá nhân trên máy chủ.',
      };
    }

    const res = data as {
      success?: boolean;
      user_id?: string;
      display_name?: string;
      phone?: string | null;
      can_edit?: boolean;
      is_active?: boolean;
      created_at?: string;
    };

    if (!res || !res.success) {
      return { success: false, error: 'Không thể cập nhật hồ sơ người dùng.' };
    }

    // 2. Đồng bộ user_metadata trên Supabase Auth (best effort)
    void supabase.auth.updateUser({
      data: {
        display_name: trimmedName,
        phone_number: trimmedPhone || null,
      },
    });

    const updatedMember: FamilyMember = {
      user_id: res.user_id || '',
      display_name: res.display_name || trimmedName,
      phone: res.phone || null,
      can_edit: Boolean(res.can_edit),
      is_active: Boolean(res.is_active),
      created_at: res.created_at || new Date().toISOString(),
    };

    return { success: true, member: updatedMember };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Lỗi kết nối khi cập nhật hồ sơ.',
    };
  }
}

/**
 * Đổi mật khẩu tài khoản:
 * - Xác minh lại mật khẩu cũ trước khi cho phép đổi
 * - Cập nhật mật khẩu mới qua Supabase Auth API
 */
export async function changeUserPassword(
  currentPassword: string,
  newPassword: string,
  email: string
): Promise<ChangePasswordResult> {
  if (!supabase) {
    return { success: false, error: 'Chưa cấu hình Supabase Client.' };
  }

  if (!currentPassword) {
    return { success: false, error: 'Vui lòng nhập mật khẩu hiện tại.' };
  }

  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' };
  }

  if (currentPassword === newPassword) {
    return { success: false, error: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.' };
  }

  try {
    // 1. Xác thực lại mật khẩu hiện tại
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyErr) {
      const msg = verifyErr.message.toLowerCase();
      if (msg.includes('invalid') || msg.includes('grant') || msg.includes('credential')) {
        return { success: false, error: 'Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại.' };
      }
      return { success: false, error: `Xác thực mật khẩu hiện tại thất bại: ${verifyErr.message}` };
    }

    // 2. Cập nhật sang mật khẩu mới
    const { error: updateErr } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateErr) {
      return { success: false, error: `Đổi mật khẩu thất bại: ${updateErr.message}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Lỗi mạng khi thực hiện đổi mật khẩu.',
    };
  }
}
