module.exports = {
  plugins: [
    require("postcss-import"),
    require("postcss-preset-env")({
      // Local dashboard — evergreen Chromium/Firefox only; default browserslist
      // polyfills color-mix into hoisted @supports blocks that escape @layer.
      browsers: "Chrome >= 111, Firefox >= 113, Edge >= 111",
      features: {
        // Breakpoints are handled by Sass mixins in static/scss/abstracts/_breakpoints.scss
        "custom-media-queries": false,
        // Keep native @layer in the bundle — flattening to :not(#\#) hacks is brittle
        // and breaks the vendor/components cascade this project relies on.
        "cascade-layers": false,
        // Belt-and-suspenders: never emit color-mix fallbacks even if browserslist changes.
        "color-mix": false,
      },
    }),
  ],
};
