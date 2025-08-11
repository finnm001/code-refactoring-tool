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
} = require("../utils/namingUtils.js");

// ---- Language Utilities ----
function detectPreferredStyleFromLanguage(languageId, fileName = "") {
  const ext = fileName.split(".").pop().toLowerCase();
  if (languageId === "python" || ext === "py") return "🐍 snake_case";
  if (["java", "csharp", "c++", "cpp", "cs"].includes(languageId))
    return "🔠 PascalCase";
  return "🐫 camelCase";
}

// ---- Extract Names ----
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

// ---- Main Command ----
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

  const namingStyle = await promptForNamingStyle(languageId, filePath);
  if (!namingStyle) return;

  const { isStyle, toStyle } = getStyleFunctions(namingStyle);
  const found = await findNamingMismatches(
    languageId,
    filePath,
    code,
    namingStyle,
    isStyle,
    toStyle
  );

  if (found.length === 0) {
    if (["python", "csharp"].includes(languageId) || filePath.endsWith(".cs")) {
      return;
    }
    return vscode.window.showInformationMessage(
      `✅ All names follow ${namingStyle}!`
    );
  }

  await proceedWithRenaming(found, {
    document,
    fileUri,
    code,
    scheme,
    previewContent,
    namingStyle,
  });
}

// ---- Helpers ----
async function promptForNamingStyle(languageId, filePath) {
  const suggested = detectPreferredStyleFromLanguage(languageId, filePath);
  return await vscode.window.showQuickPick(
    ["🐍 snake_case", "🐫 camelCase", "🔠 PascalCase"],
    {
      placeHolder: `Choose a naming convention (Suggested: ${suggested})`,
      ignoreFocusOut: true,
    }
  );
}

function getStyleFunctions(namingStyle) {
  if (namingStyle.includes("snake")) {
    return { isStyle: isSnakeCase, toStyle: toSnakeCase };
  } else if (namingStyle.includes("Pascal")) {
    return { isStyle: isPascalCase, toStyle: toPascalCase };
  } else {
    return { isStyle: isCamelCase, toStyle: toCamelCase };
  }
}

function shouldSkipRename(name, style) {
  const shortCommonNames = new Set([
    "sum",
    "avg",
    "max",
    "min",
    "val",
    "num",
    "idx",
    "len",
    "row",
    "col",
    "tmp",
    "res",
    "obj",
  ]);

  const isSingleWord = /^[a-z]+$/.test(name);
  const isShort = name.length <= 4;
  const isCommon = shortCommonNames.has(name.toLowerCase());

  return isSingleWord && isShort && isCommon;
}

async function findNamingMismatches(
  languageId,
  filePath,
  code,
  namingStyle,
  isStyle,
  toStyle
) {
  const found = [];

  if (languageId === "python") {
    const names = extractPythonNames(filePath);
    for (const name of names) {
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        name !== suggestion &&
        !shouldSkipRename(name, namingStyle)
      ) {
        found.push({ original: name, suggestion });
      }
    }
  } else if (languageId === "csharp" || filePath.endsWith(".cs")) {
    const names = extractCSharpNames(filePath);
    for (const name of names) {
      const suggestion = toStyle(name);
      if (
        !isStyle(name) &&
        name !== suggestion &&
        !shouldSkipRename(name, namingStyle)
      ) {
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
      vscode.window.showErrorMessage(
        "❌ Could not parse the file. Check for syntax errors."
      );
      return [];
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
        handleBinding(
          path.node.id.name,
          scopeStack,
          namingStyle,
          isStyle,
          toStyle,
          found
        );
      },
      FunctionDeclaration(path) {
        if (path.node.id?.name) {
          handleBinding(
            path.node.id.name,
            scopeStack,
            namingStyle,
            isStyle,
            toStyle,
            found
          );
        }
      },
    });
  }

  return found;
}

function handleBinding(name, scopeStack, namingStyle, isStyle, toStyle, found) {
  const suggestion = toStyle(name);
  if (
    !isStyle(name) &&
    name !== suggestion &&
    !shouldSkipRename(name, namingStyle)
  ) {
    const allBindings = new Set([...scopeStack.flat()]);
    if (!allBindings.has(suggestion)) {
      found.push({ original: name, suggestion });
    }
  }
}

async function proceedWithRenaming(found, context) {
  const { document, fileUri, code, scheme, previewContent, namingStyle } =
    context;

  const proceedMode = await vscode.window.showQuickPick(
    ["✅ Apply All", "🔍 Review Individually", "❌ Cancel"],
    { placeHolder: "How would you like to proceed with the suggestions?" }
  );
  if (!proceedMode || proceedMode.includes("Cancel")) return;

  let currentCode = code;
  let totalApplied = 0;

  if (proceedMode.includes("Apply All")) {
    const updatedCode = applyAllChanges(currentCode, found);

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
    if (confirm !== "Apply All Now") {
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
      return;
    }

    const success = await applyWorkspaceEdit(
      document,
      fileUri,
      currentCode,
      updatedCode
    );
    if (success) totalApplied = found.length;
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  } else {
    for (const selection of found) {
      const updatedCode = applyChange(
        currentCode,
        selection.original,
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

      const confirmedCode = applyChange(
        currentCode,
        selection.original,
        customName
      );

      const success = await applyWorkspaceEdit(
        document,
        fileUri,
        currentCode,
        confirmedCode
      );
      if (success) {
        currentCode = confirmedCode;
        totalApplied++;
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

function applyAllChanges(code, found) {
  let updatedCode = code;
  for (const { original, suggestion } of found) {
    updatedCode = updatedCode.replace(
      new RegExp(`\\b${original}\\b`, "g"),
      suggestion
    );
  }
  return updatedCode;
}

function applyChange(code, original, suggestion) {
  return code.replace(new RegExp(`\\b${original}\\b`, "g"), suggestion);
}

async function applyWorkspaceEdit(document, fileUri, oldCode, newCode) {
  try {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(oldCode.length)
    );
    edit.replace(fileUri, fullRange, newCode);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    return true;
  } catch {
    vscode.window.showErrorMessage("❌ Failed to apply changes.");
    return false;
  }
}

module.exports = { run: runFixNaming };