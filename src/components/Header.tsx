import type { FamilyMember } from '../types/database';

interface HeaderProps {
  totalCount: number;
  member: FamilyMember | null;
  onSignOut: () => void;
  isSigningOut?: boolean;
  onOpenAddModal?: () => void;
  addBtnRef?: React.RefObject<HTMLButtonElement | null>;
}

export function Header({
  totalCount,
  member,
  onSignOut,
  isSigningOut,
  onOpenAddModal,
  addBtnRef,
}: HeaderProps) {
  const canEdit = Boolean(member?.is_active && member?.can_edit);

  return (
    <header className="app-header">
      <div className="header-top">
        <div className="brand-badge">
          <span className="brand-dot" aria-hidden="true"></span>
          Family Inventory
        </div>

        {member && (
          <div className="user-profile-bar">
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
          <h1 className="header-title">Hàng hóa gia đình</h1>
          <div className="header-stat">
            <span className="stat-label">Tổng danh mục:</span>
            <strong className="stat-number">{totalCount}</strong>
            <span className="stat-unit">sản phẩm</span>
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
            Thêm sản phẩm
          </button>
        )}
      </div>
    </header>
  );
}
