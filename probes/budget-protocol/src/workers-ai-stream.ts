// workers-ai-provider@4.0.0 emits both dialects when Workers AI mirrors a frame.
// Remove only equivalent same-frame aliases; never deduplicate generated text.
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
  let buffered = '', mirrors = 0;
  const encode = new TextEncoder();
  const block = (value: string) => {
    const lines = value.split(/\r?\n/), data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return value;
    let frame;
    try { frame = JSON.parse(data); } catch { return value; }
    const delta = frame.choices?.[0]?.delta;
    let changed = false;
    for (const [native, openai] of [['response','content'],['tool_calls','tool_calls']]) {
      if (frame[native] == null || delta?.[openai] == null || (Array.isArray(delta[openai]) && delta[openai].length === 0)) continue;
      if (native === 'tool_calls') delta[openai] = mergeMirroredTools(frame[native], delta[openai]);
      else if (frame[native] !== delta[openai]) throw Error('Conflicting Workers AI SSE dialects');
      delete frame[native]; changed = true;
    }
    if (!changed) return value;
    mirrors++;
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
      if (mirrors) console.info('Workers AI same-frame aliases normalized', { frames: mirrors });
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
