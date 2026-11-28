import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';
import { configureRemoteService, remoteServices } from '@/lib/collaboration-preferences';
import { useCollaborationService } from '@/lib/use-collaboration-service';
import CollaborationServiceStatus from './CollaborationServiceStatus';
import './Collaboration.css';

export default function CollaborationServers({ onClose, initialAddress = '' }: { onClose: (preferred?: string) => void; initialAddress?: string }) {
  useLocale();
  const [servers, setServers] = useState(remoteServices);
  const [address, setAddress] = useState(initialAddress || servers[0] || '');
  const [error, setError] = useState('');
  const check = useCollaborationService(address, 'remote');
  const dialog = useModalFocus(() => onClose());
  function save(event: FormEvent) {
    event.preventDefault();
    try { onClose(configureRemoteService(address, 'prefer')[0]); }
    catch (reason) { setError((reason as Error).message); }
  }
  function remove(origin: string) {
    try {
      const next = configureRemoteService(origin, 'remove');
      setServers(next);
      if (address === origin) setAddress(next[0] ?? '');
      setError('');
    } catch (reason) { setError((reason as Error).message); }
  }
  return createPortal(<div className="modal-backdrop collab-settings-backdrop"><section ref={dialog} className="collab-dialog" role="dialog" aria-modal="true" aria-labelledby="collab-server-title" tabIndex={-1}>
    <header><h2 id="collab-server-title">{t('远程协作服务器')}</h2><button className="icon-button" type="button" onClick={() => onClose()} aria-label={t('关闭')}><X size={17}/></button></header>
    <form onSubmit={save}><div className="collab-fields">
      <label>{t('服务地址（HTTP 或 HTTPS）')}<input type="url" autoComplete="off" spellCheck={false} required value={address} placeholder="https://collab.example.org" onChange={e => { setAddress(e.target.value); setError(''); }}/></label>
      <CollaborationServiceStatus check={check}/>
      <p className="collab-summary">{t('服务器地址保存在此设备。共享时使用默认地址，加入时使用邀请中的地址。')}</p>
      {servers.length > 0 && <div className="collab-server-list"><h3>{t('已配置的服务器')}</h3><ul>{servers.map((origin, index) =>
        <li key={origin}><button type="button" className="collab-server-address" onClick={() => setAddress(origin)}>{origin}</button>
          {index === 0 && <small>{t('默认')}</small>}
          <button type="button" className="icon-button" aria-label={t('移除服务器 {0}', origin)} title={t('移除服务器 {0}', origin)} onClick={() => remove(origin)}><Trash2 size={15}/></button>
        </li>)}</ul></div>}
      {error && <p role="alert" className="collab-error">{uiMessage(error)}</p>}
    </div><footer><button className="secondary-button" type="button" onClick={() => onClose()}>{t('关闭')}</button>
      <button className="header-primary" type="submit" disabled={!check.origin}>{t('保存为默认服务器')}</button></footer></form>
  </section></div>, document.body);
}
