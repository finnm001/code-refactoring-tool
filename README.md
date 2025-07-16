# PwC Code Refactor Tool

## 🔧 Lint Errors Setup (Required for Lint Feature)

This feature uses **ESLint** to detect and fix code issues automatically.

To use it, you must set up ESLint in your project first.

### ✅ Quick Setup Guide (Recommended)

Follow these steps to initialise ESLint in your project:

1. Open your terminal in your project root.
2. Run this command:

```bash
npx eslint --init
```

3. Answer the prompts carefully. Here are some suggested/typical answers:
   - **What do you want to lint? -** ✅ JavaScript _(Select others like JSON, Markdown if required)_.
   - **How would you like to use ESLint? -** ✅ To check syntax and find problems _(Recommended)_.
   - **What type of modules does your project use? -** Choose according to your project:
     - `JavaScript modules (import/export)`
     - `CommonJS (require/export)`
   - **Which framework does your project use? -** ✅ None of these _(unless using React or Vue.js)_.
   - **Does your project use TypeScript? -** Choose `No` or `Yes` based on your project.
   - **Where does your code run? -** ✅ Node _(or Browser if it's front-end code)_.
   - **Would you like to install them now? -** ✅ Yes
4. ESLint will generate a config file for you (such as `eslint.config.js` or `.eslintrc.json`).

### ⚙ Recommended ESLint Config (Optional)

If you'd like a ready-to-use ESLint config for this extension, replace you config file contents with our recommended setup:

_You can remove the comments below once you're familiar with the rules._

```js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      semi: ["error", "always"], // Require semicolons
      quotes: ["error", "single"], // Enforce single quotes
      indent: ["error", 2], // Enforce 2-space indent
      eqeqeq: ["error", "always"], // Require strict equality
      "no-console": "warn", // Warn on console usage
      "space-in-parens": ["error", "never"], // No spaces inside parentheses
      "space-infix-ops": "error", // Require spaces around operators
      "no-multi-spaces": "error", // Disallow multiple spaces
    },
    languageOptions: { globals: globals.node },
  },
]);
```

This config:

- Auto-fixes semicolons, quotes, indentation, and spacing.
- Warns about `console` usage.
- Enforces strict equality (`===`).

**Note:** This config is just an example — you can customise it anytime later.

### ⚠️ Important

- Without an ESLint config, the **Lint Errors** feature will not run.
- If missing, you'll see this message:
  - "_⚠️ ESLint config not found. Please follow the Lint Errors setup guide in the README._"