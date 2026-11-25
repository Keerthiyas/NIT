import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoginView } from './components/auth/LoginView';
import { BillingPaymentsView } from './components/billing/BillingPaymentsView';
import { AdminDashboardView } from './components/dashboard/AdminDashboardView';
import { AdminLayout } from './components/layout/AdminLayout';
import { ManagementView } from './components/management/ManagementView';
import { OrderDetailDrawer } from './components/orders/OrderDetailDrawer';
import { OrdersPageView } from './components/orders/OrdersPageView';
import { ProductionStockView } from './components/production/ProductionStockView';
import { AccountantPortalView } from './components/roles/AccountantPortalView';
import { SupervisorPortalView } from './components/roles/SupervisorPortalView';
import { SalesmanPortalView } from './components/salesman/SalesmanPortalView';
import {
  orderAuditService,
  type OrderAuditSnapshot,
} from './services/orderAuditService';
import type {
  AdminNavSection,
  AdminOrderDecision,
  AuthUser,
  OrderShortageAnalysis,
} from './types/orderAudit';

export function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [activeSection, setActiveSection] = useState<AdminNavSection>('dashboard');
  const [snapshot, setSnapshot] = useState<OrderAuditSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] =
    useState<OrderShortageAnalysis | null>(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const user = await orderAuditService.getCurrentUser();
        setCurrentUser(user);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  const isAdminUser =
    currentUser?.role === 'ADMIN' || currentUser?.role === 'OWNER_SUPER_ADMIN';

  const refreshWorkspace = useCallback(async () => {
    if (!isAdminUser) return;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await orderAuditService.loadWorkspaceState();
      setSnapshot(next);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load workspace data.'
      );
    } finally {
      setLoading(false);
    }
  }, [isAdminUser]);

  useEffect(() => {
    if (isAdminUser) {
      void refreshWorkspace();
    } else {
      setSnapshot(null);
    }
  }, [isAdminUser, refreshWorkspace]);

  const handleLogout = async () => {
    await orderAuditService.logout();
    setCurrentUser(null);
    setSnapshot(null);
    setSelectedOrderId(null);
    setSelectedAnalysis(null);
    setActiveSection('dashboard');
  };

  const handleOpenOrder = useCallback(async (orderId: string) => {
    setDecisionError(null);
    setSelectedOrderId(orderId);
    try {
      const analysis = await orderAuditService.checkOrderAvailability(orderId);
      setSelectedAnalysis(analysis);
    } catch (err) {
      setDecisionError(
        err instanceof Error ? err.message : 'Failed to evaluate availability.'
      );
    }
  }, []);

  const handleCloseOrder = () => {
    setSelectedOrderId(null);
    setSelectedAnalysis(null);
    setDecisionError(null);
  };

  const handleDecision = async (
    orderId: string,
    decision: AdminOrderDecision,
    note?: string
  ) => {
    setDecisionSubmitting(true);
    setDecisionError(null);
    try {
      const result = await orderAuditService.submitOrderDecision({
        orderId,
        decision,
        note,
        actor: currentUser?.fullName ?? 'Admin',
      });
      setSnapshot(result.snapshot);
      const refreshedAnalysis =
        await orderAuditService.checkOrderAvailability(orderId);
      setSelectedAnalysis(refreshedAnalysis);
    } catch (err) {
      setDecisionError(
        err instanceof Error ? err.message : 'Unable to save order decision.'
      );
    } finally {
      setDecisionSubmitting(false);
    }
  };

  const selectedOrder = useMemo(
    () => snapshot?.orders.find((o) => o.id === selectedOrderId),
    [snapshot, selectedOrderId]
  );

  const selectedProduct = useMemo(
    () =>
      selectedOrder
        ? snapshot?.products.find((p) => p.id === selectedOrder.productId)
        : undefined,
    [snapshot, selectedOrder]
  );

  const existingProductionRequest = useMemo(
    () =>
      selectedOrder
        ? snapshot?.productionRequests.find(
            (r) => r.orderId === selectedOrder.id && r.status !== 'CANCELLED'
          )
        : undefined,
    [snapshot, selectedOrder]
  );

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Checking session...
      </div>
    );
  }

  if (!currentUser) {
    return <LoginView onSuccess={(user) => setCurrentUser(user)} />;
  }

  if (currentUser.role === 'PRODUCTION_SUPERVISOR') {
    return (
      <SupervisorPortalView
        user={currentUser}
        onLogout={() => void handleLogout()}
      />
    );
  }

  if (currentUser.role === 'ACCOUNTANT') {
    return (
      <AccountantPortalView
        user={currentUser}
        onLogout={() => void handleLogout()}
      />
    );
  }

  if (currentUser.role === 'SALESMAN') {
    return (
      <SalesmanPortalView
        user={currentUser}
        onLogout={() => void handleLogout()}
      />
    );
  }

  const pendingBadgeCount = snapshot?.dashboardSummary.pendingOrdersCount ?? 0;

  return (
    <AdminLayout
      activeSection={activeSection}
      onNavigate={setActiveSection}
      currentUser={currentUser}
      onLogout={() => void handleLogout()}
      pendingBadgeCount={pendingBadgeCount}
    >
      {loading && !snapshot ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading Admin Dashboard...
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {loadError}
        </div>
      ) : snapshot ? (
        <>
          {activeSection === 'dashboard' && (
            <AdminDashboardView
              summary={snapshot.dashboardSummary}
              onOpenOrders={() => setActiveSection('orders')}
              onOpenOrderDetail={(orderId) => {
                setActiveSection('orders');
                void handleOpenOrder(orderId);
              }}
            />
          )}

          {activeSection === 'orders' && (
            <OrdersPageView
              orders={snapshot.orders}
              products={snapshot.products}
              onOpenOrder={handleOpenOrder}
            />
          )}

          {activeSection === 'production-stock' && (
            <ProductionStockView onDataChanged={() => void refreshWorkspace()} />
          )}

          {activeSection === 'billing-payments' && <BillingPaymentsView />}

          {activeSection === 'management' && (
            <ManagementView
              currentUser={currentUser}
              onDataChanged={() => void refreshWorkspace()}
            />
          )}
        </>
      ) : null}

      {selectedOrder && selectedAnalysis && (
        <OrderDetailDrawer
          order={selectedOrder}
          product={selectedProduct}
          analysis={selectedAnalysis}
          existingProductionRequest={existingProductionRequest}
          onClose={handleCloseOrder}
          onDecision={handleDecision}
          submitting={decisionSubmitting}
          errorMessage={decisionError}
        />
      )}
    </AdminLayout>
  );
}

export default App;
