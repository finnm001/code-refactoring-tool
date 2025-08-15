const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

function getDiagnosticCollection() {
  const hasLanguages =
    vscode &&
    vscode.languages &&
    typeof vscode.languages.createDiagnosticCollection === 'function';

  return hasLanguages
    ? vscode.languages.createDiagnosticCollection('lint-for-errors')
    : {
        set() {},
        clear() {},
        delete() {},
        forEach() {},
        dispose() {},
      };
}
const DIAGNOSTICS = getDiagnosticCollection();

// ---- Main Command ----
async function runLintErrors() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showWarningMessage('❌ No active file');
  }

  const document = editor.document;
  const filePath = document.fileName;

  if (document.isUntitled) {
    return vscode.window.showErrorMessage('❌ Please save the file first.');
  }

  if (document.isDirty) {
    const shouldSave = await promptSaveChanges();
    if (shouldSave !== 'Save and Continue') return;
    await document.save();
  }

  if (!isSupportedFile(filePath)) {
    return vscode.window.showErrorMessage(
      '❌ Unsupported file type. Only .js, .ts, .jsx, .tsx supported.'
    );
  }

  if (!(await hasESLintConfig())) {
    return vscode.window.showWarningMessage(
      '⚠️ ESLint config not found. Please follow the Lint for Errors Setup guide in the README.'
    );
  }

  const codeBefore = document.getText();

  try {
    const { fixedCode, messages } = await lintAndFixCode(codeBefore, filePath);

    publishDiagnostics(document.uri, messages);

    if (fixedCode === codeBefore) {
      return vscode.window.showInformationMessage('✅ No lint fixes needed!');
    }

    const userChoice = await showDiffPreview(codeBefore, fixedCode, filePath);

    const reopenedDoc = await vscode.workspace.openTextDocument(document.uri);
    await vscode.window.showTextDocument(reopenedDoc, vscode.ViewColumn.One);

    if (userChoice === 'Apply & Save') {
      await applyFixes(document, fixedCode);

      const relint = await lintAndFixCode(fixedCode, filePath);
      publishDiagnostics(document.uri, relint.messages);

      vscode.window.showInformationMessage('✅ ESLint fixes applied!');
    } else {
      vscode.window.showInformationMessage('⚠️ No changes applied.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      '❌ ESLint failed: ' + (err?.message || String(err))
    );
  }
}

// ---- Helpers ----
async function promptSaveChanges() {
  return vscode.window.showInformationMessage(
    'This file has unsaved changes. Please save before continuing.',
    'Save and Continue',
    'Cancel'
  );
}

function isSupportedFile(filePath) {
  const supportedExtensions = ['.js', '.ts', '.jsx', '.tsx'];
  return supportedExtensions.some((ext) => filePath.endsWith(ext));
}

async function hasESLintConfig() {
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;

  const configFiles = [
    'eslint.config.js',
    'eslint.config.cjs',
    'eslint.config.mjs',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.yaml',
    '.eslintrc.yml',
  ];

  if (configFiles.some((f) => fs.existsSync(path.join(workspacePath, f)))) {
    return true;
  }

  const pkgPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
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
  const [result] = results;

  return {
    fixedCode: result.output ?? code,
    messages: result.messages ?? [],
  };
}

async function showDiffPreview(codeBefore, codeAfter, filePath) {
  const scheme = 'lint-preview';
  const previewContent = new Map();

  const registration = vscode.workspace.registerTextDocumentContentProvider(
    scheme,
    {
      provideTextDocumentContent(uri) {
        return previewContent.get(uri.toString()) || '';
      },
    }
  );

  const ext = path.extname(filePath) || '.txt';
  const beforeUri = vscode.Uri.parse(`${scheme}:/before${ext}`);
  const afterUri = vscode.Uri.parse(`${scheme}:/after${ext}`);

  previewContent.set(beforeUri.toString(), codeBefore);
  previewContent.set(afterUri.toString(), codeAfter);

  await vscode.commands.executeCommand(
    'vscode.diff',
    beforeUri,
    afterUri,
    'Lint Fix Preview'
  );

  const choice = await vscode.window.showInformationMessage(
    'Apply ESLint fixes and save file?',
    'Apply & Save',
    'Cancel'
  );

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  if (registration && typeof registration.dispose === 'function') {
    registration.dispose();
  }

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

  vscode.window.showInformationMessage('✅ ESLint fixes applied!');

  const reopenedDoc = await vscode.workspace.openTextDocument(document.uri);
  await vscode.window.showTextDocument(reopenedDoc, vscode.ViewColumn.One);
}

function publishDiagnostics(uri, messages) {
  const diagnostics = (messages || []).map((m) => {
    const startLine = Math.max(0, (m.line || 1) - 1);
    const startCol = Math.max(0, (m.column || 1) - 1);
    const endLine = Math.max(0, (m.endLine || m.line || 1) - 1);
    const endCol = Math.max(0, (m.endColumn || m.column || 1) - 1);

    const range = new vscode.Range(
      { line: startLine, character: startCol },
      { line: endLine, character: endCol }
    );

    const severity =
      m.severity === 2
        ? (vscode.DiagnosticSeverity &&
            vscode.DiagnosticSeverity.Error) ||
          0
        : (vscode.DiagnosticSeverity &&
            vscode.DiagnosticSeverity.Warning) ||
          1;

    return {
      range,
      message: m.message,
      severity,
      source: 'eslint',
      code: m.ruleId || undefined,
    };
  });

  DIAGNOSTICS.set(uri, diagnostics);
}

module.exports = { run: runLintErrors };