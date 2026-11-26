/**
 * React Native CLI config. Each local native module under modules/ is listed here, so
 * autolinking adds its pod on `pod install` and codegen finds its spec, without an entry in
 * package.json or a change to the Xcode project.
 */
const path = require("node:path");

module.exports = {
  dependencies: {
    "app-info": { root: path.join(__dirname, "modules/app-info") },
  },
};
