const vscode = require("vscode");
const child_process = require("child_process");

jest.mock("vscode", () => ({
  window: {
    activeTextEditor: {
      document: {
        isUntitled: false,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function bad_name() {}"),
        uri: { fsPath: "test.js" },
        languageId: "javascript",
        fileName: "test.js",
        positionAt: jest.fn(() => ({ line: 0, character: 0 })),
      },
    },
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(() => Promise.resolve("Save and Continue")),
    showQuickPick: jest.fn(() => Promise.resolve("🐫 camelCase")),
    showInputBox: jest.fn(() => Promise.resolve("goodName")),
    showTextDocument: jest.fn(() => Promise.resolve()),
  },
  workspace: {
    registerTextDocumentContentProvider: jest.fn(() => ({})),
    applyEdit: jest.fn(() => Promise.resolve(true)),
  },
  commands: {
    executeCommand: jest.fn(() => Promise.resolve()),
  },
  Uri: {
    parse: jest.fn((str) => ({ toString: () => str })),
  },
  Range: jest.fn((start, end) => ({ start, end })),
  Position: jest.fn((line, char) => ({ line, char })),
  ViewColumn: { One: 1 },
  WorkspaceEdit: jest.fn(() => ({
    replace: jest.fn(),
  })),
}));

jest.mock("child_process", () => ({
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: JSON.stringify(["bad_name"]),
    stderr: "",
  })),
}));

jest.mock("../../utils/namingUtils", () => ({
  isCamelCase: (str) => str === "goodName",
  isPascalCase: (str) => str === "GoodName",
  isSnakeCase: (str) => str === "bad_name",
  toCamelCase: (str) => (str === "bad_name" ? "goodName" : str),
  toPascalCase: (str) => (str === "bad_name" ? "GoodName" : str),
  toSnakeCase: (str) => (str === "GoodName" ? "bad_name" : str),
}));

const { run } = require("../../features/fixNaming.js");

describe("runFixNaming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function bad_name() {}"),
        uri: { fsPath: "test.js" },
        languageId: "javascript",
        fileName: "test.js",
        positionAt: jest.fn(() => ({ line: 0, character: 0 })),
      },
    };
  });

  it("shows warning if no editor", async () => {
    vscode.window.activeTextEditor = undefined;
    await run({ subscriptions: [] });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "No active file"
    );
  });

  it("shows error if file is untitled", async () => {
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: true,
        isDirty: false,
        getText: jest.fn(),
        save: jest.fn(),
        uri: { fsPath: "test.js" },
        languageId: "javascript",
        fileName: "test.js",
        positionAt: jest.fn(() => ({ line: 0, character: 0 })),
      },
    };
    await run({ subscriptions: [] });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Please save the file first."
    );
  });

  it("cancels if dirty and user says Cancel", async () => {
    vscode.window.activeTextEditor.document.isDirty = true;
    vscode.window.showInformationMessage.mockResolvedValue("Cancel");
    await run({ subscriptions: [] });
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it("exits if user cancels naming style", async () => {
    vscode.window.showQuickPick.mockResolvedValueOnce(undefined);
    await run({ subscriptions: [] });
    expect(vscode.window.showQuickPick).toHaveBeenCalled();
  });

  it("handles JS file and applies all changes", async () => {
    vscode.window.activeTextEditor.document.isDirty = true;

    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");

    vscode.window.showInformationMessage
      .mockResolvedValueOnce("Save and Continue")
      .mockResolvedValueOnce("Apply All Now");

    await run({ subscriptions: [] });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("All Naming Changes")
    );
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  it("handles review individually and applies some", async () => {
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("🔍 Review Individually");

    await run({ subscriptions: [] });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("bad_name → goodName")
    );
    expect(vscode.window.showInputBox).toHaveBeenCalled();
  });

  it("shows info when all names follow convention", async () => {
    vscode.window.showQuickPick.mockResolvedValueOnce("🐫 camelCase");
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => "function goodName() {}"
    );

    await run({ subscriptions: [] });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ All names follow 🐫 camelCase!"
    );
  });

  it("handles invalid JS parsing", async () => {
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => "function {"
    );
    await run({ subscriptions: [] });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Could not parse the file. Check for syntax errors."
    );
  });

  it("extracts Python names using spawn", async () => {
    vscode.window.activeTextEditor.document.languageId = "python";
    vscode.window.activeTextEditor.document.fileName = "script.py";
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => "def bad_name(): pass"
    );

    await run({ subscriptions: [] });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      "python",
      expect.arrayContaining([expect.stringMatching(/py_extractor\.py$/)]),
      expect.any(Object)
    );
  });

  it("handles failed Python name extraction", async () => {
    child_process.spawnSync.mockReturnValueOnce({
      status: 1,
      stderr: "fail",
      stdout: "",
    });
    vscode.window.activeTextEditor.document.languageId = "python";

    await run({ subscriptions: [] });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Failed to parse Python file. Make sure Python is installed and accessible in your system PATH."
    );
  });

  it("extracts C# names using dotnet", async () => {
    vscode.window.activeTextEditor.document.languageId = "csharp";
    vscode.window.activeTextEditor.document.fileName = "MyCode.cs";

    await run({ subscriptions: [] });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      "dotnet",
      expect.arrayContaining([expect.stringMatching(/CsNameExtractor\.dll$/)]),
      expect.any(Object)
    );
  });

  it("handles failed C# name extraction", async () => {
    child_process.spawnSync.mockReturnValueOnce({
      status: 1,
      stderr: "fail",
      stdout: "",
    });

    vscode.window.activeTextEditor.document.languageId = "csharp";

    await run({ subscriptions: [] });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("❌ Failed to parse C# file:")
    );
  });

  it("skips short/common names when PascalCase is chosen", async () => {
    vscode.window.showQuickPick.mockResolvedValueOnce("🔠 PascalCase");
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => "function sum() {}"
    );

    await run({ subscriptions: [] });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "✅ All names follow 🔠 PascalCase!"
    );
  });

  it("handles VariableDeclarator names that require renaming", async () => {
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage
      .mockResolvedValueOnce("Save and Continue")
      .mockResolvedValueOnce("Apply All Now");

    vscode.window.activeTextEditor.document.isDirty = true;
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => `
    const bad_name = 5;
    function goodName() {}
  `
    );

    await run({ subscriptions: [] });

    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  it("cancels rename when user declines Apply All Now", async () => {
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");

    vscode.window.showInformationMessage
      .mockResolvedValueOnce("Save and Continue")
      .mockResolvedValueOnce("Cancel");

    vscode.window.activeTextEditor.document.isDirty = true;

    await run({ subscriptions: [] });

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("shows error if applyEdit fails in Apply All mode", async () => {
    vscode.workspace.applyEdit.mockRejectedValueOnce(new Error("Edit failed"));

    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");

    vscode.window.showInformationMessage
      .mockResolvedValueOnce("Save and Continue")
      .mockResolvedValueOnce("Apply All Now");

    vscode.window.activeTextEditor.document.isDirty = true;

    await run({ subscriptions: [] });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Failed to apply changes."
    );
  });

  it("shows error if applyEdit fails in Review Individually mode", async () => {
    vscode.workspace.applyEdit.mockRejectedValueOnce(new Error("Edit failed"));

    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("🔍 Review Individually");

    vscode.window.showInputBox.mockResolvedValueOnce("renamedThing");

    await run({ subscriptions: [] });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Failed to apply changes."
    );
  });

  it("provides preview content from registered provider", async () => {
    const mockUri = { toString: () => "test-preview-uri" };

    const previewMap = new Map();
    const scheme = "js-refactor-preview";

    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => "function bad_name() {}"
    );

    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValueOnce("Apply All Now");

    const contentProvider = {};

    vscode.workspace.registerTextDocumentContentProvider.mockImplementationOnce(
      (inputScheme, provider) => {
        Object.assign(contentProvider, provider);
        return { dispose: jest.fn() };
      }
    );

    await run({ subscriptions: [] });

    const result = contentProvider.provideTextDocumentContent(mockUri);

    expect(typeof result).toBe("string");
  });

  it("Line 143: PascalCase skips short common names", async () => {
    vscode.window.activeTextEditor.document.getText = jest.fn(
      () => `
      let val = 42;
      let tmp = val + 1;
    `
    );

    vscode.window.showQuickPick
      .mockResolvedValueOnce("🔠 PascalCase")
      .mockResolvedValueOnce("✅ Apply All");

    vscode.window.showInformationMessage.mockResolvedValueOnce("Apply All Now");

    await run({ subscriptions: [] });

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});