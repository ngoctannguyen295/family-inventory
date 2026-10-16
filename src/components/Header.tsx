import type { FamilyMember } from '../types/database';

interface HeaderProps {
  totalCount: number;
  member: FamilyMember | null;
  onSignOut: () => void;
  isSigningOut?: boolean;
  onOpenAddModal?: () => void;
  addBtnRef?: React.RefObject<HTMLButtonElement | null>;
  onOpenProfile?: (triggerEl: HTMLElement) => void;
  profileTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  onToggleMobileMenu?: () => void;
}

export function Header({
  totalCount,
  member,
  onSignOut,
  isSigningOut,
  onOpenAddModal,
  addBtnRef,
  onOpenProfile,
  profileTriggerRef,
  onToggleMobileMenu,
}: HeaderProps) {
  const canEdit = Boolean(member?.is_active && member?.can_edit);

  return (
    <header className="app-header">
      <div className="header-top">
        <div className="header-top-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {onToggleMobileMenu && (
            <button
              type="button"
              className="btn-toggle-menu-mobile"
              onClick={onToggleMobileMenu}
              aria-label="Mở thanh menu bên trái"
              title="Mở menu"
            >
              ☰
            </button>
          )}
          <div className="brand-badge">
            <span className="brand-dot" aria-hidden="true"></span>
            <span className="brand-name">Kho gia đình</span>
          </div>
        </div>

        {member && (
          <div className="user-profile-bar">
            <button
              ref={profileTriggerRef}
              type="button"
              className="user-profile-btn"
              onClick={(e) => onOpenProfile?.(e.currentTarget)}
              aria-label="Xem và chỉnh sửa thông tin cá nhân, đổi mật khẩu"
              title="Chỉnh sửa thông tin cá nhân, số điện thoại, đổi mật khẩu"
            >
              <span className="user-avatar-circle" aria-hidden="true">
                {member.display_name ? member.display_name.charAt(0).toUpperCase() : '👤'}
              </span>
              <div className="user-info-text">
                <span className="user-display-name">{member.display_name}</span>
                <span
                  className={`user-role-badge ${
                    member.can_edit ? 'role-editor' : 'role-viewer'
                  }`}
                  title="Quyền thực sự do chính sách RLS tại máy chủ quản lý"
                >
                  {member.can_edit ? 'Được chỉnh sửa' : 'Chỉ xem'}
                </span>
              </div>
              <span className="profile-edit-icon" aria-hidden="true" title="Chỉnh sửa">⚙️</span>
            </button>
            <button
              type="button"
              className="signout-button"
              onClick={onSignOut}
              disabled={isSigningOut}
              aria-label="Đăng xuất khỏi ứng dụng"
              title="Đăng xuất"
            >
              {isSigningOut ? 'Đang xuất...' : 'Đăng xuất'}
            </button>
          </div>
        )}
      </div>

      <div className="header-main">
        <div className="header-title-group">
          <h1 className="header-title">Kho gia đình</h1>
          <div className="header-stat">
            <span className="stat-label">Tổng số:</span>
            <strong className="stat-number">{totalCount}</strong>
            <span className="stat-unit">mặt hàng</span>
          </div>
        </div>

        {canEdit && onOpenAddModal && (
          <button
            ref={addBtnRef}
            type="button"
            className="btn-add-product"
            onClick={onOpenAddModal}
            aria-label="Thêm sản phẩm mới vào kho hàng"
          >
            <span className="btn-add-icon" aria-hidden="true">＋</span>
            <span>Thêm sản phẩm</span>
          </button>
        )}
      </div>
    </header>
  );
}

export default Header;
