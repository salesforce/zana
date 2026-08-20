import { useEffect, useState } from 'react';
import { FolderKanban, Monitor, RefreshCw, ShieldCheck } from 'lucide-react';
import { loadBrowserBootstrap, type BrowserBootstrap } from '../web-bootstrap';

export function BrowserAccess() {
  const [bootstrap, setBootstrap] = useState<BrowserBootstrap>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>();

  const reload = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setBootstrap(await loadBrowserBootstrap());
      setUpdatedAt(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  return (
    <main className="startup-repair" aria-labelledby="browser-access-title">
      <section className="startup-repair-card">
        <Monitor className="startup-repair-icon" aria-hidden="true" />
        <p className="startup-repair-eyebrow">Local web preview</p>
        <h1 id="browser-access-title">Command Center is running locally</h1>
        <p className="startup-repair-copy">
          This browser surface can safely show local startup state. Terminal control, settings, extensions, and operating-system actions remain available only in the desktop app while their server APIs are migrated.
        </p>
        <p className="startup-repair-copy">
          <ShieldCheck size={14} aria-hidden="true" /> No Electron bridge, host credential, or filesystem path is exposed to this page.
        </p>
        {loading && <p className="startup-repair-status" role="status">Loading local state...</p>}
        {error && <p className="startup-repair-status" role="alert">{error}</p>}
        {bootstrap && (
          <>
            <p className="startup-repair-status" role="status">
              {bootstrap.appVersion ? `Version ${bootstrap.appVersion}` : 'Development build'}
            </p>
            <section className="browser-projects" aria-labelledby="browser-projects-title">
              <div className="browser-projects-heading">
                <div>
                  <p className="browser-projects-kicker">Read-only workspace</p>
                  <h2 id="browser-projects-title">Projects</h2>
                </div>
                <span className="browser-project-count">{bootstrap.projects.length}</span>
              </div>
            {bootstrap.projects.length === 0 ? (
              <div className="browser-project-empty">
                <FolderKanban size={18} aria-hidden="true" />
                <p>No local projects are registered.</p>
              </div>
            ) : (
              <ul className="browser-project-list">
                {bootstrap.projects.map((project) => (
                  <li key={project.id} className="browser-project-row">
                    <span className="browser-project-color" style={{ backgroundColor: project.color }} aria-hidden="true" />
                    <span className="browser-project-name">{project.name}</span>
                    {project.category && <span className="browser-project-category">{project.category}</span>}
                  </li>
                ))}
              </ul>
            )}
            </section>
          </>
        )}
        <div className="startup-repair-actions">
          <button className="btn primary" type="button" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} aria-hidden="true" />
            Refresh
          </button>
          {updatedAt && <span className="browser-updated" role="status">Updated {new Date(updatedAt).toLocaleTimeString()}</span>}
        </div>
      </section>
    </main>
  );
}
