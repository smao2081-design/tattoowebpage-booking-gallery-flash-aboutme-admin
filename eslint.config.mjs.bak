import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Prefer the `ignores` property so ESLint stops warning about .eslintignore
  {
    ignores: ["server/**"]
  },
  // Additional override: explicitly allow CommonJS `require()` in server JS,
  // and don't treat unused error variables as errors there.
  {
    files: ["server/**/*.js", "server/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "varsIgnorePattern": \"^_\", \"argsIgnorePattern\": \"^_\" }],
      "no-unused-vars": ["warn", { "varsIgnorePattern": \"^_\", \"argsIgnorePattern\": \"^_\" }]
    }
  }
]);

export default eslintConfig;
