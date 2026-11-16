import { useEffect, useRef } from 'react';
import type { ChatMessage, OrbState } from '../types';
import { Orb } from './Orb';

const SUGGESTIONS = [
  'What do my documents say about my trip?',
  'What is in my workspace folder?',
  'Search the web for today\'s tech news',
  'Remember that I prefer short answers',
];

export function ChatThread({ messages, live, liveSpeaker, phase, orb, onSuggest }: {
  messages: ChatMessage[];
  live: string;
  liveSpeaker: string;
  phase: string;
  orb: OrbState;
  onSuggest: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, live, phase]);

  const conversational = messages.some((message) => message.role === 'user' || message.role === 'jarvis');

  return (
    <div className="thread" role="log" aria-live="polite" aria-label="Conversation">
      {!conversational && (
        <div className="thread-empty">
          <Orb state={orb} size="lg" />
          <h2>How can I help?</h2>
          <p>Everything runs on this Mac. I ask before I touch your files, the web or your apps.</p>
          <div className="chips">
            {SUGGESTIONS.map((text) => <button key={text} type="button" className="chip" onClick={() => onSuggest(text)}>{text}</button>)}
          </div>
        </div>
      )}
      {messages.map((message) => (
        message.role === 'system'
          ? <div key={message.id} className="bubble-system">{message.text}</div>
          : (
            <div key={message.id} className={`bubble-row ${message.role === 'user' ? 'is-user' : ''}`}>
              <div className={`bubble bubble-${message.role}`}>
                {message.role !== 'user' && message.speaker && <span className="speaker">{message.speaker}</span>}
                <p>{message.text}</p>
              </div>
            </div>
          )
      ))}
      {live && (
        <div className="bubble-row">
          <div className="bubble bubble-jarvis is-live">
            <span className="speaker">{liveSpeaker}</span>
            <p>{live}<span className="caret" aria-hidden="true" /></p>
          </div>
        </div>
      )}
      {phase && !live && (
        <div className="bubble-row">
          <div className="bubble bubble-jarvis is-thinking" role="status">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            <span>{phase}</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
