import { Link } from 'react-router-dom';
import { Section } from '@/components/settings/FormFields';
import { SearchTarget } from './MachineCard.js';
import './phone-settings.css';

export function PhoneView() {
  return (
    <Section
      anchorId="phone"
      searchId="phone.mobile"
      title="Mobile"
      help="Use your projects and agents from your phone’s browser."
    >
      <SearchTarget searchId="phone.app-notice" block><section className="phone-app-notice" aria-labelledby="phone-app-title">
        <div className="phone-app-heading">
          <h2 id="phone-app-title">Zana mobile app</h2>
          <span className="phone-coming-soon">Coming soon</span>
        </div>
        <p className="settings-help">In the meantime, use Zana in your mobile browser. No app installation is needed.</p>
      </section></SearchTarget>

      <SearchTarget searchId="phone.browser-guide" block><section className="phone-browser-guide" aria-labelledby="phone-browser-title">
        <h2 id="phone-browser-title">Use Zana in your mobile browser</h2>
        <ol className="phone-browser-steps" aria-label="Mobile browser setup">
          <li>
            <h3>Set up your domain</h3>
            <p>On this computer, open Remote access and get a connect code. Sign in with GitHub, then paste the code into Zana to connect this computer.</p>
            <p>Choose your address on the account page, for example <code>my-domain.zana-ide.com</code>. If you already have an address, use the one shown in Remote access.</p>
            <Link className="btn primary" to="/settings/remote-access">Set up my domain</Link>
          </li>
          <li>
            <h3>Open your domain on your phone</h3>
            <p>Open Safari, Chrome, or your preferred mobile browser and enter your chosen address. Use your own domain in place of <code>my-domain</code>.</p>
          </li>
          <li>
            <h3>Sign in and start working</h3>
            <p>Sign in with the same GitHub account and choose Open Zana to access your projects and interact with your agents. Bookmark your address for next time.</p>
          </li>
        </ol>
        <p className="phone-browser-note">Keep this computer awake, Zana running, and Remote access enabled. Your phone can connect over Wi-Fi or cellular internet.</p>
      </section></SearchTarget>
    </Section>
  );
}

export { PhoneView as PhoneTab };
