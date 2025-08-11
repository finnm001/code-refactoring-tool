const { run } = require("../../features/lintErrors.js");

jest.mock("vscode", () => ({
  window: {
    activeTextEditor: null,
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
    registerTextDocumentContentProvider: jest.fn(),
    openTextDocument: jest.fn().mockResolvedValue({}),
    applyEdit: jest.fn(),
  },
  commands: {
    executeCommand: jest.fn(),
  },
  Uri: {
    parse: jest.fn((s) => ({ toString: () => s })),
  },
  ViewColumn: {
    One: 1,
  },
  Range: class {},
  WorkspaceEdit: class {
    replace() {}
  },
}));

jest.mock("fs");
jest.mock("eslint", () => {
  const lintText = jest.fn();
  return {
    ESLint: jest.fn().mockImplementation(() => ({ lintText })),
  };
});

const vscode = require("vscode");
const fs = require("fs");
const { ESLint } = require("eslint");

const mockDocument = (options = {}) => ({
  isUntitled: options.isUntitled || false,
  isDirty: options.isDirty || false,
  fileName: options.fileName || "/mock/file.js",
  getText: () => options.text || "const x = 1;",
  save: jest.fn(),
  positionAt: () => ({}),
  uri: { fsPath: "/mock/file.js" },
});

describe("lintErrors integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows warning if no active editor", async () => {
    vscode.window.activeTextEditor = null;
    await run();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "❌ No active file"
    );
  });

  it("shows error if file is untitled", async () => {
    vscode.window.activeTextEditor = {
      document: mockDocument({ isUntitled: true }),
    };
    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Please save the file first."
    );
  });

  it("returns early if dirty and user cancels", async () => {
    const doc = mockDocument({ isDirty: true });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage.mockResolvedValue("Cancel");
    await run();
    expect(doc.save).not.toHaveBeenCalled();
  });

  it("saves if dirty and user confirms", async () => {
    const doc = mockDocument({ isDirty: true });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");
    fs.existsSync.mockReturnValue(true);

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const x = 1;" }]),
    }));

    await run();
    expect(doc.save).toHaveBeenCalled();
  });

  it("errors on unsupported file types", async () => {
    const doc = mockDocument({ fileName: "/mock/file.txt" });
    vscode.window.activeTextEditor = { document: doc };
    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported file type")
    );
  });

  it("warns when no ESLint config exists", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    fs.existsSync.mockReturnValue(false);
    await run();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("ESLint config not found")
    );
  });

  it("shows info when no fixes are needed", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    fs.existsSync.mockReturnValue(true);

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: undefined }]),
    }));

    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );
  });

  it("applies fixes when user confirms", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    fs.existsSync.mockReturnValue(true);

    vscode.window.showInformationMessage.mockResolvedValueOnce("Apply & Save");

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const y = 2;" }]),
    }));

    await run();
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ ESLint fixes applied!"
    );
  });

  it("does not apply fixes when user cancels", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    fs.existsSync.mockReturnValue(true);

    vscode.window.showInformationMessage.mockResolvedValueOnce("Cancel");

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: "const y = 2;" }]),
    }));

    await run();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "⚠️ No changes applied."
    );
  });

  it("shows error if ESLint throws", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    fs.existsSync.mockReturnValue(true);

    ESLint.mockImplementation(() => {
      throw new Error("ESLint crashed");
    });

    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("ESLint failed")
    );
  });

  it("handles malformed package.json gracefully", async () => {
    const doc = mockDocument("const x = 1;");
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick = jest.fn();
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");

    fs.existsSync.mockImplementation((p) => p.includes("package.json"));
    fs.readFileSync.mockImplementation(() => {
      throw new Error("Malformed JSON");
    });

    await run();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("ESLint config not found")
    );
  });

  it("provideTextDocumentContent returns empty string if no preview content", async () => {
    const doc = mockDocument("const x = 1;");
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage
      .mockResolvedValueOnce("Save and Continue")
      .mockResolvedValueOnce("Apply & Save");

    fs.existsSync.mockReturnValue(true);

    const mockLintResult = [{ output: "const y = 2;" }];
    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue(mockLintResult),
    }));

    const contentMap = new Map();

    vscode.workspace.registerTextDocumentContentProvider = jest.fn(
      (scheme, provider) => {
        const result = provider.provideTextDocumentContent({
          toString: () => "missingKey",
        });
        expect(result).toBe("");
      }
    );

    await run();
  });

  it("detects ESLint config inside package.json", async () => {
    const doc = mockDocument("const x = 1;");
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");

    fs.existsSync.mockImplementation((p) => p.endsWith("package.json"));
    fs.readFileSync.mockImplementation(() =>
      JSON.stringify({ eslintConfig: { rules: {} } })
    );

    ESLint.mockImplementation(() => ({
      lintText: jest.fn().mockResolvedValue([{ output: undefined }]),
    }));

    await run();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );
  });
});