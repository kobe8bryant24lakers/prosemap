import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { classHighlighter } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import { ArrowLeft, Check, Copy, Eye, FileDown, PenLine, UserRoundPlus, Users, X } from 'lucide-react';
import { t, uiMessage, setLocale } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { safeDocumentName } from '@/lib/editor';
import { useModalFocus } from '@/lib/use-modal-focus';
import { sessionUrl, type SessionLink } from '@/lib/collaboration-address';
import { SharedSession, type SessionState } from '@/lib/collaboration-session';
import MarkdownPreview from './MarkdownPreview';
import ConfirmDialog from './ConfirmDialog';

const statusText = (s: SessionState) => {
  if (s.status === 'denied') return t('此邀请已失效或没有访问权限。');
  if (s.status === 'rejected') return t('服务器未接受更改，请导出当前正文。');
  if (s.status === 'connecting') return t('正在连接协作服务…');
  if (s.status === 'offline') return s.dirty ? t('等待重连，有修改待同步') : t('连接中断，正在重连…');
  return s.dirty ? t('正在同步…') : t('已保存到服务器');
};

function SharedEditor({ session, locked }: { session: SharedSession; locked: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const subscribe = useCallback((cb: () => void) => { session.body.observe(cb); return () => session.body.unobserve(cb); }, [session]);
  const text = useSyncExternalStore(subscribe, () => session.body.toString());
  const preview = useDeferredValue(text);
  useLayoutEffect(() => {
    const undo = locked ? false : new UndoManager(session.body, { trackedOrigins: new Set() });
    const view = new EditorView({ parent: host.current!, state: EditorState.create({
      doc: session.body.toString(),
      extensions: [lineNumbers(), drawSelection(), markdown({ codeLanguages: languages }), syntaxHighlighting(classHighlighter),
        EditorView.lineWrapping, EditorState.readOnly.of(locked), EditorView.editable.of(!locked),
        EditorView.contentAttributes.of({ 'aria-label': t('共享 Markdown 正文'), role: 'textbox', 'aria-readonly': String(locked), tabindex: '0' }),
        yCollab(session.body, session.awareness, { undoManager: undo }), Prec.high(keymap.of(locked ? [] : yUndoManagerKeymap)), keymap.of(defaultKeymap)],
    }) });
    return () => { view.destroy(); if (undo) undo.destroy(); };
  }, [session, locked]);
  return <div className="shared-panes">
    <section className="editor-pane"><header className="pane-header"><span className="pane-title"><PenLine size={15}/>{t('Markdown 正文')}</span></header><div ref={host} className="editor-surface"/></section>
    <section className="preview-pane"><header className="pane-header"><span className="pane-title"><Eye size={15}/>{t('可视化预览')}</span></header>
      <div className="preview-scroll"><MarkdownPreview markdown={preview} shared/></div></section>
  </div>;
}

function CopyLink({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState('');
  async function copy() {
    input.current?.focus();
    input.current?.select();
    let success = false;
    try { await navigator.clipboard.writeText(value); success = true; }
    catch { try { success = document.execCommand('copy'); } catch { /* Selection supports manual copying. */ } }
    setCopied(success ? value : 'manual');
  }
  return <div className="collab-copy"><input ref={input} aria-label={label} readOnly value={value} spellCheck={false} onFocus={e => e.target.select()}/>
    <button type="button" className="header-button" onClick={() => void copy()} aria-label={t('复制链接') + ' · ' + label}>{copied === value ? <Check size={15}/> : <Copy size={15}/>} {copied === value ? t('已复制') : t('复制')}</button>
    {copied === 'manual' && <small role="status">{t('链接已选中，可用系统复制快捷键。')}</small>}
  </div>;
}

function Invitations({ session, state, close }: { session: SharedSession; state: SessionState; close: () => void }) {
  const dialog = useModalFocus(close);
  const locale = useLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const deadlines = Object.values(state.invites).flatMap(invite => invite && invite.expires > now ? [invite.expires] : []);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...deadlines) - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [state.invites, now]);
  return <div className="modal-backdrop"><section ref={dialog} className="collab-dialog" role="dialog" aria-modal="true" aria-labelledby="invites-heading" tabIndex={-1}>
    <header><h2 id="invites-heading">{t('管理邀请')}</h2><button className="icon-button" aria-label={t('关闭')} onClick={close}><X size={17}/></button></header>
    <div className="collab-fields"><p className="collab-summary">{t('邀请仅适用于这份文档，有效期 24 小时。撤销会断开使用该链接的参与者。')}</p>
      {(['edit', 'read'] as const).map(role => {
        const current = state.invites[role];
        const invite = current && current.expires > now ? current : null;
        const label = role === 'edit' ? t('编辑邀请') : t('只读邀请');
        return <section key={role} className="invite-row"><div><h3>{label}</h3>
          <button type="button" className="collab-text-button" disabled={state.status !== 'online'} onClick={() => session.invite(role, invite ? 'revoke' : 'issue')}>{role === 'edit' ? (invite ? t('撤销编辑邀请') : t('生成编辑邀请')) : (invite ? t('撤销只读邀请') : t('生成只读邀请'))}</button></div>
          {invite && <><CopyLink label={label} value={sessionUrl({ ...session.link, token: invite.token })}/><small>{t('到期时间 {0}', new Date(invite.expires).toLocaleString(locale))}</small></>}
        </section>;
      })}
      <details className="collab-recovery"><summary>{t('所有者恢复链接')}</summary><p>{t('私下保存此链接，以便重新进入并管理邀请。')}</p><CopyLink label={t('所有者恢复链接')} value={sessionUrl(session.link)}/></details>
    </div></section></div>;
}

export default function SharedWorkspace({ link, onClose, onPending }: { link: SessionLink; onClose: () => void; onPending?: (v: boolean) => void }) {
  const locale = useLocale();
  const [connection, setConnection] = useState<{ session: SharedSession; state: SessionState }>();
  const { session, state } = connection ?? {};
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState('');
  const dialog = useModalFocus(() => {}, undefined, { captureEscape: false });
  useEffect(() => {
    const live = new SharedSession(link, state => { setConnection({ session: live, state }); onPending?.(state.dirty); });
    live.connect();
    const warn = (event: BeforeUnloadEvent) => { if (live.state.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); live.destroy(); onPending?.(false); };
  }, [link, onPending]);
  function leave() { if (session?.state.dirty) setLeaving(true); else onClose(); }
  const showDocument = Boolean(state?.role && (state.status !== 'denied' || state.dirty));
  function blockAttachments(event: DragEvent<HTMLElement> | ClipboardEvent<HTMLElement>) {
    const transfer = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const hasFile = transfer.types.includes('Files') || transfer.files.length > 0
      || Array.from(transfer.items).some(item => item.kind === 'file')
      || (event.type !== 'dragover' && /^file:/im.test(transfer.getData('text/uri-list')));
    if (!hasFile) return;
    // CodeMirror otherwise reads dropped files as text and inserts their contents.
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'dragover') setNotice(t('共享会话只接受文本，附件保留在本机。'));
  }
  async function download() {
    if (!session?.state.role || !showDocument) return;
    const name = safeDocumentName(session.state.title) + '-shared.md';
    const content = session.body.toString();
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core');
        if (!await invoke<boolean>('export_shared_markdown', { name, content })) return;
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setNotice(t('已导出 Markdown 副本'));
    } catch (e) { setNotice(uiMessage(e instanceof Error ? e.message : String(e))); }
  }
  const locked = state?.role === 'read' || state?.status === 'denied' || state?.status === 'rejected';
  return <section ref={dialog} className="shared-workspace" role="dialog" aria-modal="true" aria-label={t('多人协作编辑会话')} tabIndex={-1}
    onDragOverCapture={blockAttachments} onDropCapture={blockAttachments} onPasteCapture={blockAttachments}>
    <header className="shared-header">
      <button type="button" className="header-button" onClick={leave}><ArrowLeft size={15}/>{t('离开会话')}</button>
      <div className="shared-identity"><h1>{showDocument && state?.title || t('多人协作编辑会话')}</h1>
        <span>{link.mode === 'lan' ? t('局域网服务') : t('远程服务器')} · {new URL(link.origin).host}</span></div>
      <select className="language-switcher" aria-label={t('界面语言')} value={locale} onChange={e => setLocale(e.target.value === 'zh-CN' ? 'zh-CN' : 'en')}><option value="en">EN</option><option value="zh-CN">中文</option></select>
      {showDocument && <button className="header-button" onClick={() => void download()}><FileDown size={15}/>{t('导出 .md')}</button>}
      {showDocument && state?.role === 'owner' && <button className="header-primary" onClick={() => setInviting(true)}><UserRoundPlus size={15}/>{t('管理邀请')}</button>}
    </header>
    {showDocument && state && session ? <>
      <div className="shared-subbar"><strong>{state.role === 'owner' ? t('所有者') : state.role === 'read' ? t('只读') : t('可编辑')}</strong>
        <span><Users size={14}/>{t('{0} 人在线', state.status === 'online' ? state.people : 0)}</span>
        <span role="status">{statusText(state)}</span></div>
      <SharedEditor session={session} locked={locked}/>
      <footer className="shared-footer">{link.origin.startsWith('http:') && <span>{link.mode === 'lan' ? t('明文局域网 · 仅限合成测试') : t('HTTP 明文连接')}</span>}
        <span>{t('此会话共享 Markdown 和 Mermaid 源码。AI 改写、画布编辑和附件仅在本地文档中可用。')}</span>
        {notice && <span role="status">{uiMessage(notice)}</span>}</footer>
    </> : <div className="shared-empty"><Users size={27}/><p role="status">{state ? statusText(state) : t('正在连接协作服务…')}</p>
      {state?.status === 'offline' && <button className="header-button" onClick={() => session?.connect()}>{t('立即重连')}</button>}</div>}
    {inviting && showDocument && state && session && <Invitations session={session} state={state} close={() => setInviting(false)}/>}
    {leaving && <ConfirmDialog title={t('离开共享会话？')} message={t('有修改尚未保存到服务器。可先导出当前正文，或等待连接恢复。')} confirmLabel={t('放弃待同步修改并离开')} cancelLabel={t('继续编辑')} destructive onConfirm={onClose} onCancel={() => setLeaving(false)}/>}
  </section>;
}
