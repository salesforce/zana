export function gitChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && key !== 'GIT_AUTHOR_NAME' && key !== 'GIT_AUTHOR_EMAIL'
      && key !== 'GIT_COMMITTER_NAME' && key !== 'GIT_COMMITTER_EMAIL') {
      delete env[key];
    }
  }
  return env;
}
