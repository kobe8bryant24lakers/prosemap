'use client';

import { X } from 'lucide-react';
import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';

export default function ModelLoadDialog({ error, onClose, onRetry }: { error: string | null; onClose: () => void; onRetry: () => void }) {
  useLocale();
  const dialogRef = useModalFocus(onClose);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-label={t('读取模型配置')} tabIndex={-1}>
      <header className="settings-header">
        <div><h2>{t('读取模型配置')}</h2><p>{t('当前已保存的配置不会被修改。')}</p></div>
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('关闭模型配置')}><X size={18} /></button>
      </header>
      <div className="settings-body">
        <p role="status">{error ? uiMessage(error) : t('正在读取本机模型配置…')}</p>
        <p>{t('你可以关闭此窗口继续编辑文档，稍后再查看。')}</p>
      </div>
      <footer className="settings-footer">
        <button type="button" className="secondary-button" onClick={onClose}>{t('关闭')}</button>
        {error && <button type="button" className="confirm-button" onClick={onRetry}>{t('重新读取')}</button>}
      </footer>
    </section>
  </div>;
}
