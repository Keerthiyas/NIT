import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { OwnerReportsData } from '../../types/orderAudit';
import { downloadCsv, downloadLinesAsPdf } from '../../utils/pdfExport';
import { Card } from '../ui/Card';
import { formatInr } from './OwnerCharts';

type ReportTab =
  | 'sales'
  | 'production'
  | 'inventory'
  | 'purchase'
  | 'outstanding'
  | 'financial';

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'sales', label: 'Sales Report' },
  { id: 'production', label: 'Production Report' },
  { id: 'inventory', label: 'Inventory Report' },
  { id: 'purchase', label: 'Purchase Report' },
  { id: 'outstanding', label: 'Outstanding Payments Report' },
  { id: 'financial', label: 'Financial Summary' },
];

export function OwnerReportsView() {
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [report, setReport] = useState<OwnerReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerReports({
        from: fromDate || undefined,
        to: toDate || undefined,
        category: categoryFilter,
        status: statusFilter,
      });
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Owner reports.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, categoryFilter, statusFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleExportCsv = () => {
    if (!report) return;
    if (activeTab === 'sales') {
      downloadCsv(
        'owner-sales-report.csv',
        ['Order #', 'Date', 'Customer', 'Status', 'Total Qty', 'Dispatched Qty', 'Subtotal'],
        report.salesReport.rows.map((o) => [
          o.orderNumber,
          o.orderDate.slice(0, 10),
          o.customerName,
          o.status,
          o.requestedQuantity,
          o.dispatchedQuantity,
          (o.subtotal ?? 0).toFixed(2),
        ])
      );
    } else if (activeTab === 'production') {
      downloadCsv(
        'owner-production-report.csv',
        ['Run #', 'Date', 'Product', 'Planned', 'Good Output', 'Rejected', 'Wastage', 'Status'],
        report.productionReport.rows.map((r) => [
          r.runNumber,
          r.postedAt.slice(0, 10),
          r.productName,
          r.plannedQuantity,
          r.actualOutputQuantity,
          r.rejectedQuantity ?? 0,
          r.wastageQuantity,
          r.status,
        ])
      );
    } else if (activeTab === 'inventory') {
      downloadCsv(
        'owner-inventory-report.csv',
        ['SKU', 'Name', 'Category', 'Available Stock', 'Reorder Level', 'Unit', 'Status'],
        report.inventoryReport.rows.map((i) => [
          i.sku,
          i.name,
          i.category,
          i.availableStock,
          i.reorderLevel,
          i.unit,
          i.stockStatus,
        ])
      );
    } else if (activeTab === 'purchase') {
      downloadCsv(
        'owner-purchase-report.csv',
        ['PO #', 'Order Date', 'Supplier', 'Status', 'Approval Status', 'Estimated Total'],
        report.purchaseReport.rows.map((p) => [
          p.poNumber,
          p.orderDate.slice(0, 10),
          p.supplierName,
          p.status,
          p.approvalStatus ?? 'NOT_REQUIRED',
          (p.estimatedTotal ?? 0).toFixed(2),
        ])
      );
    } else if (activeTab === 'outstanding') {
      downloadCsv(
        'owner-outstanding-payments-report.csv',
        ['Code', 'Customer', 'Total Invoiced', 'Total Paid', 'Outstanding', 'Overdue', 'Status'],
        report.outstandingPaymentsReport.rows.map((c) => [
          c.customerCode,
          c.customerName,
          c.totalInvoiced.toFixed(2),
          c.totalPaid.toFixed(2),
          c.outstandingAmount.toFixed(2),
          c.overdueAmount.toFixed(2),
          c.status,
        ])
      );
    } else {
      const f = report.financialSummary;
      downloadCsv(
        'owner-financial-summary.csv',
        ['Metric', 'Amount'],
        [
          ['Total Invoiced Amount', f.totalInvoicedAmount.toFixed(2)],
          ['Total Amount Collected', f.totalAmountCollected.toFixed(2)],
          ['Outstanding Amount', f.outstandingAmount.toFixed(2)],
          ['Purchase Expenditure (GRN)', f.purchaseExpenditure.toFixed(2)],
          ['Total GST Collected', f.gstCollected.toFixed(2)],
          ['CGST', f.cgstTotal.toFixed(2)],
          ['SGST', f.sgstTotal.toFixed(2)],
          ['IGST', f.igstTotal.toFixed(2)],
        ]
      );
    }
  };

  const handleExportPdf = () => {
    if (!report) return;
    if (activeTab === 'sales') {
      downloadLinesAsPdf('owner-sales-report.pdf', 'Owner Sales Report', [
        `Total Orders: ${report.salesReport.totalOrders} | Total Sales Value: ${formatInr(
          report.salesReport.totalSalesValue
        )}`,
        '',
        ...report.salesReport.rows.map(
          (o) =>
            `${o.orderNumber} | ${o.orderDate.slice(0, 10)} | ${o.customerName} | ${
              o.status
            } | Qty ${o.requestedQuantity} | ${formatInr(o.subtotal ?? 0)}`
        ),
      ]);
    } else if (activeTab === 'production') {
      downloadLinesAsPdf('owner-production-report.pdf', 'Owner Production Report', [
        `Runs: ${report.productionReport.totalRuns} | Planned: ${report.productionReport.totalPlanned} | Good: ${report.productionReport.totalGoodOutput} | Rejected: ${report.productionReport.totalRejected} | Wastage: ${report.productionReport.totalWastage}`,
        '',
        ...report.productionReport.rows.map(
          (r) =>
            `${r.runNumber} | ${r.postedAt.slice(0, 10)} | ${r.productName} | Planned ${
              r.plannedQuantity
            } | Good ${r.actualOutputQuantity} | Rej ${r.rejectedQuantity ?? 0}`
        ),
      ]);
    } else if (activeTab === 'inventory') {
      downloadLinesAsPdf('owner-inventory-report.pdf', 'Owner Inventory Report', [
        `Items: ${report.inventoryReport.totalItems} | Low Stock: ${report.inventoryReport.lowStockCount} | Out of Stock: ${report.inventoryReport.outOfStockCount}`,
        '',
        ...report.inventoryReport.rows.map(
          (i) =>
            `${i.sku} | ${i.name} | ${i.category} | Stock ${i.availableStock} ${i.unit} (Reorder ${i.reorderLevel}) | ${i.stockStatus}`
        ),
      ]);
    } else if (activeTab === 'purchase') {
      downloadLinesAsPdf('owner-purchase-report.pdf', 'Owner Purchase Report', [
        `POs: ${report.purchaseReport.totalOrders} | Estimated Value: ${formatInr(
          report.purchaseReport.totalEstimatedValue
        )}`,
        '',
        ...report.purchaseReport.rows.map(
          (p) =>
            `${p.poNumber} | ${p.orderDate.slice(0, 10)} | ${p.supplierName} | ${p.status} | ${
              p.approvalStatus ?? 'NOT_REQUIRED'
            } | ${formatInr(p.estimatedTotal ?? 0)}`
        ),
      ]);
    } else if (activeTab === 'outstanding') {
      downloadLinesAsPdf(
        'owner-outstanding-payments-report.pdf',
        'Owner Outstanding Payments Report',
        [
          `Total Outstanding: ${formatInr(
            report.outstandingPaymentsReport.totalOutstanding
          )} | Overdue: ${formatInr(report.outstandingPaymentsReport.totalOverdue)}`,
          '',
          ...report.outstandingPaymentsReport.rows.map(
            (c) =>
              `${c.customerCode} | ${c.customerName} | Invoiced ${formatInr(
                c.totalInvoiced
              )} | Paid ${formatInr(c.totalPaid)} | Bal ${formatInr(
                c.outstandingAmount
              )} | ${c.status}`
          ),
        ]
      );
    } else {
      const f = report.financialSummary;
      downloadLinesAsPdf('owner-financial-summary.pdf', 'Owner Financial Summary Report', [
        `Total Invoiced Amount     : ${formatInr(f.totalInvoicedAmount)}`,
        `Total Amount Collected    : ${formatInr(f.totalAmountCollected)}`,
        `Outstanding Amount        : ${formatInr(f.outstandingAmount)}`,
        `Purchase Expenditure (GRN): ${formatInr(f.purchaseExpenditure)}`,
        `Total GST Billed          : ${formatInr(f.gstCollected)} (CGST ${formatInr(
          f.cgstTotal
        )} | SGST ${formatInr(f.sgstTotal)} | IGST ${formatInr(f.igstTotal)})`,
      ]);
    }
  };

  return (
    <div className="space-y-5">
      {/* Report Category Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setStatusFilter('ALL');
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-950 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters & Export Toolbar */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
              />
            </div>
            {activeTab === 'inventory' && (
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 bg-white"
                >
                  <option value="ALL">All Categories</option>
                  <option value="RAW_MATERIAL">Raw Materials</option>
                  <option value="PACKAGING_MATERIAL">Packaging Materials</option>
                  <option value="FINISHED_GOOD">Finished Products</option>
                </select>
              </div>
            )}
            {(activeTab === 'sales' || activeTab === 'inventory' || activeTab === 'purchase') && (
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 bg-white"
                >
                  <option value="ALL">All Statuses</option>
                  {activeTab === 'sales' && (
                    <>
                      <option value="SUBMITTED">Submitted</option>
                      <option value="UNDER_REVIEW">Under Review</option>
                      <option value="APPROVED">Approved</option>
                      <option value="PARTIALLY_DISPATCHED">Partially Dispatched</option>
                      <option value="DISPATCHED">Dispatched</option>
                      <option value="REJECTED">Rejected</option>
                    </>
                  )}
                  {activeTab === 'inventory' && (
                    <>
                      <option value="IN_STOCK">In Stock</option>
                      <option value="LOW_STOCK">Low Stock</option>
                      <option value="OUT_OF_STOCK">Out of Stock</option>
                    </>
                  )}
                  {activeTab === 'purchase' && (
                    <>
                      <option value="ORDERED">Ordered</option>
                      <option value="PARTIALLY_RECEIVED">Partially Received</option>
                      <option value="RECEIVED">Received</option>
                      <option value="PENDING_OWNER_APPROVAL">Pending Owner Approval</option>
                    </>
                  )}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!report}
              className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={!report}
              className="inline-flex items-center gap-1.5 rounded bg-blue-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export PDF
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading && !report ? (
        <Card>
          <div className="py-8 text-center text-xs text-slate-500">Generating report...</div>
        </Card>
      ) : (
        report && (
          <>
            {activeTab === 'sales' && (
              <Card
                title="Sales Report"
                subtitle={`${report.salesReport.totalOrders} orders · Total Value: ${formatInr(
                  report.salesReport.totalSalesValue
                )}`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Order #</th>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Customer</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                        <th className="px-4 py-2.5 font-medium text-right">Dispatched</th>
                        <th className="px-4 py-2.5 font-medium text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.salesReport.rows.map((o) => (
                        <tr key={o.id}>
                          <td className="px-4 py-2 font-semibold text-slate-900">
                            {o.orderNumber}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{o.orderDate.slice(0, 10)}</td>
                          <td className="px-4 py-2 text-slate-800">{o.customerName}</td>
                          <td className="px-4 py-2 text-slate-700">{o.status}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{o.requestedQuantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{o.dispatchedQuantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {formatInr(o.subtotal ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {activeTab === 'production' && (
              <Card
                title="Production Report"
                subtitle={`${report.productionReport.totalRuns} runs · Planned ${report.productionReport.totalPlanned} · Good ${report.productionReport.totalGoodOutput} · Rejected ${report.productionReport.totalRejected} · Wastage ${report.productionReport.totalWastage}`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Run #</th>
                        <th className="px-4 py-2.5 font-medium">Posted</th>
                        <th className="px-4 py-2.5 font-medium">Product</th>
                        <th className="px-4 py-2.5 font-medium text-right">Planned</th>
                        <th className="px-4 py-2.5 font-medium text-right">Good Output</th>
                        <th className="px-4 py-2.5 font-medium text-right">Rejected</th>
                        <th className="px-4 py-2.5 font-medium text-right">Wastage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.productionReport.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2 font-semibold text-slate-900">{r.runNumber}</td>
                          <td className="px-4 py-2 text-slate-600">{r.postedAt.slice(0, 10)}</td>
                          <td className="px-4 py-2 text-slate-800">{r.productName}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.plannedQuantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                            {r.actualOutputQuantity}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                            {r.rejectedQuantity ?? 0}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-amber-700">
                            {r.wastageQuantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {activeTab === 'inventory' && (
              <Card
                title="Inventory Report"
                subtitle={`${report.inventoryReport.totalItems} items · ${report.inventoryReport.lowStockCount} low stock · ${report.inventoryReport.outOfStockCount} out of stock`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">SKU</th>
                        <th className="px-4 py-2.5 font-medium">Name</th>
                        <th className="px-4 py-2.5 font-medium">Category</th>
                        <th className="px-4 py-2.5 font-medium text-right">Stock</th>
                        <th className="px-4 py-2.5 font-medium text-right">Reorder</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.inventoryReport.rows.map((i) => (
                        <tr key={i.id}>
                          <td className="px-4 py-2 font-mono text-[11px] text-slate-600">
                            {i.sku}
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-900">{i.name}</td>
                          <td className="px-4 py-2 text-slate-600">{i.category}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {i.availableStock} {i.unit}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                            {i.reorderLevel}
                          </td>
                          <td className="px-4 py-2 text-slate-700">{i.stockStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {activeTab === 'purchase' && (
              <Card
                title="Purchase Report"
                subtitle={`${report.purchaseReport.totalOrders} purchase orders · Total Estimated: ${formatInr(
                  report.purchaseReport.totalEstimatedValue
                )}`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">PO #</th>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Supplier</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Approval</th>
                        <th className="px-4 py-2.5 font-medium text-right">Estimated Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.purchaseReport.rows.map((po) => (
                        <tr key={po.id}>
                          <td className="px-4 py-2 font-semibold text-slate-900">{po.poNumber}</td>
                          <td className="px-4 py-2 text-slate-600">{po.orderDate.slice(0, 10)}</td>
                          <td className="px-4 py-2 text-slate-800">{po.supplierName}</td>
                          <td className="px-4 py-2 text-slate-700">{po.status}</td>
                          <td className="px-4 py-2 text-slate-700">
                            {po.approvalStatus ?? 'NOT_REQUIRED'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {formatInr(po.estimatedTotal ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {activeTab === 'outstanding' && (
              <Card
                title="Outstanding Payments Report"
                subtitle={`Total Outstanding: ${formatInr(
                  report.outstandingPaymentsReport.totalOutstanding
                )} · Overdue: ${formatInr(report.outstandingPaymentsReport.totalOverdue)}`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Code</th>
                        <th className="px-4 py-2.5 font-medium">Customer</th>
                        <th className="px-4 py-2.5 font-medium text-right">Invoiced</th>
                        <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                        <th className="px-4 py-2.5 font-medium text-right">Outstanding</th>
                        <th className="px-4 py-2.5 font-medium text-right">Overdue</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.outstandingPaymentsReport.rows.map((c) => (
                        <tr key={c.customerId}>
                          <td className="px-4 py-2 font-mono text-[11px] text-slate-600">
                            {c.customerCode}
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {c.customerName}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatInr(c.totalInvoiced)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                            {formatInr(c.totalPaid)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {formatInr(c.outstandingAmount)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                            {formatInr(c.overdueAmount)}
                          </td>
                          <td className="px-4 py-2 text-slate-700">{c.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {activeTab === 'financial' && (
              <Card
                title="Financial Summary Report"
                subtitle="Consolidated billing, collections, GST split, and verified GRN purchase expenditure"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
                  <div className="rounded border border-slate-200 p-3.5">
                    <p className="text-slate-500">Total Invoiced</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                      {formatInr(report.financialSummary.totalInvoicedAmount)}
                    </p>
                  </div>
                  <div className="rounded border border-slate-200 p-3.5">
                    <p className="text-slate-500">Total Collected</p>
                    <p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
                      {formatInr(report.financialSummary.totalAmountCollected)}
                    </p>
                  </div>
                  <div className="rounded border border-slate-200 p-3.5">
                    <p className="text-slate-500">Outstanding Receivables</p>
                    <p className="mt-1 text-lg font-bold text-rose-700 tabular-nums">
                      {formatInr(report.financialSummary.outstandingAmount)}
                    </p>
                  </div>
                  <div className="rounded border border-slate-200 p-3.5">
                    <p className="text-slate-500">GRN Purchase Expenditure</p>
                    <p className="mt-1 text-lg font-bold text-blue-900 tabular-nums">
                      {formatInr(report.financialSummary.purchaseExpenditure)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 flex flex-wrap gap-6">
                  <span>
                    Total GST Billed:{' '}
                    <strong className="text-slate-900">
                      {formatInr(report.financialSummary.gstCollected)}
                    </strong>
                  </span>
                  <span>
                    CGST:{' '}
                    <strong className="text-slate-900">
                      {formatInr(report.financialSummary.cgstTotal)}
                    </strong>
                  </span>
                  <span>
                    SGST:{' '}
                    <strong className="text-slate-900">
                      {formatInr(report.financialSummary.sgstTotal)}
                    </strong>
                  </span>
                  <span>
                    IGST:{' '}
                    <strong className="text-slate-900">
                      {formatInr(report.financialSummary.igstTotal)}
                    </strong>
                  </span>
                </div>
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}
