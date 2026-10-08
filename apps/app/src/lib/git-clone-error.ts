export interface GitCloneError {
  title: string;
  guidance: string[];
  details: string;
}

/** Access errors cannot distinguish a missing repo from a private repo or wrong account. */
export function explainGitCloneError(message: string, code?: string): GitCloneError {
  const details = message || 'Git did not provide an error message.';
  let title = 'Could not clone the repository';
  let guidance = ['Check the Git details below, resolve the error, then try again.'];
  if (code === 'DEST_EXISTS') {
    title = 'A folder already exists at this destination';
    guidance = ['Rename the project or remove that folder, then try again.'];
  } else if (/permission denied.*publickey|no supported authentication methods/i.test(message)) {
    title = 'SSH authentication failed';
    guidance = ['Add an SSH key to an account with access to this repository, or use its HTTPS URL and sign in to Git.'];
  } else if (/authentication failed|repository.*not found|could not read (?:username|password)|terminal prompts disabled|access denied|not authorized|unauthorized|requested URL returned error: (?:401|403)/i.test(message)) {
    title = 'Could not access the repository';
    guidance = [
      'Check the repository URL. For a private repository, sign in to Git with an account that has access.',
      'Already signed in? Switch the account used by your Git credential helper or SSH key, then try again. Signing in in your browser does not update Git’s account.'
    ];
  } else if (/could not resolve|couldn.t resolve|failed to connect|connection (?:refused|reset)|network is unreachable/i.test(message)) {
    title = 'Could not connect to the Git server';
    guidance = ['Check your internet connection, VPN, and repository URL, then try again.'];
  } else if (/certificate|ssl.*error/i.test(message)) {
    title = 'Could not verify the Git server’s certificate';
    guidance = ['Check the repository URL and your network’s certificate setup, then try again.'];
  } else if (/timed out|timeout/i.test(message)) {
    title = 'The clone timed out';
    guidance = ['Check your connection or VPN, then try again. Large repositories may take longer to clone.'];
  } else if (/spawn git ENOENT|git not found/i.test(message)) {
    title = 'Git is not installed or could not be found';
    guidance = ['Install Git and restart the app, then try again.'];
  }
  return { title, guidance, details };
}
