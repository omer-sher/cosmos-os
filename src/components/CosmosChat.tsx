import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SERVICES, TOPICS, SCENARIOS, STEPS } from '../scenarios/data';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemPrompt(): string {
  const services = SERVICES.map(s => ({
    id: s.id, name: s.name, role: s.role, desc: s.desc,
    tech: s.tech, team: s.team ?? null, repo: s.repo ?? null,
    sub: s.sub,
  }));

  const topics = TOPICS.map(t => ({
    id: t.id, name: t.name, desc: t.desc,
  }));

  const scenarios = SCENARIOS.map(sc => ({
    id: sc.id, domain: sc.domain, label: sc.label, status: sc.status, short: sc.short ?? null,
    steps: STEPS.filter(st => st.phase === sc.phaseId).map(st => ({
      from: st.from, to: st.to, via: st.via ?? null, type: st.type,
      label: st.label, plain: st.plain,
    })),
  }));

  return `You are an expert assistant for Cosmos — an interactive architecture map, currently showing the demo universe of AstroMart, a fictional space-gear e-commerce platform.

You have full knowledge of every service, Kafka topic, and data flow in the system. Answer questions about service responsibilities, connections, tech stacks, data flows, and team ownership. Be concise and precise. When describing flows, reference service names and protocols (HTTP, WebSocket, Kafka, Internal). The data below is the fictional demo dataset — treat it as the authoritative system under discussion.

## Services (${services.length})
${JSON.stringify(services, null, 2)}

## Kafka Topics (${topics.length})
${JSON.stringify(topics, null, 2)}

## Scenarios & Flows (${scenarios.length})
${JSON.stringify(scenarios, null, 2)}`;
}

function getApiKey(): string | null {
  return (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? null;
}

export function CosmosChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const systemPrompt = useRef(buildSystemPrompt());

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const key = getApiKey();
    if (!key) {
      setMessages(prev => [...prev, { role: 'user', content: text }, {
        role: 'assistant',
        content: 'No API key found. Add VITE_ANTHROPIC_API_KEY to your .env.local file.',
      }]);
      setInput('');
      return;
    }

    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setStreamText('');

    try {
      let full = '';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          stream: true,
          system: systemPrompt.current,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) throw new Error(`API error ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              full += evt.delta.text;
              flushSync(() => setStreamText(full));
            }
          } catch { /* incomplete JSON chunk — skip */ }
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: full }]);
      setStreamText('');
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const noKey = !import.meta.env.VITE_ANTHROPIC_API_KEY;

  return (
    <>
      <button
        className="lc-chat-trigger"
        onClick={() => setOpen(v => !v)}
        aria-label="Ask about the cosmos"
        title="Ask about the cosmos"
        data-open={open ? 'true' : 'false'}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3C7.03 3 3 6.58 3 11c0 2.07.87 3.95 2.29 5.35L4 21l4.65-1.29A9.38 9.38 0 0 0 12 20c4.97 0 9-3.58 9-8s-4.03-8-9-8Z" fill="currentColor" opacity=".9"/>
        </svg>
      </button>

      {open && (
        <div className="lc-chat-panel" data-no-pan="true">
          <div className="lc-chat-header">
            <span className="lc-chat-title">Ask the Cosmos</span>
            <button className="lc-chat-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="lc-chat-body">
            {messages.length === 0 && !streamText && (
              <div className="lc-chat-empty">
                {noKey
                  ? <span>Add <code>VITE_ANTHROPIC_API_KEY</code> to <code>.env.local</code> to start chatting.</span>
                  : <span>Ask anything about the platform — services, flows, tech stack, team ownership…</span>
                }
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`lc-chat-msg lc-chat-msg--${m.role}`}>
                <div className="lc-chat-bubble lc-chat-bubble--md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
              </div>
            ))}
            {streamText && (
              <div className="lc-chat-msg lc-chat-msg--assistant">
                <div className="lc-chat-bubble lc-chat-bubble--md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown><span className="lc-chat-cursor" /></div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="lc-chat-footer">
            <textarea
              ref={inputRef}
              className="lc-chat-input"
              placeholder="Ask about the cosmos…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={loading}
            />
            <button
              className="lc-chat-send"
              onClick={send}
              disabled={loading || !input.trim()}
              aria-label="Send"
            >
              {loading ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
