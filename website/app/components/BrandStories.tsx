import Link from 'next/link';

/** Responsive, selectable-text companions to the full README illustrations. */
export function PluginOverview() {
  return (
    <div className="plugin-overview" aria-label="How a Zana plugin works">
      <div className="plugin-package">
        <span className="story-symbol" aria-hidden="true">
          ◇
        </span>
        <div>
          <strong>Your plugin</strong>
          <code>package.json → zcc</code>
        </div>
        <span className="package-label">One package</span>
      </div>
      <div className="plugin-branches">
        <div>
          <span className="story-eyebrow">Server</span>
          <h3>Make it work.</h3>
          <p>Tools, services, and workflows.</p>
          <span className="story-code">ZccPluginApi</span>
        </div>
        <div>
          <span className="story-eyebrow lavender">App</span>
          <h3>Make it yours.</h3>
          <p>Panels, project tabs, and actions.</p>
          <span className="story-code">definePluginApp</span>
        </div>
      </div>
      <div className="plugin-capabilities">
        <span>Skills</span>
        <span>Thread tools</span>
        <span>CLI MCP servers</span>
      </div>
      <p className="diagram-note">
        Server code runs with full trust. Install plugins from sources you
        trust.
      </p>
    </div>
  );
}

export function InboxStory() {
  return (
    <figure className="inbox-story">
      <figcaption>
        <span className="status-spark" />
        Needs your judgment<span>Example workflow</span>
      </figcaption>
      <div className="story-question">
        <span className="story-eyebrow gold">Checkout · Agent question</span>
        <h3>
          Keep the shared mock,
          <br />
          or isolate this test?
        </h3>
        <p>The fix is ready. One decision before I continue.</p>
      </div>
      <div className="story-answer">
        <span className="story-eyebrow">Your reply</span>
        <p>Isolate the test. Keep production behavior unchanged.</p>
        <span className="reply-route">↗ Back to the waiting agent</span>
      </div>
    </figure>
  );
}

export function LibraryStory() {
  return (
    <figure className="library-story">
      <figcaption>
        <span className="story-eyebrow lavender">Project Library</span>
        <span>Example finding</span>
      </figcaption>
      <div className="library-document">
        <span className="document-fold" aria-hidden="true" />
        <span className="story-code">checkout / findings.md</span>
        <h3>
          The context.
          <br />
          Not just the conversation.
        </h3>
        <dl>
          <dt>What we found</dt>
          <dd>Shared mock state affected the test.</dd>
          <dt>What changed</dt>
          <dd>A separate fixture for each test.</dd>
          <dt>What comes next</dt>
          <dd>Rerun the checkout suite.</dd>
        </dl>
      </div>
      <div className="library-trail">
        <span>Investigation</span>
        <span aria-hidden="true">→</span>
        <span>Saved finding</span>
        <span aria-hidden="true">→</span>
        <span>Next task</span>
      </div>
    </figure>
  );
}

export function ArchitectureOverview() {
  return (
    <div
      className="architecture-overview"
      aria-label="Zana architecture overview"
    >
      <div className="architecture-step">
        <span>01</span>
        <div>
          <h3>A place to direct the work</h3>
          <p>
            The desktop brings your Projects, sessions, and decisions together.
          </p>
        </div>
        <span className="architecture-tag">Desktop</span>
      </div>
      <div className="architecture-step">
        <span>02</span>
        <div>
          <h3>Product services at the center</h3>
          <p>
            The server owns policy, project identity, Thread state, and plugins.
          </p>
        </div>
        <span className="architecture-tag">Product server</span>
      </div>
      <div className="architecture-step">
        <span>03</span>
        <div>
          <h3>Your agents, where you work</h3>
          <p>
            Execution hosts connect the work to agent runtimes and coding tools.
          </p>
        </div>
        <span className="architecture-tag">Execution hosts</span>
      </div>
      <p className="diagram-note">
        Threads use signed host commands. CLI Agents retain the desktop launch
        path.
      </p>
      <Link
        className="text-link"
        href="/artwork/zana-architecture.svg"
        target="_blank"
        rel="noopener noreferrer"
      >
        Explore the complete architecture <span aria-hidden="true">↗</span>
      </Link>
    </div>
  );
}
