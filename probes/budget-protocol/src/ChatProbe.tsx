import { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import { AssistantRuntimeProvider, AuiConfig, Tools, defineToolkit, ThreadPrimitive, MessagePrimitive, ComposerPrimitive, type ToolApprovalResponse } from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/ai-sdk';

const toolkit = defineToolkit({
  readSetting: { type: 'backend', render: ({ result }) => <pre data-testid="read-result">{JSON.stringify(result)}</pre> },
  writeSetting: { type: 'backend', render: function WriteProposal({ args, approval, respondToApproval, result }) {
    const [error, setError] = useState('');
    const answer = async (decision: ToolApprovalResponse) => { try { await respondToApproval(decision); } catch { setError('Approval failed; retry after the stream finishes.'); } };
    if (approval && approval.approved === undefined && approval.resolution === undefined) return <div className="approval"><p>Proposed value: {JSON.stringify(args)}</p><button onClick={() => void answer({ approved: true })}>Approve</button><button onClick={() => void answer({ approved: false, reason: 'User denied' })}>Deny</button>{error && <p role="alert">{error}</p>}</div>;
    if (approval?.approved === false) return <p data-testid="write-denied">Denied</p>;
    return <pre data-testid="write-result">{JSON.stringify(result) ?? 'Waiting for tool result'}</pre>;
  } },
});
const config = AuiConfig({ tools: Tools({ toolkit }) });

export function ChatProbe({ threadId, messages, probeKey }: { threadId: string; messages: UIMessage[]; probeKey: string }) {
  const [cancelError, setCancelError] = useState('');
  const transport = useMemo(() => new DefaultChatTransport({ api: `/api/probe/model/chat/${threadId}`, headers: { 'x-probe-key': probeKey } }), [threadId, probeKey]);
  const chat = useChat({ id: threadId, messages, transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses });
  const runtime = useAISDKRuntime(chat);
  const cancel = async () => { try { const response = await fetch(`/api/probe/model/threads/${threadId}/cancel`, { method: 'POST', headers: { 'x-probe-key': probeKey } }); if (!response.ok) throw Error('Cancellation failed'); } catch { setCancelError('Cancellation acknowledgement unavailable.'); } };
  return <AssistantRuntimeProvider runtime={runtime} config={config}>
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="transcript">
        <ThreadPrimitive.Messages>{({ message }) => <MessagePrimitive.Root className="message" data-role={message.role}><strong>{message.role}</strong><div className="message-content"><MessagePrimitive.Parts /></div></MessagePrimitive.Root>}</ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input aria-label="Message" placeholder="Send a validation request" />
        <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
        <ComposerPrimitive.Cancel onClick={() => void cancel()}>Stop</ComposerPrimitive.Cancel>
      </ComposerPrimitive.Root>
      {chat.error && <p role="alert">{chat.error.message}</p>}
      {cancelError && <p role="alert">{cancelError}</p>}
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}
