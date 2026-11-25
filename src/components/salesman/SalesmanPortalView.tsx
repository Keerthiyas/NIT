import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  AuthUser,
  SalesmanDashboardData,
  SalesmanNavSection,
  SalesmanOrder,
} from '../../types/orderAudit';
import { SalesmanDashboardView } from './SalesmanDashboardView';
import { SalesmanLayout } from './SalesmanLayout';
import { SalesmanNewOrderView, type CartItem } from './SalesmanNewOrderView';
import { SalesmanOrdersView } from './SalesmanOrdersView';

export function SalesmanPortalView({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [activeSection, setActiveSection] = useState<SalesmanNavSection>('dashboard');
  const [dashboardData, setDashboardData] = useState<SalesmanDashboardData | null>(null);
  const [orders, setOrders] = useState<SalesmanOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<SalesmanOrder | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSalesmanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, ordList] = await Promise.all([
        orderAuditService.loadSalesmanDashboard(),
        orderAuditService.listSalesmanOrders(),
      ]);
      setDashboardData(dash);
      setOrders(ordList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Salesman data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSalesmanData();
  }, [loadSalesmanData]);

  const handleViewOrder = (order: SalesmanOrder) => {
    setSelectedOrder(order);
    setActiveSection('my-orders');
  };

  const handleOrderCreated = (created: SalesmanOrder) => {
    setOrders((prev) => [created, ...prev]);
    setDashboardData((prev) =>
      prev
        ? {
            totalOrdersCount: prev.totalOrdersCount + 1,
            pendingOrdersCount: prev.pendingOrdersCount + 1,
            recentOrders: [created, ...prev.recentOrders].slice(0, 6),
          }
        : prev
    );
  };

  return (
    <SalesmanLayout
      activeSection={activeSection}
      onNavigate={setActiveSection}
      currentUser={user}
      onLogout={onLogout}
      cartItemCount={cart.length}
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {activeSection === 'dashboard' &&
        (loading && !dashboardData ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading Salesman Dashboard...
          </div>
        ) : dashboardData ? (
          <SalesmanDashboardView
            user={user}
            data={dashboardData}
            onCreateNewOrder={() => setActiveSection('new-order')}
            onViewOrder={handleViewOrder}
            onViewAllOrders={() => setActiveSection('my-orders')}
          />
        ) : null)}

      {activeSection === 'new-order' && (
        <SalesmanNewOrderView
          cart={cart}
          onSetCart={setCart}
          onOrderCreated={handleOrderCreated}
          onViewOrder={handleViewOrder}
        />
      )}

      {activeSection === 'my-orders' && (
        <SalesmanOrdersView
          orders={orders}
          selectedOrder={selectedOrder}
          onSelectOrder={setSelectedOrder}
        />
      )}
    </SalesmanLayout>
  );
}
