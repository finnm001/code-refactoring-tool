# PwC Code Refactor Tool

## 1. Feature Guides

This section walks you through how to use each feature in the PwC Code Refactor Tool.

For any features that require setup (like Lint for Errors), setup instructions are included directly below the guide.

### 1.1 🔤 Fix Naming — How to Use

1. Open the file you want to refactor.
2. Ensure the file is **saved** before running the PwC Code Refactor Tool.  
   If there are unsaved changes, you’ll be prompted to **Save & Continue** or **Cancel**.
3. Press `Ctrl + Shift + P` to open the Command Palette.
4. Run `🔧 PwC Refactor: Analyse Code`.
5. Select the `🔤 Fix Naming` feature.
6. Choose your preferred naming convention:  
   **🐍 snake_case**, **🐫 camelCase**, or **🔠 PascalCase**.  
   _A recommended style will be suggested based on the file type or language._
7. Select how you want to apply the changes:
   - `✅ Apply All`: automatically rename all variables.
   - `🔍 Review Individually`: step through and edit suggestions one by one.
   - `❌ Cancel`: exit without applying changes.
8. A diff window will open showing the proposed name changes.
9. Follow the prompts to confirm and **Apply & Save** your changes, or **Cancel** if needed.

### 1.2 📁 Check Structure — How to Use

1. Open the file you want to analyse.
2. Ensure the file is **saved** before running the PwC Code Refactor Tool.  
   If there are unsaved changes, you’ll be prompted to **Save & Continue** or **Cancel**.
3. Press `Ctrl + Shift + P` to open the Command Palette.
4. Run `🔧 PwC Refactor: Analyse Code`.
5. Select the `📁 Check Structure` feature.
6. A structure report will open in a side panel, detailing the breakdown of your code’s elements.
7. At the bottom of the report, you can choose to **Export as PDF** if needed.
8. To close the report panel, click the `X` in the top-right corner, or press `Ctrl + F4`.

### 1.3 🧪 Lint for Errors — How to Use

1. Open the file you want to lint.
2. Make sure the file is **saved** before running the PwC Code Refactor Tool.  
   If there are unsaved changes, you’ll be prompted to **Save & Continue** or **Cancel**.
3. Press `Ctrl + Shift + P` to open the Command Palette.
4. Run `🔧 PwC Refactor: Analyse Code`.
5. Choose the `🧪 Lint for Errors` feature.
6. A diff window will appear showing the proposed ESLint fixes.
7. You’ll then be prompted to either **Apply & Save** the changes or **Cancel**.

> 🛠️ First-time using this feature? Follow the setup guide below to get started.

### 1.4 🔧 Lint Errors Setup (Required for Lint Feature)

This feature uses **ESLint** to detect and fix code issues automatically.

To use it, you must set up ESLint in your project first.

#### ✅ Quick Setup Guide (Recommended)

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

#### ⚙ Recommended ESLint Config (Optional)

If you'd like a ready-to-use ESLint config for this extension, replace your config file contents with our recommended setup:

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

#### ⚠️ Important

- Without an ESLint config, the **Lint Errors** feature will not run.
- If missing, you'll see this message:
  - "_⚠️ ESLint config not found. Please follow the Lint Errors setup guide in the README._"