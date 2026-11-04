/**
 * Plain-language help for each way Add computer's readiness check can fail. The check starts Zana's own connection
 * service (a private sshd run as this user) and proves it end to end, so every direction is about this computer.
 */
export interface SshGuide { title: string; steps: string[] }

const CHECK_AGAIN = 'Then choose Check again.';

const SSH_GUIDES: Record<string, SshGuide> = {
  ssh_remote_login_off: {
    title: 'Zana could not start its connection service on this computer',
    steps: [
      'Quit and reopen Zana.',
      'If it still fails, macOS may be missing its built-in OpenSSH server (/usr/sbin/sshd).',
      CHECK_AGAIN
    ]
  },
  ssh_unreachable: {
    title: 'Zana could not finish getting this computer ready',
    steps: [
      'Check that this computer has a local network name: System Settings > General > Sharing > Local hostname.',
      CHECK_AGAIN
    ]
  },
  ssh_auth_refused: {
    title: 'Zana\'s connection service would not accept its own test key',
    steps: [
      'Zana keeps its connection keys in its own data folder. If that folder is locked or owned by another user, fix its permissions.',
      CHECK_AGAIN
    ]
  },
  ssh_forwarding_refused: {
    title: 'Zana\'s connection service could not open the link it needs',
    steps: [
      'Security software or an administrator policy on this computer may be blocking local connections.',
      CHECK_AGAIN
    ]
  },
  ssh_stream_local_allowed: {
    title: 'Zana\'s connection service is not locked down',
    steps: [
      'Zana refused to continue because its connection service allowed more than it should.',
      'Quit and reopen Zana.',
      CHECK_AGAIN
    ]
  },
  ssh_host_key_mismatch: {
    title: 'Zana\'s connection service answered with an unexpected security key',
    steps: [
      'Another program may be using the same network port.',
      'Quit and reopen Zana.',
      CHECK_AGAIN
    ]
  }
};

export function sshGuideFor(text: string | null | undefined): SshGuide | null {
  return (text && Object.hasOwn(SSH_GUIDES, text) && SSH_GUIDES[text]) || null;
}
