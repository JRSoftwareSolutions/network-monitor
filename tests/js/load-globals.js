const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const STATIC_JS = path.join(ROOT, "static", "js");

function loadScript(relativePath, context) {
  const code = fs.readFileSync(path.join(STATIC_JS, relativePath), "utf8");
  vm.runInContext(code, context, { filename: relativePath });
}

function createGlobalsContext() {
  const context = vm.createContext({
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    performance: { now: () => Date.now() },
    requestAnimationFrame: (fn) => {
      fn(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
  });
  return context;
}

function loadRatingFormatGlobals() {
  const context = createGlobalsContext();
  loadScript("constants.js", context);
  loadScript("rating-format.js", context);
  return context;
}

function loadChartPluginGlobals() {
  const context = loadRatingFormatGlobals();
  loadScript("chart-plugins.js", context);
  return context;
}

function loadAnalyticsGlobals() {
  const context = loadChartPluginGlobals();
  loadScript("app-analytics.js", context);
  return context;
}

module.exports = {
  loadRatingFormatGlobals,
  loadChartPluginGlobals,
  loadAnalyticsGlobals,
};
