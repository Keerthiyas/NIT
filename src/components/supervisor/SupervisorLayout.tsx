import { useState, type ReactNode } from 'react';
import {
  Boxes,
  ClipboardCheck,
  Factory,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import type { AuthUser, SupervisorNavSection } from '../../types/orderAudit';

interface NavItem {
  id: SupervisorNavSection;
  label: string;
  icon: typeof LayoutDashboard;
}

const SUPERVISOR_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'requests', label: 'Production Requests', icon: ClipboardCheck },
  { id: 'inventory', label: 'Material Inventory', icon: Boxes },
  { id: 'execution', label: 'Production Execution', icon: Factory },
  { id: 'history', label: 'Production History', icon: History },
];

interface SupervisorLayoutProps {
  activeSection: SupervisorNavSection;
  onNavigate: (section: SupervisorNavSection) => void;
  currentUser: AuthUser;
  onLogout: () => void;
  actionableRequestsCount: number;
  children: ReactNode;
}

export function SupervisorLayout({
  activeSection,
  onNavigate,
  currentUser,
  onLogout,
  actionableRequestsCount,
  children,
}: SupervisorLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeTitle =
    SUPERVISOR_NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? 'Dashboard';

  const handleSelect = (section: SupervisorNavSection) => {
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
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">
              NIT Trichy
            </p>
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              Production Supervisor
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
        >
          <LogOut className="h-3 w-3" />
          Sign Out
        </button>
      </div>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Compact Sidebar — Strictly 5 Primary Navigation Items */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
              NIT Trichy
            </p>
            <p className="text-sm font-semibold text-slate-900">
              Production Desk
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

        <nav aria-label="Production Supervisor navigation" className="flex-1 px-2.5 py-3 space-y-1">
          {SUPERVISOR_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-950 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-blue-200' : 'text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </span>
                {item.id === 'requests' && actionableRequestsCount > 0 && (
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                      isActive
                        ? 'bg-blue-800 text-blue-100'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {actionableRequestsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-3.5 py-3 bg-slate-50/70 space-y-2">
          <div>
            <p className="text-xs font-semibold text-slate-800 truncate">{currentUser.fullName}</p>
            <p className="text-[11px] text-slate-500 truncate">{currentUser.email}</p>
            <p className="text-[10px] font-medium text-blue-800 mt-0.5">
              Production Supervisor
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="hidden lg:flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-slate-900">{activeTitle}</h1>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">
              NIT Trichy Order-to-Audit · Production & Inventory Control
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-800">
            Shared Central Inventory Connected
          </span>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
