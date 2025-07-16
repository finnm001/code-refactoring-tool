# PwC Code Refactor Tool

## 🔧 Lint for Errors Setup (Required for Lint Feature)

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
    - **What do you want to lint? -** ✅ JavaScript *(Select others like JSON, Markdown if required)*.
    - **How would you like to use ESLint? -** ✅ To check syntax and find problems *(Recommended)*.
    - **What type of modules does your project use? -** Choose according to your project: 
        - `JavaScript modules (import/export)`
        - `CommonJS (require/export)`
    - **Which framework does your project use? -** ✅ None of these *(unless using React or Vue.js)*.
    - **Does your project use TypeScript? -** Choose `No` or `Yes` based on your project.
    - **Where does your code run? -** ✅ Node *(or Browser if it's front-end code)*.
    - **Would you like to install them now? -** ✅ Yes
4. ESLint will generate a config file for you (such as `eslint.config.js` or `.eslintrc.json`).

### ⚙ Recommended ESLint Config (Optional)

If you'd like a ready-to-use ESLint config for this extension, replace you config file contents with our recommended setup:

```js
import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "single"],
      indent: ["error", 2],
      eqeqeq: ["error", "always"],
      "no-unused-vars": "warn",
      "no-console": "warn"
    },
    languageOptions: { globals: globals.node }
  }
]);
```

This config:
- Auto-fixes semicolons, quotes, and indentation.
- Warns about unused variables and `console` usage.
- Enforces strict equality (`===`).

**Note:** This config is just an example — you can customise it anytime later.

### ⚠️ Important

- Without an ESLint config, the **Lint Errors** feature will not run.
- If missing, you'll see this message:
    - "*⚠️ ESLint config not found. Please follow the Lint Errors setup guide in the README.*"