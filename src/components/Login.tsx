import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import './Login.css';

interface LoginProps {
  onLoginSuccess?: () => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        // Thông báo an toàn, không tiết lộ email có tồn tại trên hệ thống hay không
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
          setErrorMessage('Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.');
        } else if (msg.includes('too many') || msg.includes('rate limit')) {
          setErrorMessage('Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.');
        } else if (msg.includes('fetch') || msg.includes('network')) {
          setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng của bạn.');
        } else {
          setErrorMessage('Đăng nhập không thành công. Vui lòng thử lại.');
        }
        setIsSubmitting(false);
        return;
      }

      // Đăng nhập thành công
      if (onLoginSuccess) {
        onLoginSuccess();
      }
    } catch {
      setErrorMessage('Đã xảy ra lỗi không xác định khi kết nối. Vui lòng thử lại.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-auth-card">
        {/* Header với ảnh đại diện nổi bật & Tên ứng dụng */}
        <div className="login-brand-header">
          <div className="login-avatar-ring">
            <img src="/pwa-192x192.png" alt="Ảnh đại diện ứng dụng" className="login-avatar-img" />
          </div>
          <h1 className="login-app-title">Quản lý hàng hoá</h1>
          <p className="login-app-subtitle">Đăng nhập tài khoản để vào hệ thống</p>
        </div>

        {errorMessage && (
          <div className="login-alert-box" role="alert" aria-live="assertive">
            <svg
              className="login-alert-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        <form className="login-auth-form" onSubmit={handleSubmit} noValidate>
          {/* Ô nhập Email */}
          <div className="login-field-group">
            <label htmlFor="login-email" className="login-field-label">
              <span>📧</span>
              <span>Địa chỉ Email</span>
            </label>
            <div className="login-field-wrapper">
              <span className="login-leading-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </span>
              <input
                id="login-email"
                type="email"
                className="login-input-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ví dụ: admin@gmail.com"
                required
                autoComplete="email"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Ô nhập Mật khẩu */}
          <div className="login-field-group">
            <label htmlFor="login-password" className="login-field-label">
              <span>🔒</span>
              <span>Mật khẩu</span>
            </label>
            <div className="login-field-wrapper">
              <span className="login-leading-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="login-input-control is-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu của bạn"
                required
                autoComplete="current-password"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="login-password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                tabIndex={0}
                disabled={isSubmitting}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Nút Đăng nhập */}
          <button
            type="submit"
            className="login-submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="login-btn-spinner" aria-hidden="true"></span>
                <span>Đang đăng nhập...</span>
              </>
            ) : (
              <span>Đăng nhập</span>
            )}
          </button>
        </form>

        <div className="login-card-footer">
          <p className="login-footer-hint">
            <span>🛡️</span>
            <span>Hệ thống kho nội bộ • Dành cho thành viên được cấp quyền</span>
          </p>
        </div>
      </div>
    </div>
  );
}
