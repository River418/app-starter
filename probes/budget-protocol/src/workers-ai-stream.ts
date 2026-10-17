// workers-ai-provider@4.0.0 emits both dialects when Workers AI mirrors a frame.
// Select the OpenAI text dialect when present; validate mirrored tool inputs.
// Never deduplicate generated text across frames.
interface ToolFragment { id?: string; index?: number; type?: string; name?: string; arguments?: string; function?: { name?: string; arguments?: string } }
function mergeMirroredTools(left: ToolFragment[], right: ToolFragment[]) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) throw Error('Conflicting Workers AI SSE dialects');
  return right.map((b, i) => {
    const a = left[i];
    if (![a.type,b.type].every(t => t == null || t === 'function') || (a.index ?? i) !== (b.index ?? i)
      || (a.id != null && b.id != null && a.id !== b.id)
      || (a.function?.name ?? a.name) !== (b.function?.name ?? b.name)
      || (a.function?.arguments ?? a.arguments) !== (b.function?.arguments ?? b.arguments)) throw Error('Conflicting Workers AI SSE dialects');
    return { ...b, ...(a.id != null && b.id == null ? { id: a.id } : {}), ...(a.index != null && b.index == null ? { index: a.index } : {}) };
  });
}
export function normalizeWorkersAIStream(stream: ReadableStream<Uint8Array>) {
  let buffered = '', selected = 0, textDifferences = 0;
  const encode = new TextEncoder();
  const block = (value: string) => {
    const lines = value.split(/\r?\n/), data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return value;
    let frame;
    try { frame = JSON.parse(data); } catch { return value; }
    const delta = frame.choices?.[0]?.delta;
    let changed = false;
    if (frame.response != null && typeof delta?.content === 'string') {
      textDifferences += Number(frame.response !== delta.content);
      delete frame.response; changed = true;
    }
    if (Array.isArray(frame.tool_calls) && frame.tool_calls.length && Array.isArray(delta?.tool_calls) && delta.tool_calls.length) {
      delta.tool_calls = mergeMirroredTools(frame.tool_calls, delta.tool_calls);
      delete frame.tool_calls; changed = true;
    }
    if (!changed) return value;
    selected++;
    return [...lines.filter(l => !l.startsWith('data:')), `data: ${JSON.stringify(frame)}`].join('\n');
  };
  return stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, Uint8Array>({
    transform(chunk, target) {
      buffered += chunk;
      let delimiter;
      while ((delimiter = /\r?\n\r?\n/.exec(buffered))) {
        target.enqueue(encode.encode(block(buffered.slice(0, delimiter.index)) + '\n\n'));
        buffered = buffered.slice(delimiter.index + delimiter[0].length);
      }
    },
    flush(target) {
      if (buffered) target.enqueue(encode.encode(block(buffered)));
      if (selected) console.info('Workers AI SSE dialect selected', { frames: selected, textDifferences });
    },
  }));
}

export function normalizedBinding(binding: Ai): Ai {
  return new Proxy(binding, { get(target, key) {
    if (key !== 'run') return Reflect.get(target, key);
    return async (...args: unknown[]) => {
      const result = await Reflect.apply(target.run, target, args);
      return result instanceof ReadableStream ? normalizeWorkersAIStream(result) : result;
    };
  } });
}
