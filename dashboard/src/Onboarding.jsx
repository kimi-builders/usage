import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, Check, CheckCircle2, Cloud, CloudUpload,
  HardDrive, Languages, LoaderCircle, ShieldCheck, Sparkles,
} from 'lucide-react';
import { SourceModeRows, policiesFromSources } from './DataSourceControls.jsx';
import { DeviceAuthorizationCard } from './DeviceAuthorizationCard.jsx';

function totals(snapshot) {
  const sources = snapshot?.sources || [];
  return {
    sources: sources.filter((source) => source.status !== 'skipped').length,
    buckets: sources.reduce((sum, source) => sum + Number(source.bucketCount || 0), 0),
    sessions: sources.reduce((sum, source) => sum + Number(source.sessionCount || 0), 0),
  };
}

export function Onboarding({ control, zh, onLocale, onControlAction, onScan, onSyncAction, onFinish }) {
  const [step, setStep] = useState('welcome');
  const [policies, setPolicies] = useState(() => policiesFromSources(control.sources, { detectedDefaults: !control.policyExplicit }));
  const [snapshot, setSnapshot] = useState(null);
  const [authorization, setAuthorization] = useState(control.community?.authorization || null);
  const [connected, setConnected] = useState(Boolean(control.community?.connected));
  const [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const summary = useMemo(() => totals(snapshot), [snapshot]);
  const scanCount = Object.values(policies).filter((mode) => mode !== 'off').length;
  const syncCount = Object.values(policies).filter((mode) => mode === 'private').length;
  const configureSource = (sourceId, csvPath) => onControlAction({
    action: 'configure-source', sourceId, csvPath,
  });

  const scan = async () => {
    setBusy('scan'); setError(''); setStep('scanning');
    try {
      await onControlAction({ action: 'prepare-onboarding', sourcePolicies: policies });
      const next = await onScan(true);
      setSnapshot(next); setStep('results');
    } catch (reason) {
      setError(reason?.message || String(reason)); setStep('sources');
    } finally { setBusy(''); }
  };

  const startConnection = async () => {
    setBusy('connect'); setError('');
    try {
      const next = await onControlAction({ action: 'connect-start' });
      setAuthorization(next);
      window.open(next.verificationUriComplete, '_blank', 'noopener,noreferrer');
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const cancelConnection = async () => {
    setBusy('cancel'); setError('');
    try {
      await onControlAction({ action: 'connect-cancel' });
      setAuthorization(null);
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  useEffect(() => {
    setConnected(Boolean(control.community?.connected));
    setAuthorization(control.community?.authorization || null);
  }, [control]);

  useEffect(() => {
    if (!authorization || authorization.status !== 'pending' || connected) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await onControlAction({ action: 'connect-poll' });
        if (cancelled) return;
        if (result.status === 'connected') {
          setConnected(true); setAuthorization(null);
          setStep('sync');
        } else if (['expired', 'access_denied'].includes(result.status)) {
          setAuthorization(result.community?.authorization || { ...authorization, status: result.status });
          setError(result.status === 'expired' ? (zh ? '验证码已过期，请重新连接。' : 'The code expired. Start again.') : (zh ? '设备授权已被拒绝。' : 'Device authorization was denied.'));
        } else if (result.community?.authorization) {
          setAuthorization(result.community.authorization);
        }
      } catch (reason) {
        if (!cancelled) setError(reason?.message || String(reason));
      }
    };
    const timer = window.setInterval(poll, Math.max(2, Number(authorization.interval || 5)) * 1_000);
    poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authorization, connected, onControlAction, zh]);

  const finish = async ({ keepLocalOnly = false } = {}) => {
    setBusy('finish'); setError('');
    try {
      const finalPolicies = keepLocalOnly
        ? Object.fromEntries(Object.entries(policies).map(([id, mode]) => [id, mode === 'off' ? 'off' : 'local']))
        : policies;
      await onControlAction({ action: 'complete-onboarding', sourcePolicies: finalPolicies });
      const syncSelected = Object.values(finalPolicies).includes('private');
      if (!keepLocalOnly && connected && syncSelected) await onSyncAction('sync', 15);
      if (!keepLocalOnly && connected && automatic && syncSelected) await onSyncAction('install', 15);
      await onFinish();
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  return <main className="onboarding-page">
    <header className="onboarding-topbar"><a className="brand" href="https://kimi.builders" target="_blank" rel="noreferrer"><img src="/brand/logo-tile.svg" alt=""/><span>kimi<span>.</span>builders</span><small>LOCAL</small></a><button type="button" className="ghost-btn" onClick={onLocale}><Languages size={14}/>{zh ? 'English' : '中文'}</button></header>
    <section className="onboarding-shell">
      <div className="onboarding-progress" aria-label={zh ? '设置进度' : 'Setup progress'}>{['welcome', 'sources', 'results', 'connect'].map((id, index) => <span className={['welcome', 'sources', 'scanning', 'results', 'connect', 'sync'].indexOf(step) >= ['welcome', 'sources', 'results', 'connect'].indexOf(id) ? 'active' : ''} key={id}><i>{index + 1}</i>{zh ? ['开始', '数据源', '扫描结果', '社区同步'][index] : ['Welcome', 'Sources', 'Results', 'Community'][index]}</span>)}</div>

      {step === 'welcome' ? <section className="onboarding-hero"><div className="onboarding-mark"><Sparkles size={26}/></div><p className="section-eyebrow">LOCAL USAGE CONTROL</p><h1>{zh ? '先决定读什么，再开始分析' : 'Choose what to read before analysis starts'}</h1><p>{zh ? '我们会先检测常见 Agent 是否存在，但不会立即解析历史。接下来由你选择本机扫描范围；社区连接和上传完全可选。' : 'We first detect common agents without parsing their history. You then choose the local scan scope; community connection and upload are entirely optional.'}</p><div className="onboarding-principles"><div><HardDrive size={17}/><b>{zh ? '本机数据源' : 'Local data sources'}</b><span>{zh ? '按 Agent 开关，可随时修改' : 'Per-agent controls, change anytime'}</span></div><div><CloudUpload size={17}/><b>{zh ? '远程由你控制' : 'You control remote data'}</b><span>{zh ? '明确选择后才会同步' : 'Nothing syncs until you choose it'}</span></div><div><ShieldCheck size={17}/><b>{zh ? '不读取正文' : 'No conversation content'}</b><span>{zh ? '只分析 Token、时间和计数' : 'Only tokens, timing, and counts'}</span></div></div><button type="button" className="primary-btn onboarding-primary" onClick={() => setStep('sources')}>{zh ? '开始设置' : 'Start setup'}<ArrowRight size={16}/></button></section> : null}

      {step === 'sources' ? <section className="onboarding-card"><header><div><p className="section-eyebrow">STEP 02 · DATA SOURCES</p><h2>{zh ? '选择本机扫描范围' : 'Choose local scan scope'}</h2><p>{zh ? `检测到 ${control.sources.filter((source) => source.detected).length} 个 Agent。关闭的来源不会解析，也不会进入本机统计。` : `${control.sources.filter((source) => source.detected).length} agents detected. Off sources are not parsed or included in local analytics.`}</p></div><span>{scanCount} {zh ? '个已选' : 'selected'}</span></header><SourceModeRows sources={control.sources} policies={policies} onChange={(next) => setPolicies(Object.fromEntries(Object.entries(next).map(([id, mode]) => [id, mode === 'private' ? 'local' : mode])))} onConfigure={configureSource} connected={false} zh={zh}/><footer><button type="button" className="ghost-btn" onClick={() => setStep('welcome')}>{zh ? '返回' : 'Back'}</button><button type="button" className="primary-btn" disabled={!scanCount || busy === 'scan'} onClick={scan}><BarChart3 size={15}/>{zh ? '按此范围开始扫描' : 'Scan selected agents'}<ArrowRight size={15}/></button></footer>{error ? <p className="onboarding-error">{error}</p> : null}</section> : null}

      {step === 'scanning' ? <section className="onboarding-hero onboarding-scanning"><LoaderCircle className="spin" size={34}/><p className="section-eyebrow">LOCAL SCAN</p><h2>{zh ? '正在建立你的本机用量视图' : 'Building your local usage view'}</h2><p>{zh ? `正在解析 ${scanCount} 个已选 Agent。首次扫描可能需要一点时间，页面不会把扫描结果发送到社区。` : `Parsing ${scanCount} selected agents. The first scan may take a moment; results are not sent to the community.`}</p></section> : null}

      {step === 'results' ? <section className="onboarding-card onboarding-results"><header><div><p className="section-eyebrow">STEP 03 · SCAN COMPLETE</p><h2><CheckCircle2 size={21}/>{zh ? '本机用量视图已就绪' : 'Your local usage view is ready'}</h2><p>{zh ? '这些结果目前只用于当前设备上的看板。' : 'These results are currently used only by the dashboard on this device.'}</p></div></header><div className="onboarding-result-grid"><article><strong>{summary.sources}</strong><span>{zh ? '有数据的 Agent' : 'Agents with data'}</span></article><article><strong>{summary.buckets.toLocaleString()}</strong><span>30m buckets</span></article><article><strong>{summary.sessions.toLocaleString()}</strong><span>{zh ? '会话' : 'Sessions'}</span></article></div><div className="onboarding-choice"><button type="button" className="choice-card" onClick={() => finish({ keepLocalOnly: true })}><HardDrive size={20}/><b>{zh ? '先只看本机' : 'Stay local for now'}</b><span>{zh ? '直接进入看板，以后仍可连接社区。' : 'Open the dashboard; connect later anytime.'}</span><ArrowRight size={15}/></button><button type="button" className="choice-card primary" onClick={() => setStep(connected ? 'sync' : 'connect')}><Cloud size={20}/><b>{zh ? '连接社区看板' : 'Connect community dashboard'}</b><span>{zh ? '你可以精确选择哪些 Agent 可以同步。' : 'Choose exactly which agents may sync.'}</span><ArrowRight size={15}/></button></div>{error ? <p className="onboarding-error">{error}</p> : null}</section> : null}

      {step === 'connect' ? <section className="onboarding-card onboarding-connect"><header><div><p className="section-eyebrow">STEP 04 · OPTIONAL COMMUNITY</p><h2>{zh ? '连接你的社区账户' : 'Connect your community account'}</h2><p>{zh ? '远程数据属于你：只有随后标为“本机并同步”的 Agent 会上传；你可随时停止、断开或删除当前设备的云端数据。' : 'You own the remote data. Only agents later marked “Local + sync” upload; you can stop, disconnect, or delete this device’s cloud data anytime.'}</p></div></header>{authorization ? <DeviceAuthorizationCard authorization={authorization} zh={zh} onCancel={cancelConnection} onRetry={startConnection}/> : <div className="connect-explainer"><Cloud size={24}/><div><b>{zh ? '安全设备授权' : 'Secure device authorization'}</b><p>{zh ? '无需复制 API Key。浏览器登录社区并批准当前设备，凭据只保存在 owner-only 本机配置文件中。批准连接不会自动上传；下一步仍由你选择同步范围。' : 'No API key copying. Sign in and approve this device; its credential stays in an owner-only local config file. Approval does not upload anything; you choose the sync scope next.'}</p></div><button type="button" className="primary-btn" onClick={startConnection} disabled={busy === 'connect'}>{busy === 'connect' ? <LoaderCircle className="spin" size={15}/> : <Cloud size={15}/>} {zh ? '打开浏览器连接' : 'Connect in browser'}</button></div>}<footer><button type="button" className="ghost-btn" onClick={() => finish({ keepLocalOnly: true })}>{zh ? '暂不连接' : 'Not now'}</button></footer>{error ? <p className="onboarding-error">{error}</p> : null}</section> : null}

      {step === 'sync' ? <section className="onboarding-card"><header><div><p className="section-eyebrow">STEP 04 · SYNC SCOPE</p><h2><Check size={20}/>{zh ? '已连接，选择同步范围' : 'Connected—choose sync scope'}</h2><p>{zh ? '本机扫描和社区同步彼此独立。你可以只同步一部分 Agent，未选择的仍留在本机看板。保存后会立即完成第一次增量同步。' : 'Local scanning and community sync are independent. Sync only a subset; the rest stay local. Saving performs the first incremental sync.'}</p></div></header><SourceModeRows sources={control.sources.filter((source) => source.mode !== 'off')} policies={policies} onChange={setPolicies} onConfigure={configureSource} connected zh={zh} compact/><label className="onboarding-auto-sync"><input type="checkbox" checked={automatic} disabled={syncCount === 0} onChange={(event) => setAutomatic(event.target.checked)}/><span><b>{zh ? '每 15 分钟后台同步' : 'Background sync every 15 minutes'}</b><small>{syncCount === 0 ? (zh ? '先把至少一个 Agent 设为“本机并同步”。' : 'Mark at least one agent as “Local + sync” first.') : (zh ? '使用系统后台服务；设备唤醒且联网时运行，可随时停用。' : 'Uses the system scheduler while awake and online; disable anytime.')}</small></span></label><footer><button type="button" className="ghost-btn" onClick={() => setStep('results')}>{zh ? '返回' : 'Back'}</button><button type="button" className="primary-btn" disabled={busy === 'finish'} onClick={() => finish()}>{busy === 'finish' ? <LoaderCircle className="spin" size={15}/> : <CloudUpload size={15}/>} {syncCount ? (zh ? '保存、同步并进入' : 'Save, sync, and open') : (zh ? '保持仅本机并进入' : 'Keep local and open')}</button></footer>{error ? <p className="onboarding-error">{error}</p> : null}</section> : null}
    </section>
  </main>;
}
