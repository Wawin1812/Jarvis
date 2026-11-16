import { capabilityLabel } from '../chat';
import type { PendingApproval } from '../types';
import { Icon } from './Icon';

export function ApprovalCard({ item, trustable, onDecide }: {
  item: PendingApproval;
  trustable: boolean;
  onDecide: (id: string, approve: boolean, remember?: boolean) => void;
}) {
  return (
    <div className="approval" role="alertdialog" aria-label="Approval required">
      <div className="approval-head">
        <Icon name="shield" />
        <div>
          <strong>{capabilityLabel(item.capability)}</strong>
          <span>requested by {item.agentId}</span>
        </div>
      </div>
      <code className="approval-detail">{item.summary}</code>
      <div className="approval-actions">
        <button type="button" className="btn primary" onClick={() => onDecide(item.id, true)}>Approve once</button>
        {trustable && <button type="button" className="btn" onClick={() => onDecide(item.id, true, true)}>Allow for 30 min</button>}
        <button type="button" className="btn danger" onClick={() => onDecide(item.id, false)}>Deny</button>
      </div>
    </div>
  );
}
