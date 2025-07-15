const vscode = require("vscode");
const fixNaming = require("./features/fixNaming");
const checkStructure = require("./features/checkStructure");

function activate(context) {
  const disposable = vscode.commands.registerCommand(
    "js-refactor.run",
    async () => {
      const feature = await vscode.window.showQuickPick(
        [
          {
            label: "🔤 Fix Naming",
            description: "Detect and rename variables/functions to camelCase",
          },
          {
            label: "📁 Check Structure",
            description:
              "Analyse file layout and suggest organisation improvements",
          },
          {
            label: "🧪 Lint for Errors",
            description: "Find syntax issues using ESLint",
          },
          {
            label: "📝 Create Report",
            description: "Generate README with detected issues and suggestions",
          },
        ],
        {
          title: "PwC JS Refactor Tool",
          placeHolder: "What would you like to do?",
        }
      );

      if (!feature) return;

      if (feature.label === "🔤 Fix Naming") {
        await fixNaming.run(context);
      } else if (feature.label === "📁 Check Structure") {
        await checkStructure.run(context);
      } else {
        vscode.window.showInformationMessage(
          `🚧 ${feature.label} not implemented yet.`
        );
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