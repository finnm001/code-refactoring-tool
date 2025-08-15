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

describe("Publishes diagnostics and disposes preview provider", () => {
  const makeVscodeMock = () => {
    const providerDisposable = { dispose: jest.fn() };
    const diagCollection = {
      set: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    };

    const vscode = {
      window: {
        activeTextEditor: null,
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showTextDocument: jest.fn().mockResolvedValue({}),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
        openTextDocument: jest.fn().mockResolvedValue({}),
        applyEdit: jest.fn(),
        registerTextDocumentContentProvider: jest
          .fn()
          .mockReturnValue(providerDisposable),
      },
      languages: {
        createDiagnosticCollection: jest.fn().mockReturnValue(diagCollection),
      },
      DiagnosticSeverity: { Error: 0, Warning: 1 },
      commands: {
        executeCommand: jest.fn().mockResolvedValue(undefined),
      },
      Uri: { parse: (s) => ({ toString: () => s }) },
      ViewColumn: { One: 1, Beside: 2 },
      Range: function (start, end) {
        return { start, end };
      },
      WorkspaceEdit: function () {
        return { replace: jest.fn() };
      },
      __internals: { providerDisposable, diagCollection },
    };

    return vscode;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("shows 'No lint fixes needed!' and publishes diagnostics when ESLint returns only messages", async () => {
    const vscode = makeVscodeMock();

    const doc = {
      isUntitled: false,
      isDirty: false,
      fileName: "/mock/workspace/src/file.js",
      uri: {
        fsPath: "/mock/workspace/src/file.js",
        toString: () => "uri:/mock/workspace/src/file.js",
      },
      getText: () => "if(a==1){ console.log(a) }",
      positionAt: (n) => n,
      save: jest.fn(),
    };
    vscode.window.activeTextEditor = { document: doc };
    vscode.workspace.openTextDocument.mockResolvedValue(doc);

    jest.doMock("vscode", () => vscode, { virtual: true });
    jest.doMock(
      "fs",
      () => ({ existsSync: () => true, readFileSync: jest.fn() }),
      { virtual: true }
    );

    const lintText = jest.fn().mockResolvedValue([
      {
        output: null,
        messages: [
          {
            line: 1,
            column: 4,
            endLine: 1,
            endColumn: 6,
            severity: 2,
            ruleId: "eqeqeq",
            message: "Expected '===' and instead saw '=='.",
          },
        ],
      },
    ]);
    jest.doMock(
      "eslint",
      () => ({
        ESLint: function () {
          this.lintText = lintText;
        },
      }),
      { virtual: true }
    );

    const { run } = require("../../features/lintErrors.js");
    await run();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ No lint fixes needed!"
    );

    const { diagCollection } = vscode.__internals;
    expect(diagCollection.set).toHaveBeenCalledTimes(1);
    const [uriArg, diags] = diagCollection.set.mock.calls[0];
    expect((uriArg.toString && uriArg.toString()) || uriArg).toContain(
      "/mock/workspace/src/file.js"
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("eqeqeq");
    expect(diags[0].severity).toBe(0);
    expect(diags[0].range.start).toEqual({ line: 0, character: 3 });
    expect(diags[0].range.end).toEqual({ line: 0, character: 5 });
  });

  it("disposes the diff preview provider and shows 'ESLint fixes applied!' on Apply & Save", async () => {
    const vscode = makeVscodeMock();

    const doc = {
      isUntitled: false,
      isDirty: false,
      fileName: "/mock/workspace/src/needs-fix.js",
      uri: {
        fsPath: "/mock/workspace/src/needs-fix.js",
        toString: () => "uri:/mock/workspace/src/needs-fix.js",
      },
      getText: () => "const  x=1+2",
      positionAt: (n) => n,
      save: jest.fn(),
    };
    vscode.window.activeTextEditor = { document: doc };
    vscode.workspace.openTextDocument.mockResolvedValue(doc);

    vscode.window.showInformationMessage.mockResolvedValueOnce("Apply & Save");

    const lintText = jest
      .fn()
      .mockResolvedValueOnce([{ output: "const x = 1 + 2;", messages: [] }])
      .mockResolvedValueOnce([
        {
          output: null,
          messages: [
            {
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 2,
              severity: 1,
              ruleId: "no-console",
              message: "Unexpected console statement.",
            },
          ],
        },
      ]);

    jest.doMock("vscode", () => vscode, { virtual: true });
    jest.doMock(
      "fs",
      () => ({ existsSync: () => true, readFileSync: jest.fn() }),
      { virtual: true }
    );
    jest.doMock(
      "eslint",
      () => ({
        ESLint: function () {
          this.lintText = lintText;
        },
      }),
      { virtual: true }
    );

    const { run } = require("../../features/lintErrors.js");
    await run();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      "Lint Fix Preview"
    );

    const { providerDisposable } = vscode.__internals;
    expect(providerDisposable.dispose).toHaveBeenCalledTimes(1);

    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ ESLint fixes applied!"
    );

    const { diagCollection } = vscode.__internals;
    expect(diagCollection.set).toHaveBeenCalledTimes(2);
    const lastCall = diagCollection.set.mock.calls.at(-1);
    const [, diags] = lastCall;
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("no-console");
    expect(diags[0].severity).toBe(1);
  });
});