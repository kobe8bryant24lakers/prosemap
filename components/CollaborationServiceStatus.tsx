import { RefreshCw } from 'lucide-react';
import { t, uiMessage } from '@/lib/i18n';
import type { useCollaborationService } from '@/lib/use-collaboration-service';

const messages = {
  checking: '正在检测服务…',
  online: 'ProseMap 服务在线',
  offline: '无法连接。请检查服务是否已启动、地址和网络。',
  'mixed-content': '此 HTTPS 页面无法连接 HTTP 服务。请使用 ProseMap 桌面端，或打开该服务的 HTTP 页面。',
  'wrong-mode': '服务位置不匹配。请检查局域网或远程模式。',
  incompatible: '此地址未提供兼容的 ProseMap 协作服务。',
  legacy: '此服务未提供状态检测，可继续尝试现有共享或邀请。',
};

export default function CollaborationServiceStatus({ check }: { check: ReturnType<typeof useCollaborationService> }) {
  if (check.status === 'idle') return check.error ? <small role="status" className="collab-error">{uiMessage(check.error)}</small> : null;
  return <div className="collab-service-status">
    <span role="status"><i data-status={check.status} aria-hidden="true"/>{t(messages[check.status])}</span>
    {check.status !== 'mixed-content' && <button type="button" className="collab-text-button" onClick={check.retry} disabled={check.status === 'checking'}
      aria-label={t('重新检测服务')} title={t('重新检测服务')}><RefreshCw size={14} aria-hidden="true"/></button>}
  </div>;
}
