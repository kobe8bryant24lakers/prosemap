'use client';

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
  confirmLabel = '继续',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [onCancel]);

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
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <header>
          <span className="confirmation-icon"><AlertTriangle size={19} /></span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={messageId}>{message}</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="关闭确认对话框"><X size={17} /></button>
        </header>
        <footer>
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`confirmation-submit${destructive ? ' destructive' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
