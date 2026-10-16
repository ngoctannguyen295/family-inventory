import { useState, useMemo, type FormEvent } from 'react';
import type { FamilyMember } from '../types/database';
import { updateUserProfile, changeUserPassword } from '../services/userService';
import './UserProfilePage.css';

interface UserProfilePageProps {
  member: FamilyMember;
  userEmail?: string;
  onBackToHome: () => void;
  onProfileUpdated: (updatedMember: FamilyMember) => void;
  onSignOut: () => void;
  isSigningOut?: boolean;
  onShowToast?: (notification: { text: string; type: 'success' | 'warning' | 'info' }) => void;
}

export function UserProfilePage({
  member,
  userEmail,
  onBackToHome,
  onProfileUpdated,
  onSignOut,
  isSigningOut,
  onShowToast,
}: UserProfilePageProps) {
  // Form profile state
  const [displayName, setDisplayName] = useState(member.display_name || '');
  const [phone, setPhone] = useState(member.phone || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Form password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Đánh giá độ mạnh mật khẩu mới
  const passwordStrength = useMemo(() => {
    if (!newPassword) return null;
    let score = 0;
    if (newPassword.length >= 6) score++;
    if (newPassword.length >= 8) score++;
    if (/[A-Z]/.test(newPassword) || /[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;

    if (score <= 1) return { label: 'Yếu (nên dài hơn)', level: 'weak' as const };
    if (score <= 3) return { label: 'Trung bình', level: 'medium' as const };
    return { label: 'Mạnh (rất an toàn)', level: 'strong' as const };
  }, [newPassword]);

  // Format ngày tạo
  const formattedCreatedDate = useMemo(() => {
    if (!member.created_at) return 'Đang cập nhật';
    try {
      const d = new Date(member.created_at);
      return d.toLocaleDateString('vi-VN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return member.created_at;
    }
  }, [member.created_at]);

  // 1. Lưu thông tin cá nhân
  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setProfileError('Tên hiển thị không được để trống.');
      return;
    }
    if (trimmedName.length < 2) {
      setProfileError('Tên hiển thị phải có ít nhất 2 ký tự.');
      return;
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone) {
      const phoneRegex = /^[+0-9][0-9\s.-]{7,19}$/;
      if (!phoneRegex.test(trimmedPhone)) {
        setProfileError('Số điện thoại không đúng định dạng (8-20 ký tự số).');
        return;
      }
    }

    setIsSavingProfile(true);
    const res = await updateUserProfile(trimmedName, trimmedPhone || null);
    setIsSavingProfile(false);

    if (!res.success || !res.member) {
      setProfileError(res.error || 'Cập nhật thất bại. Vui lòng thử lại.');
      return;
    }

    setProfileSuccess('Đã lưu và cập nhật thông tin cá nhân thành công!');
    onProfileUpdated(res.member);
    if (onShowToast) {
      onShowToast({
        text: 'Cập nhật thông tin tài khoản thành công.',
        type: 'success',
      });
    }
  };

  // 2. Đổi mật khẩu
  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Mật khẩu xác nhận không khớp với mật khẩu mới.');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('Mật khẩu mới không được trùng với mật khẩu hiện tại.');
      return;
    }
    if (!userEmail) {
      setPasswordError('Không tìm thấy địa chỉ email tài khoản để xác thực.');
      return;
    }

    setIsChangingPassword(true);
    const res = await changeUserPassword(currentPassword, newPassword, userEmail);
    setIsChangingPassword(false);

    if (!res.success) {
      setPasswordError(res.error || 'Đổi mật khẩu thất bại. Vui lòng thử lại.');
      return;
    }

    setPasswordSuccess('Đổi mật khẩu thành công! Mật khẩu mới đã có hiệu lực.');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    if (onShowToast) {
      onShowToast({
        text: 'Đổi mật khẩu tài khoản thành công.',
        type: 'success',
      });
    }
  };

  return (
    <div className="profile-page-container">
      <div className="profile-page-inner">
        {/* Thanh điều hướng quay lại & Đăng xuất */}
        <nav className="profile-top-navbar" aria-label="Điều hướng hồ sơ">
          <button
            type="button"
            className="btn-back-to-home"
            onClick={onBackToHome}
            aria-label="Quay lại danh sách kho hàng"
          >
            <span className="back-icon" aria-hidden="true">←</span>
            <span>Quay lại trang chủ</span>
          </button>

          <div className="profile-top-actions">
            <button
              type="button"
              className="signout-button"
              onClick={onSignOut}
              disabled={isSigningOut}
              aria-label="Đăng xuất khỏi hệ thống"
            >
              {isSigningOut ? 'Đang xuất...' : 'Đăng xuất'}
            </button>
          </div>
        </nav>

        {/* Tiêu đề trang Hero */}
        <header className="profile-hero-header">
          <div className="profile-breadcrumb">
            <span>Kho gia đình</span>
            <span aria-hidden="true">/</span>
            <span>Cài đặt tài khoản & Hồ sơ</span>
          </div>
          <h1 className="profile-hero-title">Cài đặt thông tin cá nhân</h1>
          <p className="profile-hero-subtitle">
            Cập nhật tên hiển thị, số điện thoại liên lạc kiểm kê và quản lý mật khẩu bảo mật của bạn.
          </p>
        </header>

        {/* Bố cục 2 cột chuyên nghiệp */}
        <div className="profile-layout-grid">
          {/* CỘT TRÁI: Thẻ tổng quan người dùng */}
          <aside className="profile-summary-card" aria-label="Tổng quan người dùng">
            <div className="profile-avatar-large">
              <div className="profile-avatar-inner" aria-hidden="true">
                {member.display_name ? member.display_name.charAt(0).toUpperCase() : '👤'}
              </div>
            </div>

            <h2 className="profile-summary-name">{member.display_name}</h2>
            <p className="profile-summary-email">{userEmail || 'Chưa có email'}</p>

            <span
              className={`profile-summary-role-tag ${
                member.can_edit ? 'role-tag-editor' : 'role-tag-viewer'
              }`}
            >
              <span aria-hidden="true">{member.can_edit ? '🛡️' : '👁️'}</span>
              <span>{member.can_edit ? 'Được chỉnh sửa kho' : 'Thành viên chỉ xem'}</span>
            </span>

            <div className="profile-quick-details">
              <div className="quick-detail-item">
                <span className="quick-detail-label">Số điện thoại:</span>
                <span className="quick-detail-value">{member.phone || 'Chưa cập nhật'}</span>
              </div>
              <div className="quick-detail-item">
                <span className="quick-detail-label">Trạng thái:</span>
                <span className="quick-detail-value" style={{ color: '#16a34a' }}>● Hoạt động</span>
              </div>
              <div className="quick-detail-item">
                <span className="quick-detail-label">Ngày tham gia:</span>
                <span className="quick-detail-value">{formattedCreatedDate}</span>
              </div>
            </div>
          </aside>

          {/* CỘT PHẢI: Các khung nhập liệu chi tiết */}
          <main className="profile-main-column">
            {/* KHUNG 1: THÔNG TIN CÁ NHÂN */}
            <section className="profile-card-section" aria-labelledby="personal-info-heading">
              <div className="card-section-header">
                <div className="card-header-icon" aria-hidden="true">
                  👤
                </div>
                <div>
                  <h2 id="personal-info-heading" className="card-header-title">
                    Thông tin tài khoản
                  </h2>
                  <p className="card-header-desc">
                    Tên hiển thị và số điện thoại được dùng để phân biệt các thành viên trong gia đình khi kiểm kho.
                  </p>
                </div>
              </div>

              <div className="card-section-body">
                <form onSubmit={handleSaveProfile} className="profile-form-grid">
                  {profileError && (
                    <div className="profile-msg-alert alert-type-error" role="alert">
                      <span className="alert-icon-lg" aria-hidden="true">⚠️</span>
                      <span>{profileError}</span>
                    </div>
                  )}

                  {profileSuccess && (
                    <div className="profile-msg-alert alert-type-success" role="status">
                      <span className="alert-icon-lg" aria-hidden="true">✅</span>
                      <span>{profileSuccess}</span>
                    </div>
                  )}

                  {/* Email (Readonly) */}
                  <div className="form-group-custom">
                    <label htmlFor="field-email" className="form-label-custom">
                      <span>Địa chỉ Email</span>
                      <span className="label-hint">Tài khoản đăng nhập</span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">✉️</span>
                      <input
                        id="field-email"
                        type="email"
                        value={userEmail || ''}
                        disabled
                        className="custom-input"
                        title="Email đăng nhập cố định của tài khoản"
                      />
                      <span className="input-tag-badge">Đã xác minh</span>
                    </div>
                    <span className="custom-helper-text">
                      Email được dùng làm tên tài khoản cố định để đăng nhập vào hệ thống.
                    </span>
                  </div>

                  {/* Tên hiển thị */}
                  <div className="form-group-custom">
                    <label htmlFor="field-display-name" className="form-label-custom">
                      <span>Tên hiển thị <span className="required-badge">*</span></span>
                      <span className="label-hint">{displayName.length}/60</span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">👤</span>
                      <input
                        id="field-display-name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Nhập họ và tên hoặc biệt danh..."
                        className="custom-input"
                        maxLength={60}
                        required
                        disabled={isSavingProfile}
                      />
                    </div>
                    <span className="custom-helper-text">
                      Tên sẽ hiển thị ở góc màn hình, lịch sử cập nhật số lượng tồn và phiếu kho.
                    </span>
                  </div>

                  {/* Số điện thoại */}
                  <div className="form-group-custom">
                    <label htmlFor="field-phone" className="form-label-custom">
                      <span>Số điện thoại liên hệ</span>
                      <span className="label-hint">Không bắt buộc</span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">📞</span>
                      <input
                        id="field-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Ví dụ: 0912 345 678 hoặc +84 912 345 678"
                        className="custom-input"
                        maxLength={20}
                        disabled={isSavingProfile}
                      />
                    </div>
                    <span className="custom-helper-text">
                      Giúp các thành viên trong gia đình gọi điện hoặc nhắn tin nhanh khi kiểm kê hàng.
                    </span>
                  </div>

                  {/* Nút hành động */}
                  <div className="card-section-actions">
                    <button
                      type="submit"
                      className="btn-primary-gradient"
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? (
                        <>
                          <span className="loading-spinner-small" aria-hidden="true"></span>
                          <span>Đang lưu thông tin...</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">💾</span>
                          <span>Lưu thông tin</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* KHUNG 2: ĐỔI MẬT KHẨU */}
            <section className="profile-card-section" aria-labelledby="security-heading">
              <div className="card-section-header">
                <div className="card-header-icon security" aria-hidden="true">
                  🔒
                </div>
                <div>
                  <h2 id="security-heading" className="card-header-title">
                    Đổi mật khẩu tài khoản
                  </h2>
                  <p className="card-header-desc">
                    Để đảm bảo an toàn cho kho hàng, hãy sử dụng mật khẩu mạnh kết hợp chữ, số và ký tự đặc biệt.
                  </p>
                </div>
              </div>

              <div className="card-section-body">
                <form onSubmit={handleChangePassword} className="profile-form-grid">
                  {passwordError && (
                    <div className="profile-msg-alert alert-type-error" role="alert">
                      <span className="alert-icon-lg" aria-hidden="true">⚠️</span>
                      <span>{passwordError}</span>
                    </div>
                  )}

                  {passwordSuccess && (
                    <div className="profile-msg-alert alert-type-success" role="status">
                      <span className="alert-icon-lg" aria-hidden="true">✅</span>
                      <span>{passwordSuccess}</span>
                    </div>
                  )}

                  {/* Mật khẩu hiện tại */}
                  <div className="form-group-custom">
                    <label htmlFor="field-current-password" className="form-label-custom">
                      <span>Mật khẩu hiện tại <span className="required-badge">*</span></span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">🔑</span>
                      <input
                        id="field-current-password"
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Nhập mật khẩu đang sử dụng"
                        className="custom-input with-suffix"
                        required
                        disabled={isChangingPassword}
                      />
                      <button
                        type="button"
                        className="input-suffix-btn"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        aria-label={showCurrentPassword ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
                      >
                        {showCurrentPassword ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                  </div>

                  {/* Mật khẩu mới */}
                  <div className="form-group-custom">
                    <label htmlFor="field-new-password" className="form-label-custom">
                      <span>Mật khẩu mới <span className="required-badge">*</span></span>
                      <span className="label-hint">Tối thiểu 6 ký tự</span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">🔒</span>
                      <input
                        id="field-new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Nhập mật khẩu mới an toàn"
                        className="custom-input with-suffix"
                        minLength={6}
                        required
                        disabled={isChangingPassword}
                      />
                      <button
                        type="button"
                        className="input-suffix-btn"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={showNewPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                      >
                        {showNewPassword ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>

                    {/* Thước đo độ mạnh mật khẩu */}
                    {passwordStrength && (
                      <div className="password-strength-container" aria-live="polite">
                        <div className="password-strength-label">
                          <span style={{ color: '#64748b' }}>Độ bảo mật:</span>
                          <span className={`text-${passwordStrength.level}`}>
                            {passwordStrength.label}
                          </span>
                        </div>
                        <div className="password-meter-bar-track">
                          <div className={`password-meter-fill strength-${passwordStrength.level}`} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Xác nhận mật khẩu mới */}
                  <div className="form-group-custom">
                    <label htmlFor="field-confirm-password" className="form-label-custom">
                      <span>Xác nhận mật khẩu mới <span className="required-badge">*</span></span>
                    </label>
                    <div className="input-field-wrapper">
                      <span className="input-prefix-icon" aria-hidden="true">🛡️</span>
                      <input
                        id="field-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Nhập lại mật khẩu mới vừa đặt"
                        className="custom-input with-suffix"
                        minLength={6}
                        required
                        disabled={isChangingPassword}
                      />
                      <button
                        type="button"
                        className="input-suffix-btn"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        aria-label={showConfirmPassword ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
                      >
                        {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                  </div>

                  {/* Nút đổi mật khẩu */}
                  <div className="card-section-actions">
                    <button
                      type="submit"
                      className="btn-primary-gradient btn-danger-gradient"
                      disabled={isChangingPassword}
                    >
                      {isChangingPassword ? (
                        <>
                          <span className="loading-spinner-small" aria-hidden="true"></span>
                          <span>Đang cập nhật mật khẩu...</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">🔐</span>
                          <span>Cập nhật mật khẩu</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

export default UserProfilePage;
