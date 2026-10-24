'use client';

import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmDialogProps = ConfirmationRequest & {
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = t("继续"),
  cancelLabel = t("取消"),
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useLocale();
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalFocus(onCancel, () => document.querySelector<HTMLElement>('.cm-content'));

  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="confirmation-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <header>
          <span className="confirmation-icon"><AlertTriangle size={19} /></span>
          <div>
            <h2 id={titleId}>{uiMessage(title)}</h2>
            <p id={messageId}>{uiMessage(message)}</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={t("关闭确认对话框")}><X size={17} /></button>
        </header>
        <footer>
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel}>{uiMessage(cancelLabel)}</button>
          <button type="button" className={`confirmation-submit${destructive ? ' destructive' : ''}`} onClick={onConfirm}>{uiMessage(confirmLabel)}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
