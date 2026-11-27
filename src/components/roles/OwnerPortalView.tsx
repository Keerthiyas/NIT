import { useCallback, useEffect, useState } from 'react';
import { orderAuditService } from '../../services/orderAuditService';
import type { AuthUser, OwnerDashboardData, OwnerNavSection } from '../../types/orderAudit';
import { OwnerApprovalsView } from '../owner/OwnerApprovalsView';
import { OwnerBusinessOverviewView } from '../owner/OwnerBusinessOverviewView';
import { OwnerDashboardView } from '../owner/OwnerDashboardView';
import { OwnerFinancialOverviewView } from '../owner/OwnerFinancialOverviewView';
import { OwnerInventoryOverviewView } from '../owner/OwnerInventoryOverviewView';
import { OwnerLayout } from '../owner/OwnerLayout';
import { OwnerReportsView } from '../owner/OwnerReportsView';

interface OwnerPortalViewProps {
  user: AuthUser;
  onLogout: () => void;
}

export function OwnerPortalView({ user, onLogout }: OwnerPortalViewProps) {
  const [activeSection, setActiveSection] = useState<OwnerNavSection>('dashboard');
  const [dashboard, setDashboard] = useState<OwnerDashboardData | null>(null);
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerDashboard();
      setDashboard(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Owner dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleNavigate = (section: OwnerNavSection) => {
    if (section !== 'approvals') setSelectedPoId(null);
    setActiveSection(section);
  };

  return (
    <OwnerLayout
      activeSection={activeSection}
      onNavigate={handleNavigate}
      currentUser={user}
      onLogout={onLogout}
      pendingApprovalsCount={dashboard?.pendingApprovalsCount ?? 0}
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading && !dashboard ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading Owner Executive Dashboard...
        </div>
      ) : (
        <>
          {activeSection === 'dashboard' && dashboard && (
            <OwnerDashboardView
              data={dashboard}
              onNavigateBusiness={() => setActiveSection('business-overview')}
              onNavigateFinancial={() => setActiveSection('financial-overview')}
              onNavigateApprovals={(poId) => {
                setSelectedPoId(poId ?? null);
                setActiveSection('approvals');
              }}
            />
          )}

          {activeSection === 'business-overview' && <OwnerBusinessOverviewView />}

          {activeSection === 'inventory-overview' && <OwnerInventoryOverviewView />}

          {activeSection === 'financial-overview' && <OwnerFinancialOverviewView />}

          {activeSection === 'approvals' && (
            <OwnerApprovalsView
              initialSelectedPoId={selectedPoId}
              onApprovalsChanged={() => void loadDashboard()}
            />
          )}

          {activeSection === 'reports' && <OwnerReportsView />}
        </>
      )}
    </OwnerLayout>
  );
}
