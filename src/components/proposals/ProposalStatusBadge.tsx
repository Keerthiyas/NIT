import type { ProductProposalStatus } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';

const STATUS_META: Record<
  ProductProposalStatus,
  {
    label: string;
    tone: 'neutral' | 'amber' | 'blue' | 'navy' | 'success' | 'danger';
  }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_PRODUCTION_VERIFICATION: {
    label: 'Pending Production Verification',
    tone: 'amber',
  },
  PRODUCTION_VERIFIED: { label: 'Production Verified', tone: 'blue' },
  PENDING_ACCOUNTANT_VERIFICATION: {
    label: 'Pending Accountant Verification',
    tone: 'amber',
  },
  ACCOUNTANT_VERIFIED: { label: 'Accountant Verified', tone: 'blue' },
  PENDING_OWNER_APPROVAL: { label: 'Pending Owner Approval', tone: 'navy' },
  RETURNED_FOR_CORRECTION: { label: 'Returned for Correction', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  APPROVED_PENDING_REGISTRATION: {
    label: 'Approved - Pending Catalogue Registration',
    tone: 'success',
  },
  CATALOGUE_REGISTERED: { label: 'Catalogue Registered', tone: 'blue' },
  ACTIVE: { label: 'Active', tone: 'success' },
};

export function ProposalStatusBadge({ status }: { status: ProductProposalStatus }) {
  const cfg = STATUS_META[status] ?? { label: status, tone: 'neutral' as const };
  return <ToneBadge tone={cfg.tone}>{cfg.label}</ToneBadge>;
}
