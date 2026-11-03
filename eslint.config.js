const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "artifacts/**",
      "cache/**",
      "coverage/**",
      "audits/**",
      "typechain-types/**",
      "flattened/**",
      "abi/**",
      "docs/**",
      ".yarn/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // The repo is CommonJS; require() in hardhat.config.ts and tests is intentional.
      "@typescript-eslint/no-require-imports": "off",
      // Downgraded to warnings to keep CI green on the existing codebase; ratchet
      // back to errors as the violations get cleaned up.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
    },
  },
  {
    // Chai assertions like expect(x).to.be.true are expression statements.
    files: ["test/**/*.ts", "test-scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  prettierConfig,
];
