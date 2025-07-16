const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const child_process = require("child_process");
const path = require("path");

const {
  isCamelCase,
  isPascalCase,
  isSnakeCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} = require("../utils/namingUtils");

function detectPreferredStyleFromLanguage(languageId, fileName = "") {
  const ext = fileName.split(".").pop().toLowerCase();
  if (languageId === "python" || ext === "py") return "🐍 snake_case";
  if (["java", "csharp", "c++", "cpp", "cs"].includes(languageId))
    return "🔠 PascalCase";
  return "👫 camelCase";
}

function extractPythonNames(filePath) {
  const scriptPath = path.join(__dirname, "../utils/py_extractor.py");
  try {
    const result = child_process.spawnSync("python", [scriptPath, filePath], {
      encoding: "utf-8",
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout);
  } catch (err) {
    vscode.window.showErrorMessage(
      "❌ Failed to parse Python file. Make sure Python is installed and accessible in your system PATH."
    );
    return [];
  }
}

function extractCSharpNames(filePath) {
  const dllPath = path.join(__dirname, "../utils/CsNameExtractor.dll");
  try {
    const result = child_process.spawnSync("dotnet", [dllPath, filePath], {
      encoding: "utf-8",
    });

    console.log("stdout:", result.stdout);
    console.log("stderr:", result.stderr);
    console.log("exit code:", result.status);

    if (result.status !== 0)
      throw new Error(result.stderr || "Non-zero exit code");

    return JSON.parse(result.stdout);
  } catch (err) {
    vscode.window.showErrorMessage(
      `❌ Failed to parse C# file: ${err.message || "Unknown error"}.`
    );
    return [];
  }
}

async function runFixNaming(context) {
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
  const languageId = document.languageId;
  const filePath = document.fileName;
  const code = document.getText();

  if (document.isUntitled)
    return vscode.window.showErrorMessage("❌ Please save the file first.");
  if (document.isDirty) {
    const save = await vscode.window.showInformationMessage(
      "This file has unsaved changes. Please save before continuing.",
      "Save and Continue",
      "Cancel"
    );
    if (save !== "Save and Continue") return;
    await document.save();
  }

  const suggestedStyle = detectPreferredStyleFromLanguage(languageId, filePath);
  const namingStyle = await vscode.window.showQuickPick(
    ["🐍 snake_case", "🐫 camelCase", "🔠 PascalCase"],
    {
      placeHolder: `Choose a naming convention (Suggested: ${suggestedStyle})`,
      ignoreFocusOut: true,
    }
  );
  if (!namingStyle) return;

  const isStyle = namingStyle.includes("snake")
    ? isSnakeCase
    : namingStyle.includes("Pascal")
    ? isPascalCase
    : isCamelCase;

  const toStyle = namingStyle.includes("snake")
    ? toSnakeCase
    : namingStyle.includes("Pascal")
    ? toPascalCase
    : toCamelCase;

  const found = [];

  if (languageId === "python") {
    const names = extractPythonNames(filePath);
    if (!names || names.length === 0) return; // Exit if names couldn't be extracted

    for (const name of names) {
      const suggestion = toStyle(name);
      if (!isStyle(name) && name !== suggestion) {
        found.push({ original: name, suggestion });
      }
    }
  } else if (languageId === "csharp" || filePath.endsWith(".cs")) {
    const names = extractCSharpNames(filePath);
    if (!names || names.length === 0) return; // Exit if names couldn't be extracted

    for (const name of names) {
      const suggestion = toStyle(name);
      if (!isStyle(name) && name !== suggestion) {
        found.push({ original: name, suggestion });
      }
    }
  } else {
    let ast;
    try {
      ast = parser.parse(code, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch {
      return vscode.window.showErrorMessage(
        "❌ Could not parse the file. Check for syntax errors."
      );
    }

    const scopeStack = [];

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
        if (!isStyle(name) && name !== suggestion) {
          const allBindings = new Set([...scopeStack.flat()]);
          if (!allBindings.has(suggestion)) {
            found.push({ original: name, suggestion });
          }
        }
      },
      FunctionDeclaration(path) {
        const name = path.node.id?.name;
        if (!name) return;
        const suggestion = toStyle(name);
        if (!isStyle(name) && name !== suggestion) {
          const allBindings = new Set([...scopeStack.flat()]);
          if (!allBindings.has(suggestion)) {
            found.push({ original: name, suggestion });
          }
        }
      },
    });
  }

  if (found.length === 0) {
    return vscode.window.showInformationMessage(
      `✅ All names follow ${namingStyle}!`
    );
  }

  const proceedMode = await vscode.window.showQuickPick(
    ["✅ Apply All", "🔍 Review Individually", "❌ Cancel"],
    { placeHolder: "How would you like to proceed with the suggestions?" }
  );
  if (!proceedMode || proceedMode.includes("Cancel")) return;
  const applyAll = proceedMode.includes("Apply All");

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
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
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
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
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

module.exports = { run: runFixNaming };