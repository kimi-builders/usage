import { AlertCircle, CircleSlash2, Info, LoaderCircle, ShieldCheck } from 'lucide-react';

export function Button({ children, variant = 'ghost', iconOnly = false, className = '', ...props }) {
  const classes = [variant === 'primary' ? 'primary-btn' : 'ghost-btn', iconOnly ? 'icon-btn' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={classes} {...props}>{children}</button>;
}

export function PageState({ kind = 'empty', title, body, action, compact = false, className = '' }) {
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'error' ? AlertCircle : kind === 'evidence' ? ShieldCheck : CircleSlash2;
  return <section className={`status-state status-state--${kind}${compact ? ' status-state--compact' : ''} ${className}`} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'loading' ? 'polite' : undefined}>
    <span className="status-state__icon"><Icon className={kind === 'loading' ? 'spin' : ''} size={20}/></span>
    <div><h2>{title}</h2><p>{body}</p></div>
    {action ? <div className="status-state__action">{action}</div> : null}
  </section>;
}

export function EvidenceNote({ title, children, tone = 'neutral', className = '' }) {
  const Icon = tone === 'warning' ? AlertCircle : tone === 'info' ? Info : ShieldCheck;
  return <section className={`evidence-note evidence-note--${tone} ${className}`}>
    <Icon size={16}/><div><b>{title}</b><p>{children}</p></div>
  </section>;
}
