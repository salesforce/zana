const path = require('node:path');
const fs = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const bridgeRoot = path.resolve(__dirname, '../../packages/mobile-bridge/src') + path.sep;
// Workspace ESM sources use .js specifiers; Metro needs their TypeScript files.
config.resolver.resolveRequest = (context, name, platform) => {
  if (
    context.originModulePath.startsWith(bridgeRoot) &&
    name.startsWith('.') &&
    name.endsWith('.js')
  ) {
    const source = path.resolve(path.dirname(context.originModulePath), name.slice(0, -3) + '.ts');
    if (source.startsWith(bridgeRoot) && fs.existsSync(source))
      return { type: 'sourceFile', filePath: source };
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
