/**
 * Decimal-safe integer arithmetic helpers for SQLite persistence.
 * - Money is stored in paise (1 INR = 100 paise).
 * - Quantities are stored in 1/10,000th units (1 unit = 10,000 scaled units).
 * - GST rates are stored in basis points (5% = 500 bps, 18% = 1800 bps).
 */

export const QTY_SCALE = 10000;
export const MONEY_SCALE = 100;

export function toScaledQty(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Quantity must be a finite number.');
  }
  const scaled = Math.round(value * QTY_SCALE);
  if (scaled < 0) {
    throw new Error('Quantity cannot be negative.');
  }
  return scaled;
}

export function fromScaledQty(scaled: number): number {
  return Math.round(scaled) / QTY_SCALE;
}

export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error('Amount must be a finite number.');
  }
  const paise = Math.round(rupees * MONEY_SCALE);
  if (paise < 0) {
    throw new Error('Amount cannot be negative.');
  }
  return paise;
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / MONEY_SCALE;
}

export function toGstBps(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('GST rate must be between 0% and 100%.');
  }
  return Math.round(percent * 100);
}

export function fromGstBps(bps: number): number {
  return Math.round(bps) / 100;
}

/**
 * Computes line taxable amount in paise from scaled quantity and unit price in paise.
 */
export function calcTaxablePaise(qtyScaled: number, unitPricePaise: number): number {
  return Math.round((qtyScaled * unitPricePaise) / QTY_SCALE);
}

/**
 * Computes GST breakup in integer paise using place-of-supply rules.
 * Intra-state (Tamil Nadu) splits into CGST + SGST; inter-state uses IGST.
 */
export function calcGstPaise(
  taxablePaise: number,
  gstRateBps: number,
  supplyType: 'INTRA_STATE' | 'INTER_STATE'
): { cgstPaise: number; sgstPaise: number; igstPaise: number; totalGstPaise: number } {
  const totalGstPaise = Math.round((taxablePaise * gstRateBps) / 10000);
  if (supplyType === 'INTER_STATE') {
    return {
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: totalGstPaise,
      totalGstPaise,
    };
  }
  const cgstPaise = Math.floor(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise;
  return {
    cgstPaise,
    sgstPaise,
    igstPaise: 0,
    totalGstPaise,
  };
}

