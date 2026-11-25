import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CreditCard, FilePlus2, LogOut, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { AuthUser, BillingWorkspaceData, Invoice } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { ToneBadge } from '../ui/Badge';

export function AccountantPortalView({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [data, setData] = useState<BillingWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('UPI / Campus Transfer');
  const [payRef, setPayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadBillingWorkspace();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const handleGenerateInvoice = async (dispatchId: string) => {
    setError(null);
    try {
      const res = await orderAuditService.createInvoice(dispatchId);
      setBanner(`Generated GST invoice ${res.invoiceNumber} from dispatched quantities.`);
      await loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice.');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingInvoice) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await orderAuditService.recordPayment({
        invoiceId: payingInvoice.id,
        amount: Number(payAmount),
        paymentMode: payMode,
        referenceNumber: payRef,
      });
      setPayingInvoice(null);
      setBanner(
        `Recorded payment ${res.paymentNumber} (${res.paymentStatus}).`
      );
      await loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
            NIT Trichy Order-to-Audit • Accountant
          </p>
          <h1 className="text-base font-semibold text-slate-900">
            GST Invoicing &amp; Payment Recording
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-600">
            Signed in as <strong>{user.fullName}</strong>
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-5">
        {banner && (
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading || !data ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading Accountant workspace...
          </div>
        ) : (
          <>
            <Card
              title="Fulfilled Dispatches Ready for Invoicing"
              subtitle="Invoices are calculated exclusively from dispatched quantities using customer state GST rules"
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Dispatch #</th>
                      <th className="px-4 py-2.5">Order #</th>
                      <th className="px-4 py-2.5">Customer (State)</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Dispatched Qty</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.dispatchesReadyForInvoicing.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                          {d.dispatchNumber}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{d.orderNumber}</td>
                        <td className="px-4 py-2.5">
                          {d.customerName} ({d.customerState})
                        </td>
                        <td className="px-4 py-2.5">{d.productName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {d.dispatchedQuantity} {d.unit}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void handleGenerateInvoice(d.id)}
                            className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-900"
                          >
                            <FilePlus2 className="h-3.5 w-3.5" />
                            Generate GST Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                    {data.dispatchesReadyForInvoicing.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                          All dispatched orders have been invoiced.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Invoices & Payment Collection" noPadding>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Invoice #</th>
                      <th className="px-4 py-2.5">Customer</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5 text-right">Received</th>
                      <th className="px-4 py-2.5 text-right">Outstanding</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5">{inv.customerName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          ₹{inv.totalAmount.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                          ₹{inv.amountReceived.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          ₹{inv.outstandingBalance.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5">
                          <ToneBadge
                            tone={
                              inv.paymentStatus === 'PAID'
                                ? 'success'
                                : inv.paymentStatus === 'PARTIALLY_PAID'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {inv.paymentStatus}
                          </ToneBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {inv.outstandingBalance > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingInvoice(inv);
                                setPayAmount(String(inv.outstandingBalance));
                                setPayRef('');
                              }}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              Record Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>

      {payingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleRecordPayment(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Record Payment — {payingInvoice.invoiceNumber}
              </h3>
              <button
                type="button"
                onClick={() => setPayingInvoice(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Outstanding balance: <strong>₹{payingInvoice.outstandingBalance.toFixed(2)}</strong>
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount (₹)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={payingInvoice.outstandingBalance}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="UPI / Campus Transfer">UPI / Campus Transfer</option>
                  <option value="NEFT / RTGS">NEFT / RTGS</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reference Number</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR / Cheque #"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setPayingInvoice(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Save Payment
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

