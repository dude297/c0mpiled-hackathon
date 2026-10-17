// Share the web app's pure engine (../src/domain, ../src/lib/schema.ts) without copying.
// "@/..." aliases come from tsconfig paths ("./*" then "../src/*"), which Expo's Metro honours.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const webSrc = path.resolve(__dirname, '../src');

config.watchFolders = [webSrc];
// Shared files sit outside mobile/, so bare imports like "zod" must resolve from mobile/node_modules.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
