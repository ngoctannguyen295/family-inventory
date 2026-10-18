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
  cartCount?: number;
  onOpenCheckout?: () => void;
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
  cartCount = 0,
  onOpenCheckout,
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
            <img src="/pwa-192x192.png" alt="Logo" className="brand-avatar-img" />
            <span className="brand-name">Quản lý hàng hoá</span>
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
          <h1 className="header-title">Quản lý hàng hoá</h1>
          <div className="header-stat">
            <span className="stat-label">Tổng số:</span>
            <strong className="stat-number">{totalCount}</strong>
            <span className="stat-unit">mặt hàng</span>
          </div>
        </div>

        <div className="header-actions-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onOpenCheckout && (
            <button
              type="button"
              className="btn-open-checkout"
              onClick={onOpenCheckout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                height: '42px',
                padding: '0 16px',
                borderRadius: '10px',
                background: cartCount > 0 ? '#16a34a' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
                boxShadow: cartCount > 0 ? '0 2px 8px rgba(22, 163, 74, 0.35)' : '0 2px 6px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.15s ease',
              }}
              title="Mở máy tính tiền / Đơn bán hàng"
              aria-label={`Mở máy tính tiền, hiện có ${cartCount} sản phẩm trong đơn`}
            >
              <span style={{ fontSize: '18px' }} aria-hidden="true">🧮</span>
              <span>Tính tiền</span>
              {cartCount > 0 && (
                <span
                  style={{
                    background: '#ffffff',
                    color: '#16a34a',
                    padding: '1px 8px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  {cartCount}
                </span>
              )}
            </button>
          )}

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
      </div>
    </header>
  );
}

export default Header;
