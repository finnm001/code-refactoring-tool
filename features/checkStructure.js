const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

async function runStructureCheck() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showWarningMessage("❌ No active file");

  const document = editor.document;
  const fileUri = document.uri;

  if (document.isUntitled)
    return vscode.window.showErrorMessage("❌ Please save the file first.");
  if (
    document.isDirty &&
    (await promptSaveChanges(document)) !== "Save and Continue"
  )
    return;

  await document.save();
  const code = document.getText();
  const lines = code.split("\n").length;

  let ast;
  try {
    ast = parseCodeToAST(code);
  } catch (err) {
    return vscode.window.showErrorMessage("❌ Could not parse JS file.");
  }

  const analysisResults = analyseCodeStructure(ast, code, lines);
  const htmlReport = createHtmlContent(fileUri, analysisResults, lines);
  const panel = createWebviewPanel(fileUri, htmlReport);
  handlePanelMessages(panel, fileUri, analysisResults, lines);
}

async function promptSaveChanges(document) {
  return await vscode.window.showInformationMessage(
    "📂 Unsaved changes detected. Save before analysing?",
    "Save and Continue",
    "Cancel"
  );
}

function parseCodeToAST(code) {
  return parser.parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    ranges: true,
    tokens: true,
    errorRecovery: true,
    attachComment: true,
  });
}

async function exportPdf(fileUri, htmlContent) {
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;

  const reportsDir = path.join(workspacePath, "structure-reports");

  // Ensure the directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const pdfPath = path.join(
    reportsDir,
    `${path.basename(fileUri.fsPath, ".js")}_StructureReport.pdf`
  );

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    await browser.close();

    vscode.window.showInformationMessage(`📄 PDF saved to: ${pdfPath}`);
  } catch (err) {
    vscode.window.showErrorMessage("❌ Failed to generate PDF: " + err.message);
  }
}

function extractFunctionMetrics(path) {
  const name = path.node.id?.name || "anonymous";
  const start = path.node.loc.start.line;
  const end = path.node.loc.end.line;
  const length = end - start;
  const params = path.node.params?.length || 0;
  let complexity = 1;
  let nesting = 0;
  let currentNesting = 0;

  path.traverse({
    enter(subPath) {
      if (
        subPath.isIfStatement() ||
        subPath.isForStatement() ||
        subPath.isWhileStatement() ||
        subPath.isBlockStatement() ||
        subPath.isSwitchStatement() ||
        subPath.isTryStatement()
      ) {
        currentNesting++;
        nesting = Math.max(nesting, currentNesting);
      }
      if (
        subPath.isLogicalExpression() ||
        subPath.isConditionalExpression() ||
        subPath.isBinaryExpression()
      ) {
        complexity++;
      }
    },
    exit(subPath) {
      if (
        subPath.isIfStatement() ||
        subPath.isForStatement() ||
        subPath.isWhileStatement() ||
        subPath.isBlockStatement() ||
        subPath.isSwitchStatement() ||
        subPath.isTryStatement()
      ) {
        currentNesting--;
      }
    },
  });

  return { name, start, end, length, params, complexity, nesting };
}

function checkTestability(path) {
  let hasSideEffects = false;
  let hasReturn = false;

  path.traverse({
    enter(subPath) {
      if (
        subPath.isCallExpression() &&
        ["console", "setTimeout", "setInterval", "fetch"].includes(
          subPath.node.callee?.object?.name
        )
      ) {
        hasSideEffects = true;
      }
      if (subPath.isReturnStatement()) hasReturn = true;
    },
  });

  return { hasSideEffects, isPure: hasReturn && !hasSideEffects };
}

function analyseCodeStructure(ast, code, lines) {
  const functions = [];
  const undocumented = [];

  traverse(ast, {
    FunctionDeclaration(path) {
      const metrics = extractFunctionMetrics(path);
      const testability = checkTestability(path);
      const leading = path.node.leadingComments || [];
      const isDocumented = leading.some((c) => c.value.startsWith("*"));

      functions.push({ ...metrics, ...testability, documented: isDocumented });
      if (!isDocumented)
        undocumented.push({ name: metrics.name, line: metrics.start });
    },
  });

  const avgFnLength = functions.length
    ? (
        functions.reduce((sum, fn) => sum + fn.length, 0) / functions.length
      ).toFixed(1)
    : "0.0";
  const commentDensity = lines
    ? (
        (code
          .split("\n")
          .filter((l) => l.trim().startsWith("//") || l.trim().startsWith("/*"))
          .length /
          lines) *
        100
      ).toFixed(1)
    : "0.0";

  const longFunctions = functions.filter((fn) => fn.length > 50);
  const highComplexity = functions.filter((fn) => fn.complexity > 8);
  const untestable = functions.filter((fn, idx, arr) => {
    return !fn.isPure && arr.findIndex((f) => f.name === fn.name) === idx;
  });

  const techDebtScore = Math.min(
    100,
    Math.round(
      ((longFunctions.length * 0.3 +
        highComplexity.length * 0.3 +
        untestable.length * 0.2 +
        undocumented.length * 0.2) *
        100) /
        (functions.length || 1)
    )
  );
  const healthScore = Math.max(0, 100 - techDebtScore);

  const observations = [];

  // 1. Documentation Gaps
  if (undocumented.length > functions.length * 0.5) {
    const percent = ((undocumented.length / functions.length) * 100).toFixed(0);
    observations.push(
      `<strong>Documentation Gaps:</strong> ${undocumented.length} of ${functions.length} functions lack documentation (${percent}%). Add JSDoc comments to clarify purpose, parameters, and return values.`
    );
  }

  // 2. Long Functions
  if (longFunctions.length > 0) {
    const names = longFunctions
      .map((f) => `<code>${f.name}</code> (${f.length} lines)`)
      .join(", ");
    observations.push(
      `<strong>Length Concerns:</strong> ${names} ${
        longFunctions.length > 1 ? "are" : "is"
      } quite long. Consider decomposing into smaller, single-responsibility functions.`
    );
  }

  // 3. High Complexity
  if (highComplexity.length > 0) {
    const names = highComplexity
      .map(
        (f) =>
          `<code>${f.name}</code> (Complexity: <strong>${f.complexity}</strong>)`
      )
      .join(", ");
    observations.push(
      `<strong>Complex Logic:</strong> The following functions have high cyclomatic complexity: ${names}. This may impact readability and maintainability.`
    );
  }

  // 4. Testability
  if (untestable.length > 0) {
    const names = untestable.map((f) => `<code>${f.name}</code>`).join(", ");
    observations.push(
      `<strong>Testability Issues:</strong> ${names} exhibit side effects (e.g., <code>console</code> output, <code>setTimeout</code>). Consider isolating side effects to improve testability.`
    );
  }

  // 5. Redundancy
  const functionNameMap = new Map();
  functions.forEach((f) => {
    const key = f.name.replace(/Again$/, ""); // crude dedup check
    functionNameMap.set(key, (functionNameMap.get(key) || 0) + 1);
  });
  const redundantGroups = Array.from(functionNameMap.entries()).filter(
    ([, count]) => count > 1
  );
  if (
    redundantGroups.length > 0 ||
    code.match(/for\s*\(let\s+[a-z]+\s*=\s*0;/g)?.length > 1
  ) {
    observations.push(
      `<strong>Redundant Logic:</strong> Duplicate functions (e.g., ${redundantGroups
        .map(([name]) => `<code>${name}</code>`)
        .join(
          ", "
        )}) and repeated loop patterns were found. Consider consolidation to reduce code duplication.`
    );
  }

  // 6. Comment Density
  if (parseFloat(commentDensity) < 20) {
    observations.push(
      `<strong>Low Comment Density</strong> (<strong>${commentDensity}%</strong>): Minimal inline comments reduce clarity. Add explanations for non-trivial logic where needed.`
    );
  }

  return {
    totalFunctions: functions.length,
    avgFnLength,
    commentDensity,
    healthScore,
    techDebtScore,
    functions,
    longFunctions,
    highComplexity,
    untestable,
    undocumented,
    observations,
  };
}

function createWebviewPanel(fileUri, htmlContent) {
  const panel = vscode.window.createWebviewPanel(
    "structureReport",
    `Structure Report: ${path.basename(fileUri.fsPath)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  panel.webview.html = htmlContent;
  return panel;
}

function handlePanelMessages(panel, fileUri, results, lines) {
  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "exportPdf") {
        const html = createHtmlContent(fileUri, results, lines);
        await exportPdf(fileUri, html);
      }

      if (message.type === "jumpTo") {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(
          doc,
          vscode.ViewColumn.One
        );
        const pos = new vscode.Position(message.line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
      }
    },
    undefined,
    []
  );
}

function createHtmlContent(fileUri, results, lines) {
  const safeMap = (arr, fn, fallback = "<li>None</li>") =>
    Array.isArray(arr) && arr.length ? arr.map(fn).join("") : fallback;

  const healthColor =
    results.healthScore >= 80
      ? "#4CAF50"
      : results.healthScore >= 50
      ? "#FFC107"
      : "#F44336";
  const healthLabel =
    results.healthScore >= 80
      ? "Healthy"
      : results.healthScore >= 50
      ? "Moderate"
      : "Needs Attention";
  const techDebtLabel =
    results.techDebtScore > 75
      ? "High"
      : results.techDebtScore > 40
      ? "Moderate"
      : "Low";

  return `<!DOCTYPE html><html><head><style>
    body { font-family: sans-serif; padding: 2rem; background: #1e1e1e; color: #d4d4d4; }
    h1, h2, h3 { color: #ffffff; }
    .score { font-size: 2rem; color: ${healthColor}; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    button {
      margin-top: 2rem;
      padding: 0.5rem 1rem;
      font-size: 1rem;
      background-color: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background-color: #005f9e;
    }
    code a {
      color: #4EA1FF;
      text-decoration: none;
    }
    code a:hover {
      text-decoration: underline;
    }
    footer { margin-top: 1rem; font-size: 12px; color: #aaa; border-top: 1px solid #444; padding-top: 1rem; }

    @media print {
      body { background: white !important; color: black !important; }
      h1, h2, h3 { color: black !important; }
      footer { color: #444 !important; border-top: 1px solid #ccc !important; }
      button { display: none !important; } /* Hide button in print */
    }
  </style></head><body>
    <h1>Structure Report: ${path.basename(fileUri.fsPath)}</h1>
    <h2>📂 File Summary</h2>
    <ul>
      <li><strong>Total Lines:</strong> ${lines}</li>
      <li><strong>Functions:</strong> ${results.totalFunctions}</li>
      <li><strong>Average Function Length:</strong> ${
        results.avgFnLength
      } lines</li>
      <li><strong>Comment Density:</strong> ${results.commentDensity}%</li>
    </ul>
    <h2>❤️ Health Score</h2>
    <div class="score">${results.healthScore}% – ${healthLabel}</div>
    <h2>🔧 Technical Debt</h2>
    <ul>
      <li><strong>Score:</strong> ${results.techDebtScore}%</li>
      <li><strong>Level:</strong> ${techDebtLabel}</li>
    </ul>
    <h2>🧠 Refactoring Opportunities</h2>
    <h3>🔁 Long Functions</h3><ul>${safeMap(
      results.longFunctions,
      (fn) => `<li>${fn.name} (${fn.length} lines)</li>`
    )}</ul>
    <h3>⚠️ High Complexity Functions</h3><ul>${safeMap(
      results.highComplexity,
      (fn) => `<li>${fn.name} (Complexity: ${fn.complexity})</li>`
    )}</ul>
    <h3>🧪 Untestable Functions</h3><ul>${safeMap(
      results.untestable,
      (fn) => `<li>${fn.name} – side effects detected</li>`
    )}</ul>
    <h2>📝 Undocumented Functions</h2>
    <ul>${safeMap(
      results.undocumented,
      (fn) =>
        `<li><code><a href="javascript:void(0)" onclick="handleJump(event, ${fn.line})">${fn.name}</a></code> (line ${fn.line})</li>`
    )}</ul>
    <h2>💡 Observations</h2><ul>${safeMap(
      results.observations,
      (o) => `<li>${o}</li>`
    )}</ul>

    <button id="exportPdfBtn">📄 Export as PDF</button>
    <footer>🕒 Report generated on: ${new Date().toLocaleString(
      "en-GB"
    )}</footer>
    <script>
      window.addEventListener("DOMContentLoaded", () => {
        const vscode = acquireVsCodeApi();

        document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "exportPdf" });
        });

        window.handleJump = (event, line) => {
          event.preventDefault();
          vscode.postMessage({ type: "jumpTo", line });
        };
      });
    </script>
  </body></html>`;
}

module.exports = { run: runStructureCheck };