import { ZanaIcon } from './icons/ZanaIcon.js';
import './conversation-welcome.css';

export function ConversationWelcome({ heading: Heading }: { heading: 'h1' | 'h2' }) {
  return (
    <div className="conversation-welcome">
      <ZanaIcon size={48} />
      <Heading>What shall we work on today?</Heading>
      <p>Bring a question, a rough idea, or something to get done.</p>
    </div>
  );
}
