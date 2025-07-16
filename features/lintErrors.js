const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { ESLint } = require("eslint");

async function runLintErrors() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showWarningMessage("❌ No active file");
  }

  const document = editor.document;
  const filePath = document.fileName;

  const supportedExtensions = [".js", ".ts", ".jsx", ".tsx"];
  if (!supportedExtensions.some((ext) => filePath.endsWith(ext))) {
    return vscode.window.showErrorMessage(
      `❌ Unsupported file type. Only ${supportedExtensions.join(", ")} supported.`
    );
  }

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

  let hasConfig = configFiles.some((f) =>
    fs.existsSync(path.join(workspacePath, f))
  );

  if (!hasConfig) {
    const pkgPath = path.join(workspacePath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        hasConfig = !!pkg.eslintConfig;
      } catch {
        hasConfig = false;
      }
    }
  }

  if (!hasConfig) {
    return vscode.window.showWarningMessage(
      "⚠️ ESLint config not found. Please follow the Lint for Errors Setup section in the README."
    );
  }

  const codeBefore = document.getText();

  try {
    const eslint = new ESLint({ fix: true, cwd: workspacePath });
    const results = await eslint.lintText(codeBefore, { filePath });

    const fixedCode = results[0].output || codeBefore;
    if (fixedCode === codeBefore) {
      return vscode.window.showInformationMessage("✅ No lint fixes needed!");
    }

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
    previewContent.set(afterUri.toString(), fixedCode);

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

    // Close diff tabs
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    // Re-focus original document
    const reopenedDoc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(reopenedDoc, vscode.ViewColumn.One);

    if (choice === "Apply & Save") {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(codeBefore.length)
      );
      edit.replace(document.uri, fullRange, fixedCode);
      await vscode.workspace.applyEdit(edit);
      await document.save();
      vscode.window.showInformationMessage("✅ ESLint fixes applied!");
    } else {
      vscode.window.showInformationMessage("⚠️ No changes applied.");
    }
  } catch (err) {
    vscode.window.showErrorMessage("❌ ESLint failed: " + (err.message || err));
  }
}

module.exports = { run: runLintErrors };