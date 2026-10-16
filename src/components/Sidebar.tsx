import { useEffect } from 'react';
import type { FamilyMember } from '../types/database';
import './Sidebar.css';

interface SidebarProps {
  currentView: 'inventory' | 'profile';
  totalProducts: number;
  deletedCount: number;
  member: FamilyMember | null;
  canEdit: boolean;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onNavigateInventory: () => void;
  onNavigateProfile: () => void;
  onOpenStockIn: () => void;
  onOpenAddNewProduct: () => void;
  onOpenImageSearch: () => void;
  onOpenBarcodeScanner: () => void;
  onOpenTrash: () => void;
  onSignOut: () => void;
  isSigningOut?: boolean;
}

export function Sidebar({
  currentView,
  totalProducts,
  deletedCount,
  member,
  canEdit,
  isOpenMobile,
  onCloseMobile,
  onNavigateInventory,
  onNavigateProfile,
  onOpenStockIn,
  onOpenAddNewProduct,
  onOpenImageSearch,
  onOpenBarcodeScanner,
  onOpenTrash,
  onSignOut,
  isSigningOut,
}: SidebarProps) {
  // Khóa cuộn trang khi mở menu di động & hỗ trợ phím Escape
  useEffect(() => {
    if (!isOpenMobile) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpenMobile, onCloseMobile]);

  const handleNavClick = (callback: () => void) => {
    callback();
    onCloseMobile();
  };

  return (
    <>
      {/* Lớp phủ mờ trên di động khi mở sidebar */}
      <div
        className={`sidebar-mobile-backdrop ${isOpenMobile ? 'open-mobile' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      {/* Khung Sidebar chính */}
      <aside
        className={`app-sidebar ${isOpenMobile ? 'open-mobile' : ''}`}
        aria-label="Thanh điều hướng chính"
      >
        {/* Logo & Tiêu đề ứng dụng */}
        <div className="sidebar-brand-box">
          <button
            type="button"
            className="sidebar-brand-link"
            onClick={() => handleNavClick(onNavigateInventory)}
            title="Về trang chủ danh sách kho hàng"
          >
            <div className="sidebar-brand-logo-icon" aria-hidden="true">
              📦
            </div>
            <div className="sidebar-brand-text-group">
              <span className="sidebar-brand-title">Kho Gia Đình</span>
              <span className="sidebar-brand-subtitle">Quản lý & Tồn kho</span>
            </div>
          </button>

          <button
            type="button"
            className="sidebar-close-mobile-btn"
            onClick={onCloseMobile}
            aria-label="Đóng thanh menu"
          >
            ✕
          </button>
        </div>

        {/* Danh sách các mục điều hướng */}
        <nav className="sidebar-nav-container">
          {/* NHÓM 1: QUẢN LÝ KHO */}
          <div className="sidebar-nav-group">
            <h3 className="sidebar-group-title">Quản lý kho</h3>

            {/* Mục: Danh sách mặt hàng */}
            <button
              type="button"
              className={`sidebar-nav-item ${currentView === 'inventory' ? 'active' : ''}`}
              onClick={() => handleNavClick(onNavigateInventory)}
            >
              <div className="sidebar-nav-item-left">
                <span className="sidebar-item-icon" aria-hidden="true">
                  📋
                </span>
                <span>Danh sách mặt hàng</span>
              </div>
              <span className="sidebar-badge sidebar-badge-count">{totalProducts}</span>
            </button>

            {/* Mục 1: Nhập kho (Chỉnh số lượng & giá sản phẩm có sẵn) */}
            {canEdit && (
              <button
                type="button"
                className="sidebar-nav-item"
                onClick={() => handleNavClick(onOpenStockIn)}
                title="Nhập thêm số lượng và chỉnh sửa giá cho mặt hàng đã có sẵn"
              >
                <div className="sidebar-nav-item-left">
                  <span className="sidebar-item-icon" aria-hidden="true">
                    📥
                  </span>
                  <span>Nhập kho</span>
                </div>
                <span className="sidebar-badge sidebar-badge-stock">Kho</span>
              </button>
            )}

            {/* Mục 2: Thêm mới (Thêm sản phẩm chưa có trong danh mục) */}
            {canEdit && (
              <button
                type="button"
                className="sidebar-nav-item"
                onClick={() => handleNavClick(onOpenAddNewProduct)}
                title="Thêm sản phẩm mới chưa có trong danh mục hàng hóa"
              >
                <div className="sidebar-nav-item-left">
                  <span className="sidebar-item-icon" aria-hidden="true">
                    ✨
                  </span>
                  <span>Thêm mới</span>
                </div>
                <span className="sidebar-badge sidebar-badge-action">＋</span>
              </button>
            )}

            {/* Mục: Hàng đã xóa / Thùng rác */}
            <button
              type="button"
              className="sidebar-nav-item"
              onClick={() => handleNavClick(onOpenTrash)}
            >
              <div className="sidebar-nav-item-left">
                <span className="sidebar-item-icon" aria-hidden="true">
                  🗑️
                </span>
                <span>Thùng rác</span>
              </div>
              {deletedCount > 0 && (
                <span className="sidebar-badge sidebar-badge-trash">{deletedCount}</span>
              )}
            </button>
          </div>

          {/* NHÓM 2: CÔNG CỤ TÌM KIẾM THÔNG MINH */}
          <div className="sidebar-nav-group">
            <h3 className="sidebar-group-title">Công cụ tra cứu</h3>

            {/* Mục: Tìm bằng ảnh AI */}
            <button
              type="button"
              className="sidebar-nav-item"
              onClick={() => handleNavClick(onOpenImageSearch)}
            >
              <div className="sidebar-nav-item-left">
                <span className="sidebar-item-icon" aria-hidden="true">
                  📷
                </span>
                <span>Tìm bằng ảnh AI</span>
              </div>
              <span className="sidebar-badge sidebar-badge-ai">AI</span>
            </button>

            {/* Mục: Quét mã vạch */}
            <button
              type="button"
              className="sidebar-nav-item"
              onClick={() => handleNavClick(onOpenBarcodeScanner)}
            >
              <div className="sidebar-nav-item-left">
                <span className="sidebar-item-icon" aria-hidden="true">
                  🔍
                </span>
                <span>Quét mã vạch</span>
              </div>
            </button>
          </div>

          {/* NHÓM 3: HỆ THỐNG */}
          <div className="sidebar-nav-group">
            <h3 className="sidebar-group-title">Tài khoản & Hệ thống</h3>

            {/* Mục: Cài đặt & Thông tin cá nhân */}
            <button
              type="button"
              className={`sidebar-nav-item ${currentView === 'profile' ? 'active' : ''}`}
              onClick={() => handleNavClick(onNavigateProfile)}
            >
              <div className="sidebar-nav-item-left">
                <span className="sidebar-item-icon" aria-hidden="true">
                  ⚙️
                </span>
                <span>Cài đặt & Hồ sơ</span>
              </div>
            </button>
          </div>
        </nav>

        {/* Chân Sidebar: Thông tin tài khoản & Nút đăng xuất nhanh */}
        {member && (
          <div className="sidebar-footer">
            <div
              className="sidebar-user-card"
              onClick={() => handleNavClick(onNavigateProfile)}
              title="Nhấn để mở cài đặt thông tin cá nhân và đổi mật khẩu"
            >
              <div className="sidebar-user-left">
                <div className="sidebar-user-avatar" aria-hidden="true">
                  {member.display_name ? member.display_name.charAt(0).toUpperCase() : '👤'}
                </div>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{member.display_name}</span>
                  <span className="sidebar-user-role">
                    {member.can_edit ? 'Được sửa kho' : 'Chỉ xem'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="sidebar-quick-logout-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onSignOut();
                }}
                disabled={isSigningOut}
                title="Đăng xuất khỏi tài khoản"
                aria-label="Đăng xuất"
              >
                🚪
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

export default Sidebar;
