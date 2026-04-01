// metro.config.js

const { getDefaultConfig } = require('@expo/metro-config');

// The default Expo config already handles almost everything.
// We just export it directly.
module.exports = getDefaultConfig(__dirname);