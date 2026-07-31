import type { PayslipStatus } from '../api/types';
import { PAYSLIP_STATUS_BADGE, PAYSLIP_STATUS_LABEL } from '../api/types';

export default function PayslipStatusBadge({ status }: { status: PayslipStatus }) {
  return <span className={`badge ${PAYSLIP_STATUS_BADGE[status]}`}>{PAYSLIP_STATUS_LABEL[status]}</span>;
}
