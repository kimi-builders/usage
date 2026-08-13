import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ToolGlyph } from './tool-glyphs.js';

// Single-select account dropdown styled after the Usage Center dimension
// filter (bordered trigger + floating menu). Replaces the old horizontally
// scrolling provider strips. Keyboard: ArrowUp/Down on the trigger opens the
// menu, arrows rove focus between options, Enter/Space selects, Escape closes
// and returns focus to the trigger. The trigger carries the active provider's
// tab id so tabpanels keep a valid aria-labelledby target.
export function ProviderSelect({ providers, activeId, onChange, zh, ariaLabel, tabIdFor, controlsId, statusFor, renderIcon }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const optionRefs = useRef([]);
  const icon = renderIcon || ((id, size) => <ToolGlyph id={id} size={size}/>);
  const activeIndex = providers.findIndex((provider) => provider.id === activeId);
  const active = activeIndex >= 0 ? providers[activeIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[Math.max(0, activeIndex)]?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  const statusOf = (provider) => statusFor?.(provider) || null;
  const renderStatus = (provider) => {
    const status = statusOf(provider);
    return status ? <small data-tone={status.tone || 'amber'}>{status.label}</small> : null;
  };
  const closeToTrigger = () => {
    setOpen(false);
    rootRef.current?.querySelector('.provider-select-trigger')?.focus();
  };
  const onTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };
  const onOptionKeyDown = (event, index) => {
    if (event.key === 'Escape') { event.preventDefault(); closeToTrigger(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    let next = null;
    if (event.key === 'ArrowDown') next = (index + 1) % providers.length;
    if (event.key === 'ArrowUp') next = (index - 1 + providers.length) % providers.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = providers.length - 1;
    if (next == null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };

  return <div className="provider-select" ref={rootRef}>
    <button type="button" className="dimension-trigger provider-select-trigger" id={active ? tabIdFor?.(active.id) : undefined}
      aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} aria-controls={controlsId}
      onClick={() => setOpen((value) => !value)} onKeyDown={onTriggerKeyDown}>
      <span className="provider-select-value">{active ? <>{icon(active.id, 14)}<b>{active.label}</b>{renderStatus(active)}</> : <b>{zh ? '未启用账户' : 'No account enabled'}</b>}</span>
      <ChevronDown size={12}/>
    </button>
    {open ? <div className="dimension-menu provider-select-menu" role="listbox" aria-label={ariaLabel}>
      <div className="provider-select-options">
        {providers.map((provider, index) => {
          const selected = provider.id === activeId;
          return <button type="button" role="option" aria-selected={selected} key={provider.id}
            className="provider-select-option" tabIndex={-1}
            ref={(node) => { optionRefs.current[index] = node; }}
            onClick={() => { onChange(provider.id); setOpen(false); }}
            onKeyDown={(event) => onOptionKeyDown(event, index)}>
            {icon(provider.id, 14)}<span className="provider-select-name">{provider.label}</span>{renderStatus(provider)}{selected ? <Check size={13}/> : null}
          </button>;
        })}
      </div>
    </div> : null}
  </div>;
}
