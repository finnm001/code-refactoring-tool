const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

function isCamelCase(name) {
  return /^[a-z][a-zA-Z0-9]*$/.test(name);
}

function toCamelCase(name) {
  return name
    .replace(/[_-](.)/g, (_, g) => g.toUpperCase()) //snake_case
    .replace(/^[A-Z]/, (c) => c.toLowerCase()); //PascalCase
}

function activate(context) {
  const scheme = "js-refactor-preview";
  const previewContent = new Map();

  const provider = {
    provideTextDocumentContent(uri) {
      return previewContent.get(uri.toString()) || "";
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(scheme, provider)
  );

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
        const editor = vscode.window.activeTextEditor;
        if (!editor) return vscode.window.showWarningMessage("No active file");

        const document = editor.document;
        const fileUri = document.uri;

        if (document.isUntitled) {
          return vscode.window.showErrorMessage(
            "❌ Please save the file first."
          );
        }

        const code = document.getText();
        let ast;

        try {
          ast = parser.parse(code, {
            sourceType: "module",
            plugins: ["jsx", "typescript"],
          });
        } catch {
          return vscode.window.showErrorMessage("❌ Could not parse JS file.");
        }

        const found = [];

        traverse(ast, {
          VariableDeclarator(path) {
            const name = path.node.id.name;
            const suggestion = toCamelCase(name);

            if (
              !isCamelCase(name) &&
              suggestion !== name &&
              !found.some((item) => item.original === name)
            ) {
              found.push({
                label: `❌ ${name}`,
                description: `Suggest: ${suggestion}`,
                original: name,
                suggestion,
              });
            }
          },

          FunctionDeclaration(path) {
            const name = path.node.id?.name;
            if (!name) return;
            const suggestion = toCamelCase(name);

            if (
              !isCamelCase(name) &&
              suggestion !== name &&
              !found.some((item) => item.original === name)
            ) {
              found.push({
                label: `❌ ${name}`,
                description: `Suggest: ${suggestion}`,
                original: name,
                suggestion,
              });
            }
          },

          ArrowFunctionExpression(path) {
            const parent = path.parent;
            if (parent.type === "VariableDeclarator" && parent.id?.name) {
              const name = parent.id.name;
              const suggestion = toCamelCase(name);

              if (
                !isCamelCase(name) &&
                suggestion !== name &&
                !found.some((item) => item.original === name)
              ) {
                found.push({
                  label: `❌ ${name}`,
                  description: `Suggest: ${suggestion}`,
                  original: name,
                  suggestion,
                });
              }
            }
          },
        });

        if (found.length === 0) {
          return vscode.window.showInformationMessage(
            "✅ All names follow camelCase!"
          );
        }

        let currentCode = code;

        for (let i = 0; i < found.length; i++) {
          const selection = found[i];
          const updatedCode = currentCode.replace(
            new RegExp(`\\b${selection.original}\\b`, "g"),
            selection.suggestion
          );

          const previewUri = vscode.Uri.parse(
            `${scheme}:/refactor-preview/${selection.original}-to-${selection.suggestion}.js`
          );
          previewContent.set(previewUri.toString(), updatedCode);

          await vscode.commands.executeCommand(
            "vscode.diff",
            fileUri,
            previewUri,
            `${selection.original} → ${selection.suggestion}`
          );

          const apply = await vscode.window.showInformationMessage(
            `Replace all instances of "${selection.original}" with "${selection.suggestion}"?`,
            "Apply",
            "Cancel"
          );

          if (apply === "Apply") {
            try {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(code.length)
              );
              edit.replace(fileUri, fullRange, updatedCode);
              await vscode.workspace.applyEdit(edit);
              await document.save();
              vscode.window.showInformationMessage(
                "✅ Changes applied and saved."
              );
              currentCode = updatedCode;
            } catch {
              vscode.window.showErrorMessage("❌ Failed to apply changes.");
            }
          }

          // Close preview diff tab
          const tabGroups = vscode.window.tabGroups.all;
          for (const group of tabGroups) {
            for (const tab of group.tabs) {
              if (
                tab.label.includes(
                  `${selection.original} → ${selection.suggestion}`
                )
              ) {
                await vscode.window.tabGroups.close(tab);
              }
            }
          }

          // Ask if user wants to continue to next suggestion
          if (i < found.length - 1) {
            const next = await vscode.window.showInformationMessage(
              "Would you like to review the next suggestion?",
              "Yes",
              "No"
            );

            if (next !== "Yes") {
              break;
            }
          }
        }

        // Refocus original file
        try {
          await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One,
          });
        } catch {}
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