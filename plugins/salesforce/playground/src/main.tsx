import { createRoot } from 'react-dom/client';
import App from './App';
import { GraphPreview } from './GraphPreview';
import { ReferenceEditor } from './ReferenceEditor';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(new URLSearchParams(location.search).has('reference') ? <ReferenceEditor /> : new URLSearchParams(location.search).has('graph') ? <GraphPreview /> : <App />);
