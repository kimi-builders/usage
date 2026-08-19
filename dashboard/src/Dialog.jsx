import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const DialogLocaleContext = createContext(false);

export function DialogLocaleProvider({ zh, children }) {
  return <DialogLocaleContext.Provider value={zh}>{children}</DialogLocaleContext.Provider>;
}

export function Dialog({ open, onClose, title, subtitle, children, wide = false, method = false, className = '' }) {
  const zh = useContext(DialogLocaleContext);
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusables = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const frame = window.requestAnimationFrame(() => focusables()[0]?.focus());
    document.addEventListener('keydown', onKey);
    document.body.classList.add('dialog-open');
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('dialog-open');
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return <div className="dialog-layer" role="presentation"><section ref={dialogRef} className={`dialog ${wide ? 'dialog--wide' : ''} ${method ? 'dialog--method' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-btn" type="button" onClick={onClose} aria-label={zh ? '关闭对话框' : 'Close dialog'}><X size={18}/></button></header>{children}</section></div>;
}
