import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", localStorage: "readonly", fetch: "readonly",
        console: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", navigator: "readonly",
        HTMLCanvasElement: "readonly", CanvasRenderingContext2D: "readonly",
        HTMLDivElement: "readonly", HTMLButtonElement: "readonly", HTMLInputElement: "readonly",
        HTMLLabelElement: "readonly", HTMLSelectElement: "readonly", HTMLElement: "readonly",
        HTMLParagraphElement: "readonly", HTMLHeadingElement: "readonly",
        KeyboardEvent: "readonly", WheelEvent: "readonly", PointerEvent: "readonly",
      },
    },
    plugins: { "@typescript-eslint": typescript },
    rules: {
      ...typescript.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];
