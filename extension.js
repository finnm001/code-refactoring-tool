const vscode = require("vscode");
const fixNaming = require("./features/fixNaming");
const checkStructure = require("./features/checkStructure");
const lintErrors = require("./features/lintErrors");

function activate(context) {
  const disposable = vscode.commands.registerCommand(
    "pwc-refactor.run",
    async () => {
      const feature = await vscode.window.showQuickPick(
        [
          {
            label: "🔤 Fix Naming",
            description:
              "Detect and rename variables/functions to the correct case",
          },
          {
            label: "📁 Check Structure",
            description:
              "Analyse file layout and suggest organisation improvements",
          },
          {
            label: "🧪 Lint for Errors",
            description: "Find syntax issues using ESLint (JavaScript & TypeScript)",
          },
        ],
        {
          title: "PwC Code Refactor Tool",
          placeHolder: "What would you like to do?",
        }
      );

      if (!feature) return;

      if (feature.label === "🔤 Fix Naming") {
        await fixNaming.run(context);
      } else if (feature.label === "📁 Check Structure") {
        await checkStructure.run(context);
      } else if (feature.label === "🧪 Lint for Errors") {
        await lintErrors.run(context);
      }
    }
  );

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};