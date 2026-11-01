'use client';

import { useEffect, useRef } from 'react';

const activeDialogs: HTMLElement[] = [];
const focusableSelector = 'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]';

function available(element: HTMLElement) {
  return element.isConnected
    && !element.matches(':disabled')
    && !element.closest('[inert], [hidden], [aria-hidden="true"]')
    && element.getClientRects().length > 0;
}

/** Own focus only while this is the top dialog; preserve each ancestor's siblings. */
export function useModalFocus(onEscape: () => void, fallbackFocus?: () => HTMLElement | null) {
  const dialogRef = useRef<HTMLElement>(null);
  // Capture before the opening render can make an underlying workbench inert.
  const openerRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const callbacksRef = useRef({ onEscape, fallbackFocus });

  useEffect(() => {
    callbacksRef.current = { onEscape, fallbackFocus };
  }, [onEscape, fallbackFocus]);

  useEffect(() => {
    const mountedDialog = dialogRef.current;
    if (!mountedDialog) return;
    const dialog: HTMLElement = mountedDialog;
    const opener = openerRef.current;
    const snapshots: Array<{ element: HTMLElement; inert: string | null }> = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        snapshots.push({ element: sibling, inert: sibling.getAttribute('inert') });
        sibling.setAttribute('inert', '');
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    activeDialogs.push(dialog);

    const ownsFocus = () => activeDialogs.at(-1) === dialog && !dialog.closest('[inert]');
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.tabIndex >= 0 && available(element));
    const focusFirst = () => (controls()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();

    function handleKeydown(event: KeyboardEvent) {
      if (!ownsFocus() || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacksRef.current.onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    function handleFocus(event: FocusEvent) {
      if (ownsFocus() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    }

    window.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('focusin', handleFocus);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      document.removeEventListener('focusin', handleFocus);
      const index = activeDialogs.lastIndexOf(dialog);
      if (index !== -1) activeDialogs.splice(index, 1);
      for (const { element, inert } of snapshots) {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
      }
      const preferred = opener && opener !== document.body && available(opener) ? opener : callbacksRef.current.fallbackFocus?.();
      // An inline opener can unmount while a nested confirmation is visible.
      // Keep focus in the surviving modal instead of falling back to the editor behind it.
      const remainingDialog = activeDialogs.filter(available).at(-1)
        ?? Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
          .filter(available).at(-1);
      const target = remainingDialog && (!preferred || !remainingDialog.contains(preferred))
        ? Array.from(remainingDialog.querySelectorAll<HTMLElement>(focusableSelector))
          .find(element => element.tabIndex >= 0 && available(element)) ?? remainingDialog
        : preferred;
      if (target && available(target)) target.focus({ preventScroll: true });
    };
  }, []);

  return dialogRef;
}
