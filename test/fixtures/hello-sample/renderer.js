/**
 * Hello Sample — minimal extension renderer process.
 * Displays a simple UI proving the extension is loaded.
 */
export default {
  id: 'hello-sample',

  renderGlobal({ host }) {
    const container = document.createElement('div');
    container.className = 'hello-sample-container';
    container.style.cssText = 'padding: 20px; font-family: system-ui;';

    const title = document.createElement('h2');
    title.textContent = 'Hello Sample Extension';
    title.style.cssText = 'margin: 0 0 10px 0; color: #6366f1;';

    const message = document.createElement('p');
    message.textContent = 'This is a minimal live-loadable extension demonstrating the install/uninstall lifecycle.';
    message.style.cssText = 'margin: 0 0 15px 0; color: #64748b;';

    const button = document.createElement('button');
    button.textContent = 'Test Ping';
    button.className = 'settings-btn primary';
    button.style.cssText = 'cursor: pointer;';

    const status = document.createElement('div');
    status.style.cssText = 'margin-top: 10px; padding: 10px; background: #f1f5f9; border-radius: 4px;';
    status.textContent = 'Click the button to test the extension';

    button.onclick = async () => {
      try {
        const result = await host.call('ping');
        status.textContent = `Response: ${JSON.stringify(result)}`;
        status.style.background = '#dcfce7';
        status.style.color = '#166534';
      } catch (err) {
        status.textContent = `Error: ${err.message}`;
        status.style.background = '#fee2e2';
        status.style.color = '#991b1b';
      }
    };

    container.appendChild(title);
    container.appendChild(message);
    container.appendChild(button);
    container.appendChild(status);

    return container;
  },

  renderProjectTab({ host, projectId }) {
    const container = document.createElement('div');
    container.className = 'hello-sample-project';
    container.style.cssText = 'padding: 20px;';

    const title = document.createElement('h3');
    title.textContent = `Hello from project: ${projectId}`;
    container.appendChild(title);

    return container;
  }
};
