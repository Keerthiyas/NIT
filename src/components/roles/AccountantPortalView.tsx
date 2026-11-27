import { useCallback, useEffect, useState } from 'react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  AccountantDashboardData,
  AccountantNavSection,
  AuthUser,
  BillingWorkspaceData,
  CustomerReceivableSummary,
  DispatchRecord,
  Invoice,
} from '../../types/orderAudit';
import { AccountantDashboardView } from '../accountant/AccountantDashboardView';
import { AccountantInvoicesView } from '../accountant/AccountantInvoicesView';
import { AccountantLayout } from '../accountant/AccountantLayout';
import { AccountantPaymentsView } from '../accountant/AccountantPaymentsView';
import { AccountantProductVerifyView } from '../accountant/AccountantProductVerifyView';
import { AccountantReceivablesView } from '../accountant/AccountantReceivablesView';
import { AccountantReportsView } from '../accountant/AccountantReportsView';

interface AccountantPortalViewProps {
  user: AuthUser;
  onLogout: () => void;
}

export function AccountantPortalView({ user, onLogout }: AccountantPortalViewProps) {
  const [activeSection, setActiveSection] = useState<AccountantNavSection>('dashboard');
  const [dashboard, setDashboard] = useState<AccountantDashboardData | null>(null);
  const [billing, setBilling] = useState<BillingWorkspaceData | null>(null);
  const [receivables, setReceivables] = useState<CustomerReceivableSummary[]>([]);

  const [filterPendingInvoices, setFilterPendingInvoices] = useState(false);
  const [previewDispatch, setPreviewDispatch] = useState<DispatchRecord | null>(null);
  const [paymentInvoiceTarget, setPaymentInvoiceTarget] = useState<Invoice | null>(null);
  const [paymentCustomerTarget, setPaymentCustomerTarget] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [dash, bill, recs] = await Promise.all([
        orderAuditService.loadAccountantDashboard(),
        orderAuditService.loadBillingWorkspace(),
        orderAuditService.listCustomerReceivables(),
      ]);
      setDashboard(dash);
      setBilling(bill);
      setReceivables(recs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load Accountant workspace.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <AccountantLayout
      activeSection={activeSection}
      onNavigate={(section) => {
        setFilterPendingInvoices(false);
        setActiveSection(section);
      }}
      currentUser={user}
      onLogout={onLogout}
      pendingInvoicesCount={dashboard?.pendingInvoicesCount ?? 0}
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading && !dashboard ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading Accountant workspace...
        </div>
      ) : (
        <>
          {activeSection === 'dashboard' && dashboard && (
            <AccountantDashboardView
              data={dashboard}
              onOpenPendingInvoices={() => {
                setFilterPendingInvoices(true);
                setActiveSection('invoices');
              }}
              onOpenInvoices={() => {
                setFilterPendingInvoices(false);
                setActiveSection('invoices');
              }}
              onOpenPayments={() => setActiveSection('payments')}
              onOpenReceivables={() => setActiveSection('receivables')}
              onGenerateFromDispatch={(dispatch) => {
                setPreviewDispatch(dispatch);
                setFilterPendingInvoices(false);
                setActiveSection('invoices');
              }}
            />
          )}

          {activeSection === 'invoices' && billing && (
            <AccountantInvoicesView
              dispatchesReady={billing.dispatchesReadyForInvoicing}
              invoices={billing.invoices}
              initialFilterPending={filterPendingInvoices}
              initialPreviewDispatch={previewDispatch}
              onClearInitialDispatch={() => setPreviewDispatch(null)}
              onRecordPaymentForInvoice={(inv) => {
                setPaymentCustomerTarget(null);
                setPaymentInvoiceTarget(inv);
                setActiveSection('payments');
              }}
              onRefresh={loadData}
            />
          )}

          {activeSection === 'payments' && billing && (
            <AccountantPaymentsView
              invoices={billing.invoices}
              payments={billing.payments}
              receivables={receivables}
              initialInvoiceForPayment={paymentInvoiceTarget}
              initialCustomerForPayment={paymentCustomerTarget}
              onClearInitialTargets={() => {
                setPaymentInvoiceTarget(null);
                setPaymentCustomerTarget(null);
              }}
              onRefresh={loadData}
            />
          )}

          {activeSection === 'receivables' && (
            <AccountantReceivablesView
              receivables={receivables}
              onCollectPaymentForCustomer={(customerId) => {
                setPaymentInvoiceTarget(null);
                setPaymentCustomerTarget(customerId);
                setActiveSection('payments');
              }}
            />
          )}

          {activeSection === 'reports' && (
            <AccountantReportsView customers={receivables} />
          )}

          {activeSection === 'product-verifications' && (
            <AccountantProductVerifyView />
          )}
        </>
      )}
    </AccountantLayout>
  );
}
