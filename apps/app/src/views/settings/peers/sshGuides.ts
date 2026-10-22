/**
 * Plain-language setup help for each way the secure link between two computers can fail. The computer that is
 * adding the other ("Add computer") hosts the link, so most fixes happen there.
 */
export interface SshGuide { title: string; steps: string[] }

export const REMOTE_LOGIN_PATH = 'System Settings > General > Sharing > Remote Login';

const CHECK_AGAIN = 'Come back here and choose Check again.';

/** Add computer's Remote Login check only tests this computer's own sshd, so every direction is about this computer. */
const SSH_GUIDES: Record<string, SshGuide> = {
  ssh_remote_login_off: {
    title: 'Remote Login is turned off on this computer',
    steps: [
      `Open ${REMOTE_LOGIN_PATH} on this computer.`,
      'Turn on Remote Login. On Windows or Linux, start the OpenSSH Server service instead.',
      CHECK_AGAIN
    ]
  },
  ssh_unreachable: {
    title: 'Zana could not finish checking Remote Login on this computer',
    steps: [
      `Open ${REMOTE_LOGIN_PATH} on this computer, turn Remote Login off, then on again.`,
      'Check that this computer has a local network name: System Settings > General > Sharing > Local hostname.',
      CHECK_AGAIN
    ]
  },
  ssh_auth_refused: {
    title: 'Remote Login on this computer would not accept Zana\'s key',
    steps: [
      `Open ${REMOTE_LOGIN_PATH} and make sure Remote Login allows your user account.`,
      'Zana needs to add a line to your ~/.ssh/authorized_keys file. If that folder or file is locked or owned by another user, fix its permissions.',
      CHECK_AGAIN
    ]
  },
  ssh_forwarding_refused: {
    title: 'Remote Login is on, but it does not allow the connection Zana needs',
    steps: [
      'A security setting or an administrator policy on this computer is blocking TCP port forwarding.',
      'Ask your administrator to allow TCP forwarding for your account in the Remote Login (sshd) settings.',
      CHECK_AGAIN
    ]
  },
  ssh_stream_local_allowed: {
    title: 'Remote Login on this computer needs one more setting',
    steps: [
      'For safety, Zana only links computers whose Remote Login refuses socket-file forwarding.',
      'In Terminal, run: echo "AllowStreamLocalForwarding no" | sudo tee /etc/ssh/sshd_config.d/zana.conf',
      `Then open ${REMOTE_LOGIN_PATH}, turn Remote Login off, then on again.`,
      CHECK_AGAIN
    ]
  },
  ssh_host_key_mismatch: {
    title: 'Remote Login on this computer answered with an unexpected security key',
    steps: [
      'The key Remote Login used does not match the one saved in /etc/ssh on this computer.',
      `Open ${REMOTE_LOGIN_PATH}, turn Remote Login off, then on again.`,
      CHECK_AGAIN
    ]
  }
};

export function sshGuideFor(text: string | null | undefined): SshGuide | null {
  return (text && Object.hasOwn(SSH_GUIDES, text) && SSH_GUIDES[text]) || null;
}
