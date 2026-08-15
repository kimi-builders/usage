import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Copy, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Embedded browsers may expose Clipboard without granting access.
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy is unavailable in this browser.');
}

function remainingLabel(seconds, zh) {
  if (seconds <= 0) return zh ? '已过期' : 'Expired';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return zh ? `${minutes}分${String(rest).padStart(2, '0')}秒后过期` : `Expires in ${minutes}:${String(rest).padStart(2, '0')}`;
}

export function DeviceAuthorizationCard({ authorization, zh, onCancel, onRetry, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const expiresAt = useMemo(() => Date.parse(authorization?.expiresAt || '') || now, [authorization?.expiresAt]);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  const terminal = seconds <= 0 || ['expired', 'access_denied'].includes(authorization?.status);

  useEffect(() => {
    if (terminal) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [terminal]);

  const copy = async () => {
    try {
      await copyText(authorization.userCode);
      setCopied(true); setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 1_500);
    }
  };

  return <div className={`device-authorization-card ${compact ? 'compact' : ''} ${terminal ? 'terminal' : ''}`}>
    <div className="device-authorization-heading">
      <div><span>{zh ? '一次性连接验证码' : 'One-time connection code'}</span><p>{terminal ? (authorization.status === 'access_denied' ? (zh ? '本次连接已被拒绝。' : 'This connection was denied.') : (zh ? '验证码已过期，不再可用。' : 'This code has expired.')) : (zh ? '在社区授权页核对并批准这台设备；批准不会自动上传数据。' : 'Verify and approve this device on the community page. Approval does not upload data.')}</p></div>
      <em><Clock3 size={12}/>{remainingLabel(seconds, zh)}</em>
    </div>
    <div className="device-authorization-code"><strong>{authorization.userCode}</strong><button type="button" onClick={copy} aria-label={zh ? '复制验证码' : 'Copy verification code'}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copyFailed ? (zh ? '复制失败' : 'Copy failed') : copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</span></button></div>
    <div className="device-authorization-actions">
      {terminal ? <button className="primary-btn" type="button" onClick={onRetry}><RefreshCw size={14}/>{zh ? '生成新验证码' : 'Generate new code'}</button> : <a className="primary-btn" href={authorization.verificationUriComplete || authorization.verificationUri} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{zh ? '打开社区授权页' : 'Open authorization page'}</a>}
      <button className="ghost-btn" type="button" onClick={onCancel}><X size={14}/>{zh ? '取消连接' : 'Cancel'}</button>
      {!terminal ? <span role="status" aria-live="polite"><LoaderCircle className="spin" size={13}/>{zh ? '等待浏览器批准' : 'Waiting for approval'}</span> : null}
    </div>
  </div>;
}
