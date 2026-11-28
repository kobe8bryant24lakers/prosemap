import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';
import { isLoopbackOrigin, parseSessionLink, serviceOrigin, sessionUrl, type SessionLink, type ServiceMode } from '@/lib/collaboration-address';
import { createSharedCopy, newRoomLink } from '@/lib/collaboration-session';
import { preferredMode, rememberSharedService, remoteServices, savedAddress } from '@/lib/collaboration-preferences';
import { useCollaborationService } from '@/lib/use-collaboration-service';
import CollaborationServiceStatus from './CollaborationServiceStatus';
import CollaborationServers from './CollaborationServers';
import SharedWorkspace from './SharedWorkspace';
import './Collaboration.css';

type Props = { current?: { title: string; markdown: string }; invitation?: string; onClose: () => void; onPending?: (value: boolean) => void };

function ConnectionForm({ current, invitation = '', onClose, enter }: Props & { enter: (link: SessionLink) => void }) {
  useLocale();
  const [joining, setJoining] = useState(!current || Boolean(invitation));
  const [mode, setMode] = useState<ServiceMode>(preferredMode);
  const [address, setAddress] = useState(() => savedAddress(mode));
  const [key, setKey] = useState('');
  const [linkInput, setLinkInput] = useState(invitation);
  const [checkedInvite, setCheckedInvite] = useState(Boolean(invitation));
  const [plaintextConfirmed, setPlaintextConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [servers, setServers] = useState(remoteServices);
  const [nearby, setNearby] = useState<string[]>([]);
  const [scan, setScan] = useState(0);
  const touched = useRef(false);
  const inviteField = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const attempt = useRef<SessionLink | null>(null);
  const dialog = useModalFocus(() => { if (!pending.current) onClose(); });
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (joining) inviteField.current?.focus({ preventScroll: true }); }, [joining]);
  let destination: SessionLink | undefined;
  let inviteError = '加入文档需要完整邀请链接，包含 #session/ 后的内容。';
  try { destination = parseSessionLink(linkInput); }
  catch (reason) {
    if (reason instanceof Error && reason.message !== '邀请链接无效，请粘贴完整链接。') {
      inviteError = reason.message;
    }
  }
  const check = useCollaborationService(configuring ? '' : joining ? destination?.origin ?? '' : address, joining && destination ? destination.mode : mode);
  const lastCheck = useRef({ origin: check.origin, status: check.status });
  useEffect(() => { lastCheck.current = { origin: check.origin, status: check.status }; }, [check.origin, check.status]);
  const canConnect = check.status === 'online' || check.status === 'legacy';
  const cleartext = check.origin.startsWith('http:');
  const targetMode = joining ? destination?.mode : mode;
  useEffect(() => {
    if (joining || configuring || mode !== 'lan' || !('__TAURI_INTERNALS__' in window)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function discover() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        if (!active) return;
        const found = await invoke<string[]>('discover_collaboration_services');
        if (!active) return;
        const origins = Array.from(new Set(found.map(value => serviceOrigin(value, 'lan'))));
        setNearby(origins);
        let remembered = false;
        try { remembered = Boolean(localStorage.getItem('prosemap.collab.lan')); } catch { /* In-memory use. */ }
        const fallback = 'http://127.0.0.1:8787';
        if (origins.length === 1 && !remembered && !touched.current
          && lastCheck.current.origin === fallback && lastCheck.current.status === 'offline') {
          setAddress(previous => previous === fallback ? origins[0] : previous);
        }
      } catch { if (active) setNearby([]); }
      if (active) timer = setTimeout(discover, 12000);
    }
    void discover();
    return () => { active = false; clearTimeout(timer); };
  }, [joining, mode, configuring, scan]);
  function chooseAddress(value: string) {
    touched.current = true;
    setAddress(value); setKey(''); setPlaintextConfirmed(false); setError('');
  }
  function switchMode(next: ServiceMode) {
    touched.current = false;
    setMode(next); setAddress(savedAddress(next)); setPlaintextConfirmed(false); setKey(''); setError('');
  }
  function settingsClosed(preferred?: string) {
    const next = remoteServices();
    setServers(next);
    if (preferred || (mode === 'remote' && servers.includes(address) && !next.includes(address))) {
      setMode('remote'); chooseAddress(preferred ?? next[0] ?? '');
    }
    setConfiguring(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    try {
      const origin = joining ? parseSessionLink(linkInput).origin : serviceOrigin(address, mode);
      if (!canConnect || (origin.startsWith('http:') && !plaintextConfirmed)) return;
      if (joining) { enter(parseSessionLink(linkInput)); return; }
      if (!current || !key.trim()) throw new Error('请输入服务创建密钥。');
      const { title, markdown } = current;
      if (new TextEncoder().encode(markdown).length > 2 * 1024 * 1024) throw new Error('共享正文不能超过 2 MB。');
      const link = attempt.current?.origin === origin && attempt.current.mode === mode ? attempt.current : newRoomLink(mode, origin);
      attempt.current = link;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      await createSharedCopy(link, key.trim(), title, markdown, controller.signal);
      if (!controller.signal.aborted) {
        rememberSharedService(mode, origin);
        enter(link);
      }
    } catch (reason) {
      if (!pending.current?.signal.aborted) setError(reason instanceof Error ? uiMessage(reason.message) : t('无法连接协作服务，请检查地址和网络。'));
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }
  const choices = mode === 'remote' ? servers : nearby;
  return <><div className="modal-backdrop"><section ref={dialog} className="collab-dialog" role="dialog" aria-modal="true" aria-labelledby="collab-title" tabIndex={-1}>
    <header><h2 id="collab-title">{current ? t('文档协作') : t('加入共享文档')}</h2><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}><X size={17}/></button></header>
    <form onSubmit={submit}>
      <div className="collab-fields">
        {current && <div className="collab-switch" role="group" aria-label={t('会话操作')}>
          <button type="button" disabled={busy} aria-pressed={!joining} onClick={() => { setJoining(false); setError(''); setPlaintextConfirmed(false); }}>{t('共享此文档')}</button>
          <button type="button" disabled={busy} aria-label={t('通过邀请加入')} aria-pressed={joining} onClick={() => { setJoining(true); setError(''); setPlaintextConfirmed(false); }}>{t('加入会话')}</button>
        </div>}
        {joining ? <>
          <label>{t('邀请链接')}<input ref={inviteField} type="url" required autoComplete="off" spellCheck={false} value={linkInput} aria-describedby="invite-detail" aria-invalid={checkedInvite && Boolean(linkInput) && !destination}
            onBlur={() => setCheckedInvite(true)} onChange={e => { setLinkInput(e.target.value); setCheckedInvite(e.target.value.includes('#session/')); setPlaintextConfirmed(false); }}/></label>
          {destination ? <p id="invite-detail" className="collab-detail">{destination.mode === 'lan' ? t('局域网服务') : t('远程服务器')} · {destination.origin}</p>
            : checkedInvite && linkInput.trim() ? <p id="invite-detail" className="collab-error" role="alert">{uiMessage(inviteError)}</p>
              : <p id="invite-detail" className="collab-summary">{t('粘贴分享者生成的完整邀请链接，在此应用中打开对应文档。')}</p>}
          <CollaborationServiceStatus check={check}/>
        </> : <>
          <p className="collab-summary">{t('将在所选服务器上创建「{0}」的独立正文副本。本地原稿、附件和 AI 对话留在本机。', current?.title ?? '')}</p>
          <label>{t('服务位置')}<select value={mode} disabled={busy} onChange={e => switchMode(e.target.value as ServiceMode)}>
            <option value="lan">{t('局域网服务')}</option><option value="remote">{t('远程服务器')}</option>
          </select></label>
          {(mode === 'remote' ? choices.length > 1 : choices.length > 0) && <label>{mode === 'lan' ? t('发现的局域网服务') : t('已配置的服务器')}
            <select value={choices.includes(address) ? address : ''} disabled={busy} onChange={e => chooseAddress(e.target.value)}>
              <option value="">{t('输入其他地址')}</option>{choices.map(origin => <option key={origin} value={origin}>{origin}</option>)}
            </select></label>}
          <div className="collab-endpoint"><label>{t('服务地址')}<input type="url" required readOnly={busy} autoComplete="off" spellCheck={false} value={address} placeholder={mode === 'remote' ? 'https://collab.example.org' : 'http://192.168.1.10:8787'} onChange={e => chooseAddress(e.target.value)} aria-describedby={mode === 'lan' && isLoopbackOrigin(address) ? 'lan-address-hint' : undefined}/></label>
            <CollaborationServiceStatus check={{ ...check, retry: () => { check.retry(); setScan(n => n + 1); } }}/>
            {mode === 'remote' && <button type="button" className="collab-text-button collab-configure" disabled={busy} onClick={() => setConfiguring(true)}>{t('配置远程服务器')}</button>}
          </div>
          {mode === 'lan' && isLoopbackOrigin(address) && <small id="lan-address-hint" className="collab-field-hint">{t('此地址仅供本机使用。要邀请其他设备，请填写宿主的局域网 IP 地址。')}</small>}
          <label>{t('创建密钥')}<input type="password" required readOnly={busy} autoComplete="off" value={key} onChange={e => { touched.current = true; setKey(e.target.value); }}/><small>{t('由服务管理员从数据目录的 create.key 提供。')}</small></label>
        </>}
        {cleartext && <label className="collab-consent"><input type="checkbox" checked={plaintextConfirmed} disabled={busy} onChange={e => { touched.current = true; setPlaintextConfirmed(e.target.checked); }}/><span>{targetMode === 'lan'
          ? t('此局域网连接使用明文。我确认只用合成测试内容。')
          : t('HTTP 会明文传输正文和访问凭据。我同意使用此连接。')}</span></label>}
        {error && <p className="collab-error" role="alert">{uiMessage(error)}</p>}
      </div>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t('取消')}</button>
        <button type="submit" className="header-primary" disabled={busy || !canConnect || (cleartext && !plaintextConfirmed)}>{busy ? t('正在创建…') : joining ? t('加入会话') : t('确认创建共享副本')}</button></footer>
    </form>
  </section></div>{configuring && <CollaborationServers initialAddress={address} onClose={settingsClosed}/>}</>;
}

export default function CollaborationFlow(props: Props) {
  const [link, setLink] = useState<SessionLink | null>(null);
  const original = useRef(location.href);
  function enter(next: SessionLink) {
    if (next.origin === location.origin) history.replaceState(null, '', sessionUrl(next));
    setLink(next);
  }
  function leave() {
    if (link?.origin === location.origin && !props.invitation) history.replaceState(null, '', original.current);
    props.onClose();
  }
  return createPortal(link ? <SharedWorkspace link={link} onClose={leave} onPending={props.onPending}/> : <ConnectionForm {...props} enter={enter}/>, document.body);
}
