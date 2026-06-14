const stylelint = require("stylelint");

const IMPORTANT_ALLOWED = /_overrides\.scss$/;

const importantRuleName = "local/no-important-outside-overrides";
const importantRule = () => (root, result) => {
  const file = root.source?.input?.file ?? "";
  if (IMPORTANT_ALLOWED.test(file)) {
    return;
  }
  root.walkDecls((decl) => {
    if (decl.important) {
      stylelint.utils.report({
        message: importantRule.messages.rejected,
        node: decl,
        result,
        ruleName: importantRuleName,
        word: "!important",
      });
    }
  });
};
importantRule.ruleName = importantRuleName;
importantRule.messages = stylelint.utils.ruleMessages(importantRuleName, {
  rejected: "!important is only allowed in _overrides.scss",
});

module.exports = {
  extends: ["stylelint-config-standard-scss"],
  ignoreFiles: [
    "static/css/app.css",
    "static/css/main.interim.css",
  ],
  plugins: [
    stylelint.createPlugin(importantRuleName, importantRule),
  ],
  rules: {
    "local/no-important-outside-overrides": true,
    "scss/at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: ["layer", "property"],
      },
    ],
    // BEM + legacy palette — keep project conventions from plain CSS era
    "selector-class-pattern": null,
    "color-function-notation": null,
    "alpha-value-notation": null,
    "color-hex-length": null,
    "value-keyword-case": null,
    "property-no-vendor-prefix": null,
    "declaration-block-single-line-max-declarations": null,
    "no-descending-specificity": null,
    "keyframes-name-pattern": null,
    "scss/dollar-variable-empty-line-before": null,
    "number-max-precision": null,
    "selector-not-notation": null,
    "media-feature-range-notation": null,
    "shorthand-property-no-redundant-values": null,
    "comment-empty-line-before": null,
    "rule-empty-line-before": null,
    "at-rule-empty-line-before": null,
    "custom-property-empty-line-before": null,
    "declaration-empty-line-before": null,
    "declaration-block-no-redundant-longhand-properties": null,
  },
};
