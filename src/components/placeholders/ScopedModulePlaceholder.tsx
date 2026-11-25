import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { AdminNavSection } from '../../types/orderAudit';
import { Card } from '../ui/Card';

interface ScopedModulePlaceholderProps {
  section: Exclude<AdminNavSection, 'dashboard' | 'orders'>;
}

const SECTION_DETAILS: Record<
  Exclude<AdminNavSection, 'dashboard' | 'orders'>,
  { title: string; description: string; subsections?: string[] }
> = {
  'production-stock': {
    title: 'Production & Stock',
    description:
      'Reserved for supervisor production runs, BOM stock postings, raw-material purchases, and finished-goods dispatch adjustments.',
  },
  'billing-payments': {
    title: 'Billing & Payments',
    description:
      'Reserved for customer invoicing, credit/payment tracking, and audit reconciliation after dispatch.',
  },
  management: {
    title: 'Management',
    description:
      'Reserved for master-data administration across Customers, Products (with BOM definitions), and Users.',
    subsections: ['Customers', 'Products', 'Users'],
  },
};

export function ScopedModulePlaceholder({ section }: ScopedModulePlaceholderProps) {
  const detail = SECTION_DETAILS[section];
  const [activeSubTab, setActiveSubTab] = useState(
    detail.subsections?.[0] ?? ''
  );

  return (
    <Card title={detail.title}>
      {detail.subsections && (
        <div className="mb-4 flex gap-2 border-b border-slate-200 pb-2">
          {detail.subsections.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => setActiveSubTab(sub)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeSubTab === sub
                  ? 'bg-blue-950 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <Lock className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
        <div>
          <p className="font-medium text-slate-900">
            {detail.subsections ? `${activeSubTab} — ` : ''}Module Not Yet
            Implemented
          </p>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            {detail.description} Per current project scope, only the{' '}
            <strong>Admin Dashboard</strong> and{' '}
            <strong>Order Shortage Workflow</strong> are active until you confirm
            proceeding to additional modules.
          </p>
        </div>
      </div>
    </Card>
  );
}
