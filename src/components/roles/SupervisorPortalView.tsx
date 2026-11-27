import { useCallback, useEffect, useState } from 'react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  AuthUser,
  BomRevisionRequest,
  InventoryItem,
  MaterialPurchaseRequirement,
  ProductionRequest,
  ProductionRun,
  StockDiscrepancyReport,
  StockMovement,
  SupervisorDashboardData,
  SupervisorNavSection,
} from '../../types/orderAudit';
import { SupervisorDashboardView } from '../supervisor/SupervisorDashboardView';
import { SupervisorExecutionView } from '../supervisor/SupervisorExecutionView';
import { SupervisorHistoryView } from '../supervisor/SupervisorHistoryView';
import { SupervisorInventoryView } from '../supervisor/SupervisorInventoryView';
import { SupervisorLayout } from '../supervisor/SupervisorLayout';
import { SupervisorProposalsView } from '../supervisor/SupervisorProposalsView';
import { SupervisorRequestsView } from '../supervisor/SupervisorRequestsView';

interface SupervisorPortalViewProps {
  user: AuthUser;
  onLogout: () => void;
}

export function SupervisorPortalView({ user, onLogout }: SupervisorPortalViewProps) {
  const [activeSection, setActiveSection] = useState<SupervisorNavSection>('dashboard');
  const [dashboard, setDashboard] = useState<SupervisorDashboardData | null>(null);
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchaseRequirements, setPurchaseRequirements] = useState<
    MaterialPurchaseRequirement[]
  >([]);
  const [discrepancies, setDiscrepancies] = useState<StockDiscrepancyReport[]>([]);
  const [bomRevisions, setBomRevisions] = useState<BomRevisionRequest[]>([]);

  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [requestsFilter, setRequestsFilter] = useState<string>('ALL');
  const [inventoryLowStockOnly, setInventoryLowStockOnly] = useState<boolean>(false);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const [executionRequestId, setExecutionRequestId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [
        dashData,
        reqList,
        runList,
        invList,
        movList,
        purchReqs,
        discList,
        bomRevList,
      ] = await Promise.all([
        orderAuditService.loadSupervisorDashboard(),
        orderAuditService.listProductionRequests(),
        orderAuditService.listProductionRuns(),
        orderAuditService.listInventoryItems(),
        orderAuditService.listStockMovements(),
        orderAuditService.listMaterialPurchaseRequirements(),
        orderAuditService.listStockDiscrepancies(),
        orderAuditService.listBomRevisionRequests(),
      ]);
      setDashboard(dashData);
      setRequests(reqList);
      setRuns(runList);
      setInventoryItems(invList);
      setMovements(movList);
      setPurchaseRequirements(purchReqs);
      setDiscrepancies(discList);
      setBomRevisions(bomRevList);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load Production Supervisor workspace.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const actionableRequestsCount = requests.filter((r) =>
    [
      'PENDING_SUPERVISOR_REVIEW',
      'PENDING_MATERIAL_CHECK',
      'MATERIAL_SHORTAGE',
      'AWAITING_MATERIALS',
      'READY_FOR_PRODUCTION',
      'IN_PROGRESS',
    ].includes(r.status)
  ).length;

  return (
    <SupervisorLayout
      activeSection={activeSection}
      onNavigate={setActiveSection}
      currentUser={user}
      onLogout={onLogout}
      actionableRequestsCount={actionableRequestsCount}
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading && !dashboard ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading Production Supervisor workspace...
        </div>
      ) : (
        <>
          {activeSection === 'dashboard' && dashboard && (
            <SupervisorDashboardView
              data={dashboard}
              inventoryItems={inventoryItems}
              requests={requests}
              loading={loading}
              error={error}
              onRetry={() => void loadData()}
              onNavigate={(section) => {
                if (section === 'inventory') {
                  setInventoryLowStockOnly(false);
                  setHighlightItemId(null);
                } else if (section === 'requests') {
                  setRequestsFilter('ALL');
                }
                setActiveSection(section);
              }}
              onOpenPendingRequests={() => {
                setRequestsFilter('PENDING_GROUP');
                setSelectedRequestId(null);
                setActiveSection('requests');
              }}
              onOpenLowStockInventory={() => {
                setInventoryLowStockOnly(true);
                setHighlightItemId(null);
                setActiveSection('inventory');
              }}
              onOpenActiveProduction={() => {
                setRequestsFilter('IN_PROGRESS');
                setSelectedRequestId(null);
                setActiveSection('requests');
              }}
              onOpenAllRequests={() => {
                setRequestsFilter('ALL');
                setSelectedRequestId(null);
                setActiveSection('requests');
              }}
              onOpenMaterialDetail={(itemId) => {
                setInventoryLowStockOnly(true);
                setHighlightItemId(itemId);
                setActiveSection('inventory');
              }}
              onInspectRequest={(reqId) => {
                setRequestsFilter('ALL');
                setSelectedRequestId(reqId);
                setActiveSection('requests');
              }}
            />
          )}

          {activeSection === 'requests' && (
            <SupervisorRequestsView
              requests={requests}
              purchaseRequirements={purchaseRequirements}
              bomRevisions={bomRevisions}
              selectedRequestId={selectedRequestId}
              initialStatusFilter={requestsFilter}
              onSelectRequest={setSelectedRequestId}
              onStartExecution={(reqId) => {
                setExecutionRequestId(reqId);
                setActiveSection('execution');
              }}
              onRefresh={loadData}
            />
          )}

          {activeSection === 'inventory' && (
            <SupervisorInventoryView
              items={inventoryItems}
              movements={movements}
              discrepancies={discrepancies}
              initialLowStockOnly={inventoryLowStockOnly}
              initialHighlightItemId={highlightItemId}
              onRefresh={loadData}
            />
          )}

          {activeSection === 'execution' && (
            <SupervisorExecutionView
              requests={requests}
              inventoryItems={inventoryItems}
              initialRequestId={executionRequestId}
              onRefresh={loadData}
              onPostedSuccess={() => setActiveSection('history')}
            />
          )}

          {activeSection === 'history' && (
            <SupervisorHistoryView runs={runs} onRefresh={loadData} />
          )}

          {activeSection === 'proposals' && (
            <SupervisorProposalsView
              inventoryItems={inventoryItems}
              onRefresh={loadData}
            />
          )}
        </>
      )}
    </SupervisorLayout>
  );
}
