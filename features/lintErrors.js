const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { ESLint } = require("eslint");

// ---- Main Command ----
async function runLintErrors() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showWarningMessage("❌ No active file");
  }

  const document = editor.document;
  const filePath = document.fileName;

  if (document.isUntitled) {
    return vscode.window.showErrorMessage("❌ Please save the file first.");
  }

  if (document.isDirty) {
    const shouldSave = await promptSaveChanges();
    if (shouldSave !== "Save and Continue") return;
    await document.save();
  }

  if (!isSupportedFile(filePath)) {
    return vscode.window.showErrorMessage(
      "❌ Unsupported file type. Only .js, .ts, .jsx, .tsx supported."
    );
  }

  if (!(await hasESLintConfig())) {
    return vscode.window.showWarningMessage(
      "⚠️ ESLint config not found. Please follow the Lint for Errors Setup guide in the README."
    );
  }

  const codeBefore = document.getText();

  try {
    const fixedCode = await lintAndFixCode(codeBefore, filePath);

    if (fixedCode === codeBefore) {
      return vscode.window.showInformationMessage("✅ No lint fixes needed!");
    }

    const userChoice = await showDiffPreview(codeBefore, fixedCode);

    const reopenedDoc = await vscode.workspace.openTextDocument(document.uri);
    await vscode.window.showTextDocument(reopenedDoc, vscode.ViewColumn.One);

    if (userChoice === "Apply & Save") {
      await applyFixes(document, fixedCode);
    } else {
      vscode.window.showInformationMessage("⚠️ No changes applied.");
    }
  } catch (err) {
    vscode.window.showErrorMessage("❌ ESLint failed: " + (err.message || err));
  }
}

// ---- Helpers ----
async function promptSaveChanges() {
  return vscode.window.showInformationMessage(
    "This file has unsaved changes. Please save before continuing.",
    "Save and Continue",
    "Cancel"
  );
}

function isSupportedFile(filePath) {
  const supportedExtensions = [".js", ".ts", ".jsx", ".tsx"];
  return supportedExtensions.some((ext) => filePath.endsWith(ext));
}

async function hasESLintConfig() {
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;

  const configFiles = [
    "eslint.config.js",
    "eslint.config.cjs",
    "eslint.config.mjs",
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.yaml",
    ".eslintrc.yml",
  ];

  if (configFiles.some((f) => fs.existsSync(path.join(workspacePath, f)))) {
    return true;
  }

  const pkgPath = path.join(workspacePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return !!pkg.eslintConfig;
    } catch {
      return false;
    }
  }

  return false;
}

async function lintAndFixCode(code, filePath) {
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;

  const eslint = new ESLint({ fix: true, cwd: workspacePath });
  const results = await eslint.lintText(code, { filePath });

  return results[0].output || code;
}

async function showDiffPreview(codeBefore, codeAfter) {
  const scheme = "lint-preview";
  const previewContent = new Map();

  vscode.workspace.registerTextDocumentContentProvider(scheme, {
    provideTextDocumentContent(uri) {
      return previewContent.get(uri.toString()) || "";
    },
  });

  const beforeUri = vscode.Uri.parse(`${scheme}:/before.js`);
  const afterUri = vscode.Uri.parse(`${scheme}:/after.js`);

  previewContent.set(beforeUri.toString(), codeBefore);
  previewContent.set(afterUri.toString(), codeAfter);

  await vscode.commands.executeCommand(
    "vscode.diff",
    beforeUri,
    afterUri,
    "Lint Fix Preview"
  );

  const choice = await vscode.window.showInformationMessage(
    "Apply ESLint fixes and save file?",
    "Apply & Save",
    "Cancel"
  );

  // Close preview diff editors
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  return choice;
}

async function applyFixes(document, fixedCode) {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );

  edit.replace(document.uri, fullRange, fixedCode);
  await vscode.workspace.applyEdit(edit);
  await document.save();

  vscode.window.showInformationMessage("✅ ESLint fixes applied!");

  // Re-focus original document
  const reopenedDoc = await vscode.workspace.openTextDocument(document.uri);
  await vscode.window.showTextDocument(reopenedDoc, vscode.ViewColumn.One);
}

module.exports = { run: runLintErrors };