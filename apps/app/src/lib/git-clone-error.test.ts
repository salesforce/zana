import { describe, expect, it } from 'vitest';
import { explainGitCloneError } from './git-clone-error.js';

describe('Git import recovery guidance', () => {
  it.each([
    'remote: Repository not found.\nfatal: Authentication failed',
    'fatal: could not read Username for https://example.test: terminal prompts disabled',
    'fatal: The requested URL returned error: 403',
    'remote: Access denied',
    'remote: Unauthorized'
  ])('explains login and account switching for access errors: %s', message => {
    const error = explainGitCloneError(message);
    expect(error.title).toBe('Could not access the repository');
    expect(error.guidance.join(' ')).toContain('sign in to Git with an account that has access');
    expect(error.guidance.join(' ')).toContain('Switch the account');
    expect(error.guidance.join(' ')).toContain('browser does not update Git');
    expect(error.details).toBe(message);
  });

  it.each([
    ['Permission denied (publickey).', 'SSH authentication failed', 'SSH key'],
    ['Could not resolve host: example.test', 'Could not connect', 'VPN'],
    ['Failed to connect to example.test port 443', 'Could not connect', 'connection'],
    ['SSL certificate problem: unable to get local issuer certificate', 'Could not verify', 'certificate setup'],
    ['git clone timed out', 'The clone timed out', 'Large repositories'],
    ['spawn git ENOENT', 'Git is not installed', 'Install Git'],
    ['fatal: unable to create work tree dir: Permission denied', 'Could not clone', 'Git details']
  ])('offers appropriate recovery for %s', (message, title, action) => {
    const error = explainGitCloneError(message);
    expect(error.title).toContain(title);
    expect(error.guidance.join(' ')).toContain(action);
    expect(error.details).toBe(message);
  });

  it('does not misclassify destination collisions as account problems', () => {
    const error = explainGitCloneError('clone target already exists: /projects/repo', 'DEST_EXISTS');
    expect(error.title).toContain('folder already exists');
    expect(error.guidance).toEqual(['Rename the project or remove that folder, then try again.']);
  });

  it('provides a fallback when Git returned no message', () => {
    expect(explainGitCloneError('').details).toBe('Git did not provide an error message.');
  });
});
