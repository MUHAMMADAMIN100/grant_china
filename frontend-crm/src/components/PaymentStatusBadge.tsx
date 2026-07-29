import type { PaymentStatus } from '../api/types';
import { PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from '../api/types';

export default function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`badge ${PAYMENT_STATUS_BADGE[status]}`}>{PAYMENT_STATUS_LABEL[status]}</span>;
}
