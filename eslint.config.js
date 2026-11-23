
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // ==========================================
  // IGNORED FILES
  // ==========================================

  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },

  // ==========================================
  // JAVASCRIPT RECOMMENDED RULES
  // ==========================================

  js.configs.recommended,

  // ==========================================
  // TYPESCRIPT RECOMMENDED RULES
  // ==========================================

  ...tseslint.configs.recommended,

  // ==========================================
  // NODE.JS CONFIGURATION
  // ==========================================

  {
    files: ["**/*.ts"],

    languageOptions: {
      globals: globals.node,
    },
  }
);
