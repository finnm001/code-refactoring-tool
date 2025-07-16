const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const {
  isCamelCase,
  isPascalCase,
  isSnakeCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} = require("../utils/namingUtils");

async function run(context) {
  const scheme = "js-refactor-preview";
  const previewContent = new Map();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent(uri) {
        return previewContent.get(uri.toString()) || "";
      },
    })
  );

  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showWarningMessage("No active file");

  const document = editor.document;
  const fileUri = document.uri;

  if (document.isUntitled) {
    return vscode.window.showErrorMessage("❌ Please save the file first.");
  }

  if (document.isDirty) {
    const save = await vscode.window.showInformationMessage(
      "This file has unsaved changes. Please save before continuing.",
      "Save and Continue",
      "Cancel"
    );
    if (save !== "Save and Continue") return;
    await document.save();
  }

  const namingStyle = await vscode.window.showQuickPick(
    ["🐍 snake_case", "🐫 camelCase", "🔠 PascalCase"],
    {
      placeHolder:
        "What case would you like to use for variable and function names?",
    }
  );
  if (!namingStyle) return;

  const proceedMode = await vscode.window.showQuickPick(
    ["✅ Apply All", "🔍 Review Individually", "❌ Cancel"],
    { placeHolder: "How would you like to proceed with the suggestions?" }
  );
  if (!proceedMode || proceedMode.includes("Cancel")) return;
  const applyAll = proceedMode.includes("Apply All");

  const code = document.getText();
  let ast;

  try {
    ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return vscode.window.showErrorMessage(
      "❌ Could not parse the file. Check for syntax errors or duplicate names."
    );
  }

  const found = [];
  const scopeStack = [];

  function getValidator(style) {
    if (style.includes("PascalCase")) return isPascalCase;
    if (style.includes("snake_case")) return isSnakeCase;
    return isCamelCase;
  }

  function getTransformer(style) {
    if (style.includes("PascalCase")) return toPascalCase;
    if (style.includes("snake_case")) return toSnakeCase;
    return toCamelCase;
  }

  const isStyle = getValidator(namingStyle);
  const toStyle = getTransformer(namingStyle);

  traverse(ast, {
    enter(path) {
      if (path.scope) {
        scopeStack.push(new Set(Object.keys(path.scope.bindings)));
      }
    },
    exit(path) {
      if (path.scope) {
        scopeStack.pop();
      }
    },

    VariableDeclarator(path) {
      const name = path.node.id.name;
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        suggestion !== name &&
        !found.some((f) => f.original === name)
      ) {
        const allBindings = new Set([...scopeStack.flat()]);
        if (!allBindings.has(suggestion)) {
          found.push({ original: name, suggestion });
        } else {
          console.warn(
            `⚠️ Skipped "${name}" → "${suggestion}" due to scope conflict.`
          );
        }
      }
    },

    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name) return;
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        suggestion !== name &&
        !found.some((f) => f.original === name)
      ) {
        const allBindings = new Set([...scopeStack.flat()]);
        if (!allBindings.has(suggestion)) {
          found.push({ original: name, suggestion });
        } else {
          console.warn(
            `⚠️ Skipped "${name}" → "${suggestion}" due to scope conflict.`
          );
        }
      }
    },

    ArrowFunctionExpression(path) {
      const parent = path.parent;
      if (parent.type === "VariableDeclarator" && parent.id?.name) {
        const name = parent.id.name;
        const suggestion = toStyle(name);
        if (
          !isStyle(name) &&
          suggestion !== name &&
          !found.some((f) => f.original === name)
        ) {
          const allBindings = new Set([...scopeStack.flat()]);
          if (!allBindings.has(suggestion)) {
            found.push({ original: name, suggestion });
          } else {
            console.warn(
              `⚠️ Skipped "${name}" → "${suggestion}" due to scope conflict.`
            );
          }
        }
      }
    },
  });

  if (found.length === 0) {
    return vscode.window.showInformationMessage(
      `✅ All names follow ${namingStyle}!`
    );
  }

  let currentCode = code;
  let totalApplied = 0;

  if (applyAll) {
    let updatedCode = currentCode;
    for (const { original, suggestion } of found) {
      updatedCode = updatedCode.replace(
        new RegExp(`\\b${original}\\b`, "g"),
        suggestion
      );
    }

    const previewUri = vscode.Uri.parse(
      `${scheme}:/refactor-preview/all-${namingStyle.replace(/\W/g, "")}.js`
    );
    previewContent.set(previewUri.toString(), updatedCode);

    await vscode.commands.executeCommand(
      "vscode.diff",
      fileUri,
      previewUri,
      `All Naming Changes → ${namingStyle}`
    );

    const confirm = await vscode.window.showInformationMessage(
      `Apply all ${found.length} renaming changes?`,
      "Apply All Now",
      "Cancel"
    );
    if (confirm !== "Apply All Now") return;

    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(currentCode.length)
      );
      edit.replace(fileUri, fullRange, updatedCode);
      await vscode.workspace.applyEdit(edit);
      await document.save();
      totalApplied = found.length;
    } catch {
      vscode.window.showErrorMessage("❌ Failed to apply changes.");
    }
  } else {
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

      const customName = await vscode.window.showInputBox({
        prompt: `Rename "${selection.original}" to:`,
        value: selection.suggestion,
        ignoreFocusOut: true,
      });

      if (!customName || customName === selection.original) continue;

      const confirmedCode = currentCode.replace(
        new RegExp(`\\b${selection.original}\\b`, "g"),
        customName
      );

      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(currentCode.length)
        );
        edit.replace(fileUri, fullRange, confirmedCode);
        await vscode.workspace.applyEdit(edit);
        await document.save();
        currentCode = confirmedCode;
        totalApplied++;
      } catch {
        vscode.window.showErrorMessage("❌ Failed to apply changes.");
      }
    }
  }

  const totalSkipped = found.length - totalApplied;

  if (totalApplied > 0 || totalSkipped > 0) {
    vscode.window.showInformationMessage(
      `✅ ${totalApplied} name${
        totalApplied !== 1 ? "s" : ""
      } updated to ${namingStyle}` +
        (totalSkipped > 0 ? ` | ⏭️ ${totalSkipped} skipped` : "")
    );
  }

  try {
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
  } catch {}
}

module.exports = { run };