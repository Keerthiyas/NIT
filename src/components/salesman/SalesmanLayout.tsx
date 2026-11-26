import { useState, type ReactNode } from 'react';
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  ShoppingBag,
  X,
} from 'lucide-react';
import type { AuthUser, SalesmanNavSection } from '../../types/orderAudit';

interface SalesmanNavItem {
  id: SalesmanNavSection;
  label: string;
  icon: typeof LayoutDashboard;
}

const SALESMAN_NAV_ITEMS: SalesmanNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'new-order', label: 'New Order', icon: ShoppingBag },
  { id: 'my-orders', label: 'My Orders', icon: ClipboardList },
];

interface SalesmanLayoutProps {
  activeSection: SalesmanNavSection;
  onNavigate: (section: SalesmanNavSection) => void;
  currentUser: AuthUser;
  onLogout: () => void;
  cartItemCount: number;
  children: ReactNode;
}

export function SalesmanLayout({
  activeSection,
  onNavigate,
  currentUser,
  onLogout,
  cartItemCount,
  children,
}: SalesmanLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeTitle =
    SALESMAN_NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? 'Dashboard';

  const handleSelect = (section: SalesmanNavSection) => {
    onNavigate(section);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
              NIT Trichy Sales
            </p>
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              {activeTitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Compact Salesman Sidebar — Strictly 3 Items */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
              NIT Trichy
            </p>
            <p className="text-sm font-semibold text-slate-900">
              Salesman Portal
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Salesman navigation" className="flex-1 px-2.5 py-3 space-y-1">
          {SALESMAN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-700 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-blue-100' : 'text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </span>
                {item.id === 'new-order' && cartItemCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      isActive
                        ? 'bg-blue-900 text-white'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {cartItemCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-3.5 py-3 space-y-2.5">
          <div>
            <p className="text-xs font-semibold text-slate-800 truncate">
              {currentUser.fullName}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {currentUser.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="hidden lg:flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <h1 className="text-base font-semibold text-slate-900">{activeTitle}</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Signed in as <strong className="text-slate-800">{currentUser.fullName}</strong>
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

