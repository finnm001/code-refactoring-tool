const {
  run,
  analyseCodeStructure,
  createHtmlContent,
  parseCodeToAST,
  handlePanelMessages,
  exportPdf,
} = require("../../features/checkStructure.js");

jest.mock("vscode", () => ({
  window: {
    activeTextEditor: null,
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn().mockResolvedValue({
      selection: null,
      revealRange: jest.fn(),
    }),
    createWebviewPanel: jest.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/fake/project" } }],
    openTextDocument: jest.fn().mockResolvedValue({}),
  },
  Position: function (line, char) {
    return { line, character: char };
  },
  Selection: function (start, end) {
    return { start, end };
  },
  Range: function (start, end) {
    return { start, end };
  },
  TextEditorRevealType: {
    InCenter: "InCenter",
  },
  ViewColumn: {
    One: 1,
    Beside: 2,
  },
}));

jest.mock("puppeteer", () => {
  const setContent = jest.fn().mockResolvedValue();
  const pdf = jest.fn().mockResolvedValue();
  const evaluate = jest.fn().mockResolvedValue();
  const newPage = jest.fn().mockResolvedValue({ setContent, evaluate, pdf });
  const close = jest.fn().mockResolvedValue();

  return {
    launch: jest.fn().mockResolvedValue({ newPage, close }),
    __mocks__: { setContent, evaluate, pdf, newPage, close },
  };
});

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

jest.spyOn(fs, "existsSync").mockImplementation(() => false);
jest.spyOn(fs, "mkdirSync").mockImplementation(() => {});
jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});

describe("checkStructure integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("warns when no active editor is present", async () => {
    vscode.window.activeTextEditor = null;
    await run();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "❌ No active file"
    );
  });

  it("errors when file is untitled", async () => {
    vscode.window.activeTextEditor = {
      document: { isUntitled: true },
    };
    await run();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Please save the file first."
    );
  });

  it("skips run if dirty and user cancels", async () => {
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: true,
        save: jest.fn(),
      },
    };
    vscode.window.showInformationMessage.mockResolvedValue("Cancel");
    await run();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(vscode.window.activeTextEditor.document.save).not.toHaveBeenCalled();
  });

  it("saves and runs if dirty and user confirms", async () => {
    const mockDocument = {
      isUntitled: false,
      isDirty: true,
      uri: { fsPath: "/fake/project/file.js" },
      getText: () => `function test() { return 1; }`,
      save: jest.fn(),
    };
    vscode.window.activeTextEditor = { document: mockDocument };
    vscode.window.showInformationMessage.mockResolvedValue("Save and Continue");

    vscode.window.createWebviewPanel.mockReturnValue({
      webview: { html: "", onDidReceiveMessage: jest.fn() },
    });

    await run();
    expect(mockDocument.save).toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });

  it("handles syntax errors gracefully", async () => {
    const code = `function () {`; // Invalid
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: false,
        uri: { fsPath: "file.js" },
        getText: () => code,
        save: jest.fn(),
      },
    };

    const parseMock = jest
      .spyOn(require("@babel/parser"), "parse")
      .mockImplementation(() => {
        throw new Error("Syntax error");
      });

    await run();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Could not parse the file. Check for syntax errors."
    );

    parseMock.mockRestore();
  });

  it("analyses basic structure correctly", () => {
    const code = `
      // top-level comment
      /** doc */
      function add(a, b) {
        return a + b;
      }

      function subtract(x, y) {
        console.log("side effect");
        return x - y;
      }
    `;
    const ast = parseCodeToAST(code);
    const result = analyseCodeStructure(ast, code, code.split("\n").length);

    expect(result.totalFunctions).toBe(2);
    expect(result.undocumented.length).toBe(1);
    expect(result.untestable.length).toBe(1);
    expect(result.commentDensity).toMatch(/^\d+\.\d$/);
    expect(result.healthScore).toBeLessThanOrEqual(100);
  });

  it("builds HTML report with expected content", () => {
    const fakeUri = { fsPath: "example.js" };
    const results = {
      totalFunctions: 2,
      avgFnLength: 5,
      commentDensity: "25.0",
      healthScore: 80,
      techDebtScore: 20,
      longFunctions: [],
      highComplexity: [],
      untestable: [],
      undocumented: [],
      observations: ["<strong>Example</strong> warning"],
    };
    const html = createHtmlContent(fakeUri, results, 42);
    expect(html).toContain("Structure Report: example.js");
    expect(html).toContain("📄 Export as PDF");
    expect(html).toContain("🧠 Refactoring Opportunities");
  });

  it("handles exportPdf call", async () => {
    const html = "<html><body>Hello</body></html>";
    const uri = { fsPath: "/fake/project/hello.js" };
    await exportPdf(uri, html);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("PDF saved to:")
    );
  });

  it("handles exportPdf failure", async () => {
    const puppeteer = require("puppeteer");
    puppeteer.launch.mockRejectedValueOnce(new Error("fail"));

    await exportPdf({ fsPath: "/fake/fail.js" }, "<html></html>");
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("❌ Failed to generate PDF")
    );
  });

  it("handles jumpTo message", async () => {
    const fakePanel = {
      webview: {
        onDidReceiveMessage: (cb) => {
          cb({ type: "jumpTo", line: 5 });
        },
      },
    };
    await handlePanelMessages(fakePanel, { fsPath: "file.js" }, {}, 100);
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  it("covers long, complex, untestable, and low comment cases", () => {
    const repeatedLogs = "console.log(1);\n".repeat(51);
    const code = `
        // comment
        function Longy() {
            ${repeatedLogs}
        }

        function Complexo(a) {
            if (a) {} if (a) {} if (a) {} if (a) {}
            if (a) {} if (a) {} if (a) {} if (a) {}
            return true;
        }

        function SideEffector() {
            console.log("⚠️");
        }

        function duplicateAgain() {}
        function duplicate() {}
    `;
    const ast = parseCodeToAST(code);
    const result = analyseCodeStructure(ast, code, code.split("\n").length);

    expect(result.longFunctions.some((f) => f.name === "Longy")).toBe(true);
    expect(result.highComplexity.some((f) => f.name === "Complexo")).toBe(true);
    expect(result.untestable.some((f) => f.name === "SideEffector")).toBe(true);

    const expectedObservations = [
      "Length Concerns",
      "Complex Logic",
      "Testability Issues",
      "Redundant Logic",
      "Low Comment Density",
      "Documentation Gaps",
    ];

    expectedObservations.forEach((expected) => {
      expect(result.observations.some((obs) => obs.includes(expected))).toBe(
        true
      );
    });
  });

  it("builds HTML with all report types listed", () => {
    const results = {
      totalFunctions: 3,
      avgFnLength: 51,
      commentDensity: "10.0",
      healthScore: 60,
      techDebtScore: 40,
      longFunctions: [{ name: "Longy", length: 51 }],
      highComplexity: [{ name: "Complexo", complexity: 10 }],
      untestable: [{ name: "SideEffector" }],
      undocumented: [],
      observations: ["<strong>Example</strong> warning"],
    };
    const html = createHtmlContent({ fsPath: "sample.js" }, results, 100);
    expect(html).toContain("Longy (51 lines)");
    expect(html).toContain("Complexo (Complexity: 10)");
    expect(html).toContain("SideEffector – side effects detected");
  });

  it("handles exportPdf trigger from handlePanelMessages", async () => {
    let messageHandler;
    const fakePanel = {
      webview: {
        onDidReceiveMessage: (cb) => {
          messageHandler = cb;
        },
      },
    };

    handlePanelMessages(
      fakePanel,
      { fsPath: "/fake/project/trigger.js" },
      {
        totalFunctions: 0,
        avgFnLength: "0.0",
        commentDensity: "0.0",
        healthScore: 100,
        techDebtScore: 0,
        longFunctions: [],
        highComplexity: [],
        untestable: [],
        undocumented: [],
        observations: [],
      },
      20
    );

    await messageHandler({ type: "exportPdf" });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("PDF saved")
    );
  });
});