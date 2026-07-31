import type { ContractStatus } from '../api/types';
import { CONTRACT_STATUS_BADGE, CONTRACT_STATUS_LABEL } from '../api/types';

export default function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <span className={`badge ${CONTRACT_STATUS_BADGE[status]}`}>{CONTRACT_STATUS_LABEL[status]}</span>;
}
