import { JarvisPanel } from './JarvisPanel';
import './App.css';

export default function App() {
  return (
    <main className="jarvis-app">
      <header>
        <div className="eyebrow">LOCAL ASSISTANT · PRIVATE BY DEFAULT</div>
        <h1>JARVIS</h1>
        <p>Authenticated commands, explicit capture, and a policy-controlled local backend.</p>
      </header>
      <JarvisPanel />
    </main>
  );
}
