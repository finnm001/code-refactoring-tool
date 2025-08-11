const { run } = require("../../features/lintErrors.js");
const fs = require("fs");
const { ESLint } = require("eslint");

jest.mock("vscode", () => ({
  window: {
    activeTextEditor: null,
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/fake/project" } }],
    registerTextDocumentContentProvider: jest.fn(),
    applyEdit: jest.fn(),
    openTextDocument: jest.fn().mockResolvedValue({}),
  },
  Uri: {
    parse: (str) => ({ toString: () => str }),
  },
  Range: function (start, end) {
    return { start, end };
  },
  WorkspaceEdit: function () {
    return {
      replace: jest.fn(),
    };
  },
  commands: {
    executeCommand: jest.fn(),
  },
  ViewColumn: { One: 1 },
}));

jest.mock("fs");
jest.mock("eslint");

describe("runLintErrors", () => {
  const vscode = require("vscode");

  const setupEditor = (overrides = {}) => ({
    document: {
      isUntitled: false,
      isDirty: false,
      fileName: "test.js",
      getText: () => "const a = 1;",
      positionAt: (offset) => offset,
      save: jest.fn(),
      uri: "uri:test.js",
      ...overrides,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles no active editor", async () => {
    vscode.window.activeTextEditor = null;
    await run();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "❌ No active file"
    );
  });

  it("handles untitled file", async () => {
    vscode.window.activeTextEditor = setupEditor({ isUntitled: true });
    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Please save the file first."
    );
  });

  it("handles dirty file: Save and Continue", async () => {
    vscode.window.activeTextEditor = setupEditor({ isDirty: true });
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");

    fs.existsSync.mockReturnValue(true);
    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: null }]),
    }));

    await run();
    expect(vscode.window.activeTextEditor.document.save).toHaveBeenCalled();
  });

  it("handles dirty file: Cancel", async () => {
    vscode.window.activeTextEditor = setupEditor({ isDirty: true });
    vscode.window.showInformationMessage.mockResolvedValue("Cancel");
    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "This file has unsaved changes. Please save before continuing.",
      "Save and Continue",
      "Cancel"
    );
  });

  it("handles unsupported file extension", async () => {
    vscode.window.activeTextEditor = setupEditor({ fileName: "test.txt" });
    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("❌ Unsupported file type")
    );
  });

  it("detects config from file", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockImplementation((p) => p.includes(".eslintrc.json"));

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: null }]),
    }));

    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );
  });

  it("detects config from package.json", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockImplementation((p) => p.includes("package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ eslintConfig: {} }));

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: null }]),
    }));

    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );
  });

  it("shows warning when no ESLint config", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(false);
    await run();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("⚠️ ESLint config not found")
    );
  });

  it("handles no lint fixes needed", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(true);

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: null }]),
    }));

    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );
  });

  it("applies fixes when user chooses 'Apply & Save'", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(true);
    vscode.window.showInformationMessage.mockResolvedValueOnce("Apply & Save");

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const a = 2;" }]),
    }));

    await run();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      "Lint Fix Preview"
    );
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ ESLint fixes applied!"
    );
  });

  it("does not apply fixes when user cancels", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(true);
    vscode.window.showInformationMessage.mockResolvedValueOnce("Cancel");

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const a = 2;" }]),
    }));

    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "⚠️ No changes applied."
    );
  });

  it("shows error if ESLint throws", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(true);

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockRejectedValue(new Error("Lint failed")),
    }));

    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ ESLint failed: Lint failed"
    );
  });

  it("handles malformed package.json", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockImplementation((p) => p.includes("package.json"));
    fs.readFileSync.mockImplementation(() => {
      throw new Error("parse error");
    });

    await run();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("⚠️ ESLint config not found")
    );
  });

  it("registerTextDocumentContentProvider provides fallback string", async () => {
    vscode.window.activeTextEditor = setupEditor();
    fs.existsSync.mockReturnValue(true);
    vscode.window.showInformationMessage.mockResolvedValue("Cancel");

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const a = 2;" }]),
    }));

    let provider;
    vscode.workspace.registerTextDocumentContentProvider.mockImplementation(
      (_, prov) => {
        provider = prov;
      }
    );

    await run();

    const result = provider.provideTextDocumentContent({
      toString: () => "not-found",
    });
    expect(result).toBe("");
  });
});