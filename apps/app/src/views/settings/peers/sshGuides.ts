/**
 * Plain-language setup help for each way the secure link between two computers can fail. The computer that is
 * adding the other ("Add computer") hosts the link, so most fixes happen there.
 */
export interface SshGuide { title: string; steps: string[] }

export const REMOTE_LOGIN_PATH = 'System Settings > General > Sharing > Remote Login';

const SSH_GUIDES: Record<string, SshGuide> = {
  ssh_remote_login_off: {
    title: 'Remote Login is turned off on this computer',
    steps: [
      'Open System Settings > General > Sharing on the computer that is adding the other.',
      'Turn on Remote Login. On Windows or Linux, start the OpenSSH Server service instead.',
      'Come back here and choose Check again.'
    ]
  },
  ssh_unreachable: {
    title: 'The other computer cannot be reached',
    steps: [
      'Check that both computers are awake and on the same Wi-Fi or wired network.',
      `Check that Remote Login is on for the computer that is adding the other: ${REMOTE_LOGIN_PATH}.`,
      'If your network blocks computers from finding each other (some office and guest networks do), try a different network.',
      'Then choose Add computer again for a new invitation.'
    ]
  },
  ssh_auth_refused: {
    title: 'The computer that is adding the other would not accept the connection',
    steps: [
      `On that computer, open ${REMOTE_LOGIN_PATH} and make sure Remote Login is on and allows your user account.`,
      'Zana needs to add a line to your ~/.ssh/authorized_keys file. If that folder or file is locked or owned by another user, fix its permissions.',
      'Then choose Add computer again for a new invitation.'
    ]
  },
  ssh_forwarding_refused: {
    title: 'Remote Login is on, but it does not allow the connection Zana needs',
    steps: [
      'On the computer that is adding the other, a security setting or an administrator policy is blocking port forwarding.',
      'Ask your administrator to allow TCP forwarding for your account in the Remote Login (sshd) settings.',
      'Then choose Add computer again for a new invitation.'
    ]
  },
  ssh_host_key_mismatch: {
    title: 'The computer you reached is not the one that made the invitation',
    steps: [
      'The invitation points at a different computer than the one that answered, or its security key changed.',
      'This can also mean someone else is on your network. Do not continue with this invitation.',
      'On the computer that is adding the other, choose Add computer to make a new invitation and paste the new one here.'
    ]
  }
};

export function sshGuideFor(text: string | null | undefined): SshGuide | null {
  return (text && Object.hasOwn(SSH_GUIDES, text) && SSH_GUIDES[text]) || null;
}
