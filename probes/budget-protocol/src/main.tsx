import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { UIMessage } from 'ai';
import { ChatProbe } from './ChatProbe.tsx';
import './probe.css';

function App() {
  const [key, setKey] = useState(() => sessionStorage.getItem('probe-key') ?? '');
  const [scenario, setScenario] = useState('text');
  const [threadId, setThreadId] = useState(() => new URL(location.href).searchParams.get('thread'));
  const [history, setHistory] = useState<{ id: string; state: string; messages: UIMessage[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    sessionStorage.setItem('probe-key', key);
    setHistory(null);
    if (!key || !threadId) return;
    const abort = new AbortController();
    void fetch(`/api/probe/model/threads/${threadId}`, { headers: { 'x-probe-key': key }, signal: abort.signal }).then(async response => {
      if (!response.ok) throw Error('History unavailable. Check the probe key and login session.');
      const data = await response.json(); setHistory(data.thread); setError('');
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [key, threadId]);
  const create = async () => {
    try {
      const response = await fetch('/api/probe/model/threads', { method: 'POST', headers: { 'x-probe-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
      if (!response.ok) throw Error('Cannot create a probe. A valid key and authenticated session are required.');
      const data = await response.json(), url = new URL(location.href); url.searchParams.set('thread', data.thread.id);
      window.history.replaceState(null, '', url); setThreadId(data.thread.id); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Probe failed'); }
  };
  return <main><h1>Cloudflare protocol probe</h1><p>Disposable validation page · Workers AI / AI SDK 7 / assistant-ui</p>
    <div className="controls"><label>Probe key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" /></label>
      <label>Scenario<select value={scenario} onChange={event => setScenario(event.target.value)}><option value="text">Text</option><option value="read">Read tool</option><option value="write">Approved write</option><option value="cancel">Cancellation</option></select></label>
      <button onClick={() => void create()} disabled={!key}>New probe</button></div>
    {error && <p role="alert">{error}</p>}
    {history?.state === 'expired' && <p role="status">Approval expired. This probe has ended; start a new probe.</p>}
    {threadId && history?.id === threadId && history.state !== 'expired' && <ChatProbe key={threadId} threadId={threadId} messages={history.messages} probeKey={key} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
