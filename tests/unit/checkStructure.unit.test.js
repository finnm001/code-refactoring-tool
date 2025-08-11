const { parse } = require("@babel/parser");
const fs = require("fs");
const path = require("path");

jest.mock("vscode", () => ({
  window: {
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    activeTextEditor: {
      document: {
        isUntitled: false,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function foo() {}"),
        uri: { fsPath: "test.js" },
      },
    },
    ViewColumn: { Beside: 2, One: 1 },
    Selection: function (start, end) {
      return { start, end };
    },
    Range: function (start, end) {
      return { start, end };
    },
    TextEditorRevealType: { InCenter: 0 },
    showTextDocument: jest.fn(() =>
      Promise.resolve({
        selection: null,
        revealRange: jest.fn(),
      })
    ),
    createWebviewPanel: jest.fn(() => ({
      webview: {
        onDidReceiveMessage: jest.fn(),
      },
    })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: __dirname } }],
    openTextDocument: jest.fn(() =>
      Promise.resolve({
        uri: { fsPath: "test.js" },
      })
    ),
  },
  ViewColumn: { Beside: 2, One: 1 },
  Position: function (line, char) {
    return { line, char };
  },
  Selection: function (start, end) {
    return { start, end };
  },
  Range: function (start, end) {
    return { start, end };
  },
  TextEditorRevealType: { InCenter: 0 },
}));

jest.mock("puppeteer", () => ({
  launch: jest.fn(() =>
    Promise.resolve({
      newPage: jest.fn(() =>
        Promise.resolve({
          setContent: jest.fn(() => Promise.resolve()),
          pdf: jest.fn(() => Promise.resolve()),
        })
      ),
      close: jest.fn(() => Promise.resolve()),
    })
  ),
}));

const {
  analyseCodeStructure,
  extractFunctionMetrics,
  checkTestability,
  parseCodeToAST,
  run: runCheckStructure,
  promptSaveChanges,
  exportPdf,
  createWebviewPanel,
  handlePanelMessages,
  createHtmlContent,
} = require("../../features/checkStructure.js");

function analyse(code) {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    ranges: true,
    tokens: true,
    errorRecovery: true,
    attachComment: true,
  });
  const lines = code.split("\n").length;
  return analyseCodeStructure(ast, code, lines);
}

describe("analyseCodeStructure", () => {
  it("returns correct metrics for a single documented function", () => {
    const code = `
      /**
       * Adds two numbers.
       */
      function add(a, b) {
        return a + b;
      }
    `;
    const result = analyse(code);
    expect(result.totalFunctions).toBe(1);
    expect(result.avgFnLength).toBe("2.0");
    expect(result.commentDensity).toMatch(/^\d+\.\d$/);
    expect(result.functions[0].name).toBe("add");
    expect(result.functions[0].documented).toBe(true);
    expect(result.undocumented.length).toBe(0);
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.techDebtScore).toBeGreaterThanOrEqual(0);
  });

  it("detects undocumented functions", () => {
    const code = `
      function foo() { return 1; }
      function bar() { return 2; }
    `;
    const result = analyse(code);
    expect(result.totalFunctions).toBe(2);
    expect(result.undocumented.length).toBe(2);
    expect(
      result.observations.some((o) => o.includes("Documentation Gaps"))
    ).toBe(true);
  });

  it("detects long functions", () => {
    const code = `
      function longFn() {
        ${Array(52).fill("console.log(1);").join("\n")}
      }
    `;
    const result = analyse(code);
    expect(result.longFunctions.length).toBe(1);
    expect(result.longFunctions[0].name).toBe("longFn");
    expect(result.observations.some((o) => o.includes("Length Concerns"))).toBe(
      true
    );
  });

  it("detects high complexity functions", () => {
    const code = `
      function complex() {
        if (a) {} if (b) {} if (c) {} if (d) {} if (e) {} if (f) {} if (g) {} if (h) {} if (i) {}
      }
    `;
    const result = analyse(code);
    expect(result.highComplexity.length).toBe(1);
    expect(result.highComplexity[0].name).toBe("complex");
    expect(result.observations.some((o) => o.includes("Complex Logic"))).toBe(
      true
    );
  });

  it("detects untestable functions (side effects)", () => {
    const code = `
      function sideEffect() {
        console.log("hi");
        return 1;
      }
      function pure() {
        return 2;
      }
    `;
    const result = analyse(code);
    expect(result.untestable.length).toBe(1);
    expect(result.untestable[0].name).toBe("sideEffect");
    expect(
      result.observations.some((o) => o.includes("Testability Issues"))
    ).toBe(true);
  });

  it("detects redundant logic (duplicate function names)", () => {
    const code = `
      function foo() { return 1; }
      function fooAgain() { return 2; }
    `;
    const result = analyse(code);
    expect(result.observations.some((o) => o.includes("Redundant Logic"))).toBe(
      true
    );
  });

  it("detects low comment density", () => {
    const code = `
      function a() { return 1; }
      function b() { return 2; }
    `;
    const result = analyse(code);
    expect(parseFloat(result.commentDensity)).toBeLessThan(20);
    expect(
      result.observations.some((o) => o.includes("Low Comment Density"))
    ).toBe(true);
  });

  it("handles empty code gracefully", () => {
    const code = ``;
    const result = analyse(code);
    expect(result.totalFunctions).toBe(0);
    expect(result.avgFnLength).toBe("0.0");
    expect(result.commentDensity).toBe("0.0");
    expect(result.observations.length).toBe(0);
  });

  it("handles code with only comments", () => {
    const code = `
      // just a comment
      /* block comment */
    `;
    const result = analyse(code);
    expect(result.totalFunctions).toBe(0);
    expect(parseFloat(result.commentDensity)).toBeGreaterThan(0);
    if (result.observations.length > 0) {
      expect(result.observations[0]).toContain("Low Comment Density");
    }
  });

  it("handles multiple for loops for redundancy", () => {
    const code = `
      function a() { for (let i = 0; i < 10; i++) {} }
      function b() { for (let j = 0; j < 10; j++) {} }
    `;
    const result = analyse(code);
    expect(result.observations.some((o) => o.includes("Redundant Logic"))).toBe(
      true
    );
  });
});

describe("extractFunctionMetrics", () => {
  it("calculates metrics for a simple function", () => {
    const ast = parse("function foo(a, b) { return a + b; }", {
      sourceType: "module",
    });
    let metrics;
    require("@babel/traverse").default(ast, {
      FunctionDeclaration(path) {
        metrics = extractFunctionMetrics(path);
      },
    });
    expect(metrics.name).toBe("foo");
    expect(metrics.length).toBeGreaterThanOrEqual(0);
    expect(metrics.params).toBe(2);
    expect(metrics.complexity).toBeGreaterThanOrEqual(1);
    expect(metrics.nesting).toBeGreaterThanOrEqual(0);
  });
});

describe("checkTestability", () => {
  it("detects side effects and purity", () => {
    const ast = parse("function foo() { console.log('hi'); return 1; }", {
      sourceType: "module",
    });
    let testability;
    require("@babel/traverse").default(ast, {
      FunctionDeclaration(path) {
        testability = checkTestability(path);
      },
    });
    expect(testability.hasSideEffects).toBe(true);
    expect(testability.isPure).toBe(false);
  });

  it("detects pure function", () => {
    const ast = parse("function bar() { return 2; }", { sourceType: "module" });
    let testability;
    require("@babel/traverse").default(ast, {
      FunctionDeclaration(path) {
        testability = checkTestability(path);
      },
    });
    expect(testability.hasSideEffects).toBe(false);
    expect(testability.isPure).toBe(true);
  });
});

describe("parseCodeToAST", () => {
  it("parses code to AST", () => {
    const code = "function foo() {}";
    const ast = parseCodeToAST(code);
    expect(ast.type).toBe("File");
  });
});

describe("promptSaveChanges", () => {
  it("calls vscode.window.showInformationMessage", async () => {
    const vscode = require("vscode");
    await promptSaveChanges({});
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});

describe("exportPdf", () => {
  it("calls puppeteer and saves PDF", async () => {
    const vscode = require("vscode");
    const html = "<html></html>";
    const fileUri = { fsPath: "test.js" };
    await exportPdf(fileUri, html);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});

describe("createWebviewPanel", () => {
  it("creates a webview panel and sets html", () => {
    const vscode = require("vscode");
    vscode.window.createWebviewPanel = jest.fn(() => ({
      webview: {
        onDidReceiveMessage: jest.fn(),
      },
    }));
    const panel = createWebviewPanel({ fsPath: "test.js" }, "<html></html>");
    expect(panel.webview).toBeDefined();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });
});

describe("handlePanelMessages", () => {
  it("handles exportPdf and jumpTo messages", async () => {
    const vscode = require("vscode");
    const panel = {
      webview: {
        onDidReceiveMessage: (cb) => {
          cb({ type: "exportPdf" });
          cb({ type: "jumpTo", line: 1 });
        },
      },
    };
    const fileUri = { fsPath: "test.js" };
    const results = { totalFunctions: 1 };
    const lines = 10;
    await handlePanelMessages(panel, fileUri, results, lines);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});

describe("createHtmlContent", () => {
  it("generates HTML content with all sections", () => {
    const fileUri = { fsPath: "test.js" };
    const results = {
      totalFunctions: 1,
      avgFnLength: "2.0",
      commentDensity: "10.0",
      healthScore: 80,
      techDebtScore: 20,
      functions: [{ name: "foo" }],
      longFunctions: [],
      highComplexity: [],
      untestable: [],
      undocumented: [],
      observations: ["Test observation"],
    };
    const html = createHtmlContent(fileUri, results, 10);
    expect(html).toContain("Structure Report");
    expect(html).toContain("File Summary");
    expect(html).toContain("Health Score");
    expect(html).toContain("Technical Debt");
    expect(html).toContain("Refactoring Opportunities");
    expect(html).toContain("Observations");
  });
});

describe("runCheckStructure", () => {
  it("runs without error if editor exists", async () => {
    const vscode = require("vscode");
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function foo() {}"),
        uri: { fsPath: "test.js" },
      },
    };
    vscode.window.createWebviewPanel = jest.fn(() => ({
      webview: {
        onDidReceiveMessage: jest.fn(),
      },
    }));
    vscode.workspace.openTextDocument = jest.fn(() =>
      Promise.resolve({ uri: { fsPath: "test.js" } })
    );
    await runCheckStructure();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });

  it("shows warning if no active editor", async () => {
    const vscode = require("vscode");
    vscode.window.activeTextEditor = undefined;
    await runCheckStructure();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "❌ No active file"
    );
  });

  it("shows error if file is untitled", async () => {
    const vscode = require("vscode");
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: true,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function foo() {}"),
        uri: { fsPath: "test.js" },
      },
    };
    await runCheckStructure();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Please save the file first."
    );
  });

  it("shows error if parse fails", async () => {
    const vscode = require("vscode");
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn(() => "function {"),
        uri: { fsPath: "test.js" },
      },
    };
    await runCheckStructure();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "❌ Could not parse the file. Check for syntax errors."
    );
  });

  it("returns if user cancels save on dirty file", async () => {
    const vscode = require("vscode");
    vscode.window.activeTextEditor = {
      document: {
        isUntitled: false,
        isDirty: true,
        save: jest.fn(),
        getText: jest.fn(() => "function foo() {}"),
        uri: { fsPath: "test.js" },
      },
    };
    vscode.window.showInformationMessage = jest.fn(() =>
      Promise.resolve("Cancel")
    );
    vscode.window.createWebviewPanel.mockClear();
    vscode.window.showErrorMessage.mockClear();
    await runCheckStructure();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});

describe("exportPdf", () => {
  it("creates the reports directory if it does not exist", async () => {
    const vscode = require("vscode");
    const html = "<html></html>";
    const fileUri = { fsPath: "test.js" };
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const mkdirSpy = jest.spyOn(fs, "mkdirSync").mockImplementation(() => {});
    await exportPdf(fileUri, html);
    expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });
    fs.existsSync.mockRestore();
    fs.mkdirSync.mockRestore();
  });

  it("shows error if puppeteer fails", async () => {
    const vscode = require("vscode");
    const html = "<html></html>";
    const fileUri = { fsPath: "test.js" };
    const originalLaunch = require("puppeteer").launch;
    require("puppeteer").launch.mockImplementationOnce(() => {
      throw new Error("fail");
    });
    await exportPdf(fileUri, html);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("❌ Failed to generate PDF")
    );
    require("puppeteer").launch = originalLaunch;
  });

  it("does not throw if reportsDir already exists", async () => {
    const vscode = require("vscode");
    const html = "<html></html>";
    const fileUri = { fsPath: "test.js" };
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    await exportPdf(fileUri, html);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    fs.existsSync.mockRestore();
  });
});

describe("createHtmlContent", () => {
  it("renders <li>None</li> for empty arrays", () => {
    const fileUri = { fsPath: "test.js" };
    const results = {
      totalFunctions: 0,
      avgFnLength: "0.0",
      commentDensity: "0.0",
      healthScore: 100,
      techDebtScore: 0,
      functions: [],
      longFunctions: [],
      highComplexity: [],
      untestable: [],
      undocumented: [],
      observations: [],
    };
    const html = createHtmlContent(fileUri, results, 0);
    expect(html).toContain("<li>None</li>");
  });

  it("renders <li>None</li> for each empty section", () => {
    const fileUri = { fsPath: "test.js" };
    const results = {
      totalFunctions: 0,
      avgFnLength: "0.0",
      commentDensity: "0.0",
      healthScore: 100,
      techDebtScore: 0,
      functions: [],
      longFunctions: [],
      highComplexity: [],
      untestable: [],
      undocumented: [],
      observations: [],
    };
    const html = createHtmlContent(fileUri, results, 0);
    expect(html).toMatch(/Long Functions<\/h3><ul><li>None<\/li><\/ul>/);
    expect(html).toMatch(
      /High Complexity Functions<\/h3><ul><li>None<\/li><\/ul>/
    );
    expect(html).toMatch(/Untestable Functions<\/h3><ul><li>None<\/li><\/ul>/);
    expect(html).toMatch(
      /Undocumented Functions<\/h2>\s*<ul><li>None<\/li><\/ul>/
    );
    expect(html).toMatch(/Observations<\/h2><ul><li>None<\/li><\/ul>/);
  });
});