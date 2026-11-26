import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { CustomerReceivableSummary, FinancialReportsData } from '../../types/orderAudit';
import { downloadCsv, downloadLinesAsPdf } from '../../utils/pdfExport';
import { Card } from '../ui/Card';

interface AccountantReportsViewProps {
  customers: CustomerReceivableSummary[];
}

type ReportTab = 'sales' | 'gst' | 'collections' | 'receivables';

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AccountantReportsView({ customers }: AccountantReceivablesViewProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [report, setReport] = useState<FinancialReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.getFinancialReports({
        from: fromDate || undefined,
        to: toDate || undefined,
        customerId: customerFilter !== 'ALL' ? customerFilter : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load financial reports.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, customerFilter, statusFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleExportCsv = () => {
    if (!report) return;
    if (activeTab === 'sales') {
      downloadCsv(
        'sales-invoice-report.csv',
        ['Invoice #', 'Date', 'Customer', 'Order #', 'Taxable', 'GST', 'Total', 'Paid', 'Status'],
        report.salesAndInvoices.rows.map((i) => [
          i.invoiceNumber,
          i.invoiceDate,
          i.customerName,
          i.orderNumber,
          i.taxableAmount.toFixed(2),
          i.totalGstAmount.toFixed(2),
          i.totalAmount.toFixed(2),
          i.amountReceived.toFixed(2),
          i.paymentStatus,
        ])
      );
    } else if (activeTab === 'gst') {
      downloadCsv(
        'gst-summary-report.csv',
        ['GST Rate %', 'Supply Type', 'Invoices', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total GST'],
        report.gstSummary.rows.map((g) => [
          `${g.gstRate}%`,
          g.supplyType,
          g.invoiceCount,
          g.taxableAmount.toFixed(2),
          g.cgstAmount.toFixed(2),
          g.sgstAmount.toFixed(2),
          g.igstAmount.toFixed(2),
          g.totalGstAmount.toFixed(2),
        ])
      );
    } else if (activeTab === 'collections') {
      downloadCsv(
        'payment-collection-report.csv',
        ['Payment #', 'Date', 'Customer', 'Method', 'Invoices', 'Amount', 'Recorded By'],
        report.paymentCollection.rows.map((p) => [
          p.paymentNumber,
          p.paymentDate,
          p.customerName || '',
          p.paymentMode,
          p.invoiceNumber || '',
          p.amount.toFixed(2),
          p.recordedBy,
        ])
      );
    } else {
      downloadCsv(
        'outstanding-receivables-report.csv',
        ['Customer', 'Code', 'Total Invoiced', 'Total Paid', 'Outstanding', 'Overdue', 'Status'],
        report.outstandingReceivables.rows.map((r) => [
          r.customerName,
          r.customerCode,
          r.totalInvoiced.toFixed(2),
          r.totalPaid.toFixed(2),
          r.outstandingAmount.toFixed(2),
          r.overdueAmount.toFixed(2),
          r.status,
        ])
      );
    }
  };

  const handleDownloadPdf = () => {
    if (!report) return;
    if (activeTab === 'sales') {
      downloadLinesAsPdf(
        'sales-invoice-report.pdf',
        'SALES & INVOICE REPORT',
        report.salesAndInvoices.rows.map(
          (i) =>
            `${i.invoiceNumber} | ${i.invoiceDate} | ${i.customerName} | Total INR ${i.totalAmount.toFixed(2)} | ${i.paymentStatus}`
        )
      );
    } else if (activeTab === 'gst') {
      downloadLinesAsPdf(
        'gst-summary-report.pdf',
        'GST SUMMARY REPORT',
        report.gstSummary.rows.map(
          (g) =>
            `${g.gstRate}% (${g.supplyType}) | Taxable INR ${g.taxableAmount.toFixed(2)} | CGST ${g.cgstAmount.toFixed(2)} | SGST ${g.sgstAmount.toFixed(2)} | IGST ${g.igstAmount.toFixed(2)}`
        )
      );
    } else if (activeTab === 'collections') {
      downloadLinesAsPdf(
        'payment-collection-report.pdf',
        'PAYMENT COLLECTION REPORT',
        report.paymentCollection.rows.map(
          (p) =>
            `${p.paymentNumber} | ${p.paymentDate} | ${p.customerName} | ${p.paymentMode} | INR ${p.amount.toFixed(2)}`
        )
      );
    } else {
      downloadLinesAsPdf(
        'outstanding-receivables-report.pdf',
        'OUTSTANDING RECEIVABLES REPORT',
        report.outstandingReceivables.rows.map(
          (r) =>
            `${r.customerName} | Invoiced INR ${r.totalInvoiced.toFixed(2)} | Paid INR ${r.totalPaid.toFixed(2)} | Due INR ${r.outstandingAmount.toFixed(2)}`
        )
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Report Tabs + Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'sales', label: 'Sales & Invoices' },
              { id: 'gst', label: 'GST Summary' },
              { id: 'collections', label: 'Payment Collection' },
              { id: 'receivables', label: 'Outstanding Receivables' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium cursor-pointer ${
                activeTab === t.id
                  ? 'bg-blue-950 text-white border-blue-950'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!report}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-900 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 text-xs">
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
        />
        <span className="text-slate-400">to</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
        />
        <select
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
        >
          <option value="ALL">All Customers</option>
          {customers.map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {c.customerName}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
        >
          <option value="ALL">All Invoice Statuses</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading || !report ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Generating report from database records...
        </div>
      ) : (
        <>
          {activeTab === 'sales' && (
            <Card
              title="Sales & Invoice Report"
              subtitle={`Active Invoices: ${report.salesAndInvoices.activeInvoiceCount} · Taxable: ${formatInr(report.salesAndInvoices.taxableTotal)} · GST: ${formatInr(report.salesAndInvoices.gstTotal)} · Grand Total: ${formatInr(report.salesAndInvoices.grandTotal)}`}
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Invoice #</th>
                      <th className="px-4 py-2 text-left font-semibold">Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Customer</th>
                      <th className="px-4 py-2 text-right font-semibold">Taxable</th>
                      <th className="px-4 py-2 text-right font-semibold">GST</th>
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                      <th className="px-4 py-2 text-right font-semibold">Paid</th>
                      <th className="px-4 py-2 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {report.salesAndInvoices.rows.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-2 font-mono text-blue-900">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2 tabular-nums">{inv.invoiceDate}</td>
                        <td className="px-4 py-2">{inv.customerName}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(inv.taxableAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(inv.totalGstAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {formatInr(inv.totalAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                          {formatInr(inv.amountReceived)}
                        </td>
                        <td className="px-4 py-2">{inv.paymentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'gst' && (
            <Card
              title="GST Summary Report"
              subtitle={`CGST: ${formatInr(report.gstSummary.cgstTotal)} · SGST: ${formatInr(report.gstSummary.sgstTotal)} · IGST: ${formatInr(report.gstSummary.igstTotal)} · Total GST: ${formatInr(report.gstSummary.totalGst)}`}
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">GST Slab</th>
                      <th className="px-4 py-2 text-left font-semibold">Supply Type</th>
                      <th className="px-4 py-2 text-right font-semibold">Invoices</th>
                      <th className="px-4 py-2 text-right font-semibold">Taxable Value</th>
                      <th className="px-4 py-2 text-right font-semibold">CGST</th>
                      <th className="px-4 py-2 text-right font-semibold">SGST</th>
                      <th className="px-4 py-2 text-right font-semibold">IGST</th>
                      <th className="px-4 py-2 text-right font-semibold">Total GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {report.gstSummary.rows.map((g) => (
                      <tr key={`${g.gstRate}-${g.supplyType}`}>
                        <td className="px-4 py-2 font-semibold">{g.gstRate}%</td>
                        <td className="px-4 py-2">{g.supplyType}</td>
                        <td className="px-4 py-2 text-right">{g.invoiceCount}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(g.taxableAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(g.cgstAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(g.sgstAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(g.igstAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {formatInr(g.totalGstAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'collections' && (
            <Card
              title="Payment Collection Report"
              subtitle={`Total Collected: ${formatInr(report.paymentCollection.totalCollected)} across ${report.paymentCollection.paymentCount} receipt(s)`}
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Payment #</th>
                      <th className="px-4 py-2 text-left font-semibold">Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Customer</th>
                      <th className="px-4 py-2 text-left font-semibold">Method</th>
                      <th className="px-4 py-2 text-left font-semibold">Invoices</th>
                      <th className="px-4 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {report.paymentCollection.rows.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2 font-mono text-blue-900">{p.paymentNumber}</td>
                        <td className="px-4 py-2 tabular-nums">{p.paymentDate}</td>
                        <td className="px-4 py-2">{p.customerName}</td>
                        <td className="px-4 py-2">{p.paymentMode}</td>
                        <td className="px-4 py-2 font-mono">{p.invoiceNumber || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                          {formatInr(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'receivables' && (
            <Card
              title="Outstanding Receivables Report"
              subtitle={`Total Outstanding: ${formatInr(report.outstandingReceivables.totalOutstanding)} · Overdue: ${formatInr(report.outstandingReceivables.totalOverdue)}`}
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Customer</th>
                      <th className="px-4 py-2 text-right font-semibold">Invoiced</th>
                      <th className="px-4 py-2 text-right font-semibold">Paid</th>
                      <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                      <th className="px-4 py-2 text-right font-semibold">Overdue</th>
                      <th className="px-4 py-2 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {report.outstandingReceivables.rows.map((r) => (
                      <tr key={r.customerId}>
                        <td className="px-4 py-2 font-medium">{r.customerName}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(r.totalInvoiced)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                          {formatInr(r.totalPaid)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-rose-700">
                          {formatInr(r.outstandingAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatInr(r.overdueAmount)}
                        </td>
                        <td className="px-4 py-2">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
