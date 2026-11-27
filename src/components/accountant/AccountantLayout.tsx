import { useState, type ReactNode } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
} from 'lucide-react';
import type { AccountantNavSection, AuthUser } from '../../types/orderAudit';

interface NavItem {
  id: AccountantNavSection;
  label: string;
  icon: typeof LayoutDashboard;
}

const ACCOUNTANT_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'receivables', label: 'Receivables', icon: Users },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'product-verifications', label: 'Product Tax & Costing', icon: ClipboardCheck },
];

interface AccountantLayoutProps {
  activeSection: AccountantNavSection;
  onNavigate: (section: AccountantNavSection) => void;
  currentUser: AuthUser;
  onLogout: () => void;
  pendingInvoicesCount: number;
  children: ReactNode;
}

export function AccountantLayout({
  activeSection,
  onNavigate,
  currentUser,
  onLogout,
  pendingInvoicesCount,
  children,
}: AccountantLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeTitle =
    ACCOUNTANT_NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? 'Dashboard';

  const handleSelect = (section: AccountantNavSection) => {
    onNavigate(section);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden no-print">
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
              Accountant Desk
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

      {/* Compact Sidebar — Strictly 5 Accountant Sections */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 no-print ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
              NIT Trichy
            </p>
            <p className="text-sm font-semibold text-slate-900">Accountant Desk</p>
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

        <nav aria-label="Accountant navigation" className="flex-1 px-2.5 py-3 space-y-1">
          {ACCOUNTANT_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors cursor-pointer ${
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
                {item.id === 'invoices' && pendingInvoicesCount > 0 && (
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                      isActive
                        ? 'bg-blue-800 text-blue-100'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {pendingInvoicesCount}
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
            <p className="text-[10px] font-medium text-blue-800 mt-0.5">Accountant</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="hidden lg:flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 no-print">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-slate-900">{activeTitle}</h1>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">
              NIT Trichy Order-to-Audit · GST Invoicing &amp; Receivables
            </span>
          </div>
          <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-800">
            Audit-Logged Accounting Ledger
          </span>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
