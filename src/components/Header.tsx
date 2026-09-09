interface HeaderProps {
  totalCount: number;
}

export function Header({ totalCount }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="brand-badge">
          <span className="brand-dot" aria-hidden="true"></span>
          Family Inventory
        </div>
        <span className="demo-badge">Dữ liệu minh họa</span>
      </div>

      <div className="header-main">
        <h1 className="header-title">Hàng hóa gia đình</h1>
        <div className="header-stat">
          <span className="stat-label">Tổng danh mục:</span>
          <strong className="stat-number">{totalCount}</strong>
          <span className="stat-unit">sản phẩm</span>
        </div>
      </div>
    </header>
  );
}
