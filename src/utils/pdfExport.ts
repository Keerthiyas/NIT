import type { CustomerReceivableSummary, Invoice } from '../types/orderAudit';

function sanitizePdfText(text: string): string {
  // Replace Rupee symbol with INR for WinAnsi/Helvetica compatibility in standard PDF 1.4 Type1 fonts
  return text
    .replace(/₹/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdfBlob(pagesLines: string[][]): Blob {
  const objects: string[] = [];
  const pageIds: number[] = [];

  // Object 1: Catalog, Object 2: Pages (placeholder), Object 3: Font Courier, Object 4: Font Courier-Bold
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(''); // placeholder for 2 0 obj
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj\n');

  let nextId = 5;
  for (const lines of pagesLines) {
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);

    const streamOps: string[] = ['BT', '/F1 9 Tf', '40 800 Td', '13 TL'];
    lines.forEach((line, idx) => {
      const safe = sanitizePdfText(line);
      if (idx === 0) {
        streamOps.push('/F2 11 Tf');
        streamOps.push(`(${safe}) Tj`);
        streamOps.push('/F1 9 Tf');
      } else {
        streamOps.push(`T* (${safe}) Tj`);
      }
    });
    streamOps.push('ET');
    const stream = streamOps.join('\n');

    objects.push(
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
  }

  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadLinesAsPdf(filename: string, title: string, lines: string[]): void {
  const allLines = [title, '='.repeat(Math.min(82, title.length + 4)), '', ...lines];
  const pages: string[][] = [];
  const linesPerPage = 54;
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push(allLines.slice(i, i + linesPerPage));
  }
  const blob = buildPdfBlob(pages.length > 0 ? pages : [[title]]);
  triggerDownload(filename.endsWith('.pdf') ? filename : `${filename}.pdf`, blob);
}

export function downloadInvoicePdf(inv: Invoice): void {
  const lines: string[] = [
    `${inv.businessProfile.name}`,
    `${inv.businessProfile.address}`,
    `GSTIN: ${inv.businessProfile.gstin} | State: ${inv.businessProfile.state} (${inv.businessProfile.stateCode})`,
    '-'.repeat(84),
    `Invoice No  : ${inv.invoiceNumber}            Date: ${inv.invoiceDate}`,
    `Order No    : ${inv.orderNumber}            Dispatch: ${inv.dispatchNumber}`,
    `Status      : ${inv.paymentStatus}            Due Date: ${inv.dueDate || '-'}`,
    '-'.repeat(84),
    `Bill To     : ${inv.customerName} (${inv.customerCode})`,
    `Address     : ${inv.billingAddress}`,
    `Customer GST: ${inv.customerGstin || 'Unregistered / Consumer'}`,
    `Place Supply: ${inv.placeOfSupplyState} (${inv.supplyType === 'INTRA_STATE' ? 'Intra-State CGST+SGST' : 'Inter-State IGST'})`,
    '-'.repeat(84),
    'Item                   HSN      Qty       Rate      Taxable     GST%      Total',
    '-'.repeat(84),
  ];

  for (const l of inv.lines) {
    const name = l.productName.slice(0, 20).padEnd(21, ' ');
    const hsn = l.hsnCode.slice(0, 8).padEnd(9, ' ');
    const qty = `${l.quantity} ${l.unit}`.slice(0, 9).padStart(9, ' ');
    const rate = l.unitPrice.toFixed(2).padStart(9, ' ');
    const taxb = l.taxableAmount.toFixed(2).padStart(11, ' ');
    const gstp = `${l.gstRate}%`.padStart(7, ' ');
    const tot = l.totalAmount.toFixed(2).padStart(11, ' ');
    lines.push(`${name}${hsn}${qty}${rate}${taxb}${gstp}${tot}`);
  }

  lines.push('-'.repeat(84));
  lines.push(`Taxable Value : INR ${inv.taxableAmount.toFixed(2)}`);
  if (inv.supplyType === 'INTRA_STATE') {
    lines.push(`CGST          : INR ${inv.cgstAmount.toFixed(2)}`);
    lines.push(`SGST          : INR ${inv.sgstAmount.toFixed(2)}`);
  } else {
    lines.push(`IGST          : INR ${inv.igstAmount.toFixed(2)}`);
  }
  lines.push(`Grand Total   : INR ${inv.totalAmount.toFixed(2)}`);
  lines.push(`Amount Paid   : INR ${inv.amountReceived.toFixed(2)}`);
  lines.push(`Balance Due   : INR ${inv.outstandingBalance.toFixed(2)}`);
  lines.push('-'.repeat(84));
  lines.push(`Generated by: ${inv.createdBy}`);

  downloadLinesAsPdf(`${inv.invoiceNumber}.pdf`, `TAX INVOICE - ${inv.invoiceNumber}`, lines);
}

export function downloadCustomerStatementPdf(rec: CustomerReceivableSummary): void {
  const lines: string[] = [
    `Customer: ${rec.customerName} (${rec.customerCode})`,
    `State   : ${rec.state}   |   GSTIN: ${rec.customerGstin || 'Unregistered'}`,
    `Address : ${rec.billingAddress}`,
    '-'.repeat(84),
    `Total Invoiced: INR ${rec.totalInvoiced.toFixed(2)}   |   Total Paid: INR ${rec.totalPaid.toFixed(2)}`,
    `Outstanding   : INR ${rec.outstandingAmount.toFixed(2)}   |   Overdue: INR ${rec.overdueAmount.toFixed(2)}`,
    '-'.repeat(84),
    'INVOICES:',
  ];

  for (const inv of rec.invoices) {
    lines.push(
      `  ${inv.invoiceNumber} | ${inv.invoiceDate} | Total INR ${inv.totalAmount.toFixed(2)} | Paid INR ${inv.amountReceived.toFixed(2)} | Bal INR ${inv.outstandingBalance.toFixed(2)} | ${inv.paymentStatus}`
    );
  }

  lines.push('', 'PAYMENTS:');
  if (rec.payments.length === 0) {
    lines.push('  No payments recorded.');
  } else {
    for (const p of rec.payments) {
      lines.push(
        `  ${p.paymentNumber} | ${p.paymentDate} | ${p.paymentMode} | INR ${p.amount.toFixed(2)} | Inv: ${p.invoiceNumber || '-'}`
      );
    }
  }

  downloadLinesAsPdf(
    `Statement-${rec.customerCode}.pdf`,
    `CUSTOMER ACCOUNT STATEMENT - ${rec.customerName}`,
    lines
  );
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  triggerDownload(
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
    new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  );
}
