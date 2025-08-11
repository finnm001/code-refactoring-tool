const { run } = require("../../features/fixNaming.js");
const vscode = require("vscode");
const child_process = require("child_process");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

jest.mock("vscode", () => ({
  window: {
    activeTextEditor: null,
    showInformationMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showTextDocument: jest.fn(),
  },
  workspace: {
    registerTextDocumentContentProvider: jest.fn(),
    applyEdit: jest.fn(() => true),
  },
  commands: {
    executeCommand: jest.fn(),
  },
  Uri: {
    parse: jest.fn((str) => ({ toString: () => str })),
  },
  Range: class {
    constructor() {}
  },
  WorkspaceEdit: class {
    replace() {}
  },
}));

jest.mock("child_process");
jest.mock("@babel/parser");
jest.mock("@babel/traverse", () => ({ default: jest.fn() }));

const mockDocument = (options = {}) => ({
  uri: { fsPath: "/mock/file.js" },
  fileName: options.fileName || "/mock/file.js",
  languageId: options.languageId || "javascript",
  isUntitled: false,
  isDirty: false,
  getText: jest.fn(
    () => options.text || "const my_var = 1; function my_func() {}"
  ),
  positionAt: jest.fn((n) => ({ line: 0, character: n })),
  save: jest.fn(),
});

describe("fixNaming integration", () => {
  const mockContext = () => ({ subscriptions: [] });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("handles untitled document", async () => {
    const doc = mockDocument();
    doc.isUntitled = true;
    vscode.window.activeTextEditor = { document: doc };
    await run(mockContext());
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please save the file")
    );
  });

  test("handles dirty file and confirms save", async () => {
    const doc = mockDocument({});
    doc.isDirty = true;
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
      visitors.FunctionDeclaration({ node: { id: { name: "my_func" } } });
    });

    await run(mockContext());
    expect(doc.save).toHaveBeenCalled();
  });

  test("handles empty suggestions list", async () => {
    const doc = mockDocument({ text: "const noChange = true;" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation(() => {});

    await run(mockContext());
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("All names follow")
    );
  });

  test("handles parse error", async () => {
    const doc = mockDocument({ text: "syntax !!! error" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockImplementation(() => {
      throw new Error("parse error");
    });

    await run(mockContext());
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not parse")
    );
  });

  test("handles apply all flow for JS", async () => {
    const doc = mockDocument({});
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
      visitors.FunctionDeclaration({ node: { id: { name: "my_func" } } });
    });

    await run(mockContext());
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  test("handles Python naming extraction", async () => {
    const doc = mockDocument({
      languageId: "python",
      fileName: "/mock/script.py",
    });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    child_process.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(["my_var", "my_func"]),
    });

    await run(mockContext());
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  test("handles C# naming extraction", async () => {
    const doc = mockDocument({
      languageId: "csharp",
      fileName: "/mock/code.cs",
    });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐍 snake_case")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    child_process.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(["MyVar", "MyFunc"]),
    });

    await run(mockContext());
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  test("handles Review Individually flow", async () => {
    const doc = mockDocument({});
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("🔍 Review Individually");
    vscode.window.showInputBox.mockResolvedValue("renamedVar");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
    });

    await run(mockContext());
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  test("handles untitled document", async () => {
    const doc = mockDocument();
    doc.isUntitled = true;
    vscode.window.activeTextEditor = { document: doc };

    await run(mockContext());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please save the file")
    );
  });

  test("handles dirty file and confirms save", async () => {
    const doc = mockDocument();
    doc.isDirty = true;
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
      visitors.FunctionDeclaration({ node: { id: { name: "my_func" } } });
    });

    await run(mockContext());

    expect(doc.save).toHaveBeenCalled();
  });

  test("handles empty suggestions list", async () => {
    const doc = mockDocument({ text: "const noChange = true;" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation(() => {});

    await run(mockContext());

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("All names follow")
    );
  });

  test("handles parse error", async () => {
    const doc = mockDocument({ text: "syntax !!! error" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    parser.parse.mockImplementation(() => {
      throw new Error("parse error");
    });

    await run(mockContext());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not parse")
    );
  });

  test("handles apply all flow for JS", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
      visitors.FunctionDeclaration({ node: { id: { name: "my_func" } } });
    });

    await run(mockContext());

    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  test("handles Python naming extraction failure", async () => {
    const doc = mockDocument({
      languageId: "python",
      fileName: "/mock/script.py",
    });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    child_process.spawnSync.mockReturnValue({
      status: 1,
      stderr: "Python error",
    });

    await run(mockContext());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse Python file")
    );
  });

  test("handles C# naming extraction failure", async () => {
    const doc = mockDocument({
      languageId: "csharp",
      fileName: "/mock/code.cs",
    });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐫 camelCase");

    child_process.spawnSync.mockReturnValue({ status: 1, stderr: "C# error" });

    await run(mockContext());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse C# file")
    );
  });

  test("skips short PascalCase common names", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🔠 PascalCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "avg" } } });
    });

    await run(mockContext());

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("All names follow")
    );
  });

  test("handles catch block error for failed edits", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValue("Apply All Now");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
    });

    vscode.workspace.applyEdit = jest.fn(() => {
      throw new Error("edit failure");
    });

    await run(mockContext());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to apply changes")
    );
  });

  test("returns early if no changes in Python extraction", async () => {
    const doc = mockDocument({ languageId: "python", fileName: "test.py" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🐍 snake_case");
    child_process.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([]),
    });
    await run(mockContext());
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("returns early if no changes in C# extraction", async () => {
    const doc = mockDocument({ languageId: "csharp", fileName: "code.cs" });
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick.mockResolvedValue("🔠 PascalCase");
    child_process.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([]),
    });
    await run(mockContext());
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("ensures found suggestions are previewed and skipped if canceled", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐫 camelCase")
      .mockResolvedValueOnce("✅ Apply All");
    vscode.window.showInformationMessage.mockResolvedValueOnce("Cancel");

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.VariableDeclarator({ node: { id: { name: "my_var" } } });
    });

    await run(mockContext());

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.closeActiveEditor"
    );
  });

  test("handles custom rename cancel in individual mode", async () => {
    const doc = mockDocument();
    vscode.window.activeTextEditor = { document: doc };
    vscode.window.showQuickPick
      .mockResolvedValueOnce("🐍 snake_case")
      .mockResolvedValueOnce("🔍 Review Individually");
    vscode.window.showInputBox.mockResolvedValue(null); // cancel input

    parser.parse.mockReturnValue({});
    traverse.mockImplementation((ast, visitors) => {
      visitors.FunctionDeclaration({ node: { id: { name: "myFunc" } } });
    });

    await run(mockContext());

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});