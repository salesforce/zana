import css from './generated.css';
if (typeof document !== 'undefined' && !document.getElementById('tasks-styles')) {
  const style = document.createElement('style'); style.id = 'tasks-styles'; style.textContent = css; document.head.append(style);
}
