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
      "This file has unsaved changes. Save before continuing?",
      "Save and Continue",
      "Cancel"
    );
    if (save !== "Save and Continue") return;
    await document.save();
  }

  const namingStyle = await vscode.window.showQuickPick(
    ["🐫 camelCase", "📐 PascalCase", "🐍 snake_case"],
    {
      placeHolder:
        "What case would you like to use for variable and function names?",
    }
  );
  if (!namingStyle) return; // Exit if user cancels

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
    VariableDeclarator(path) {
      const name = path.node.id.name;
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        suggestion !== name &&
        !found.some((f) => f.original === name)
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
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        suggestion !== name &&
        !found.some((f) => f.original === name)
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
        const suggestion = toStyle(name);
        if (
          !isStyle(name) &&
          suggestion !== name &&
          !found.some((f) => f.original === name)
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
      `✅ All names follow ${namingStyle}!`
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
        currentCode = updatedCode;
        vscode.window.showInformationMessage("✅ Changes applied and saved.");
      } catch {
        vscode.window.showErrorMessage("❌ Failed to apply changes.");
      }
    }

    const tabGroups = vscode.window.tabGroups.all;
    for (const group of tabGroups) {
      for (const tab of group.tabs) {
        if (
          tab.label.includes(`${selection.original} → ${selection.suggestion}`)
        ) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }

    if (i < found.length - 1) {
      const next = await vscode.window.showInformationMessage(
        "Would you like to review the next suggestion?",
        "Yes",
        "No"
      );
      if (next !== "Yes") break;
    }
  }

  try {
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
  } catch {}
}

module.exports = { run };