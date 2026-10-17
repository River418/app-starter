// workers-ai-provider@4.0.0 emits both dialects when Workers AI mirrors a frame.
// Remove only equal, same-frame aliases; never deduplicate generated text.
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
      if (JSON.stringify(frame[native]) !== JSON.stringify(delta[openai])) throw Error('Conflicting Workers AI SSE dialects');
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
