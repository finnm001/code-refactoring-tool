const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const path = require("path");

async function runStructureCheck() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showWarningMessage("\u274c No active file");

  const document = editor.document;
  const fileUri = document.uri;

  if (document.isUntitled)
    return vscode.window.showErrorMessage("\u274c Please save the file first.");
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
    return vscode.window.showErrorMessage("\u274c Could not parse JS file.");
  }

  const analysisResults = analyseCodeStructure(ast, code, lines);
  const markdownReport = generateMarkdownReport(
    fileUri,
    analysisResults,
    lines
  );
  const panel = createWebviewPanel(fileUri, analysisResults, lines);
  handlePanelMessages(
    panel,
    document,
    fileUri,
    markdownReport,
    analysisResults
  );
}

async function promptSaveChanges(document) {
  return await vscode.window.showInformationMessage(
    "\ud83d\udcc2 Unsaved changes detected. Save before analysing?",
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
    observations.push(
      "<strong>Documentation Gaps:</strong> Over half of the functions lack documentation. Consider adding JSDoc comments to clarify purpose, parameters, and return values."
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

function generateMarkdownReport(fileUri, results, lines) {
  const displayDate = new Date().toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const mapList = (arr, fn) =>
    Array.isArray(arr) && arr.length ? arr.map(fn).join("\n") : "None";

  const undocumentedText = mapList(
    results.undocumented,
    (f) => `- \`${f.name}\` (line ${f.line})`
  );
  const longFnsText = mapList(
    results.longFunctions,
    (f) => `- \`${f.name}\` (${f.length} lines)`
  );
  const complexityText = mapList(
    results.highComplexity,
    (f) => `- \`${f.name}\` (complexity: ${f.complexity})`
  );
  const untestableText = mapList(
    results.untestable,
    (f) => `- \`${f.name}\` (side effects detected)`
  );
  const observationsText = mapList(results.observations, (o) => `- ${o}`);

  const techDebtLabel =
    results.techDebtScore > 75
      ? "High"
      : results.techDebtScore > 40
      ? "Moderate"
      : "Low";
  const healthLabel =
    results.healthScore >= 80
      ? "Healthy"
      : results.healthScore >= 50
      ? "Moderate"
      : "Needs Attention";

  return `# Structure Report: ${path.basename(fileUri.fsPath)}

## 📂 File Summary
- **Total Lines:** ${lines}
- **Functions:** ${results.totalFunctions}
- **Average Function Length:** ${results.avgFnLength} lines
- **Comment Density:** ${results.commentDensity}%

## ❤️ Health Score
- **${results.healthScore}%** – ${healthLabel}

## 🔧 Technical Debt
- **${results.techDebtScore}%** – ${techDebtLabel}

## 🧠 Refactoring Opportunities
### 🔁 Long Functions
${longFnsText}

### ⚠️ High Complexity Functions
${complexityText}

### 🧪 Untestable Functions
${untestableText}

## 📝 Undocumented Functions
${undocumentedText}

## 💡 Observations
${observationsText}

🕒 Report generated on: ${displayDate}`;
}

function createWebviewPanel(fileUri, results, lines) {
  const panel = vscode.window.createWebviewPanel(
    "structureReport",
    `Structure Report: ${path.basename(fileUri.fsPath)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  const safeMap = (arr, fn, fallback = "<li>None</li>") =>
    Array.isArray(arr) && arr.length ? arr.map(fn).join("") : fallback;

  const healthColor =
    results.healthScore >= 80
      ? "#4CAF50"
      : results.healthScore >= 50
      ? "#FFC107"
      : "#F44336";
  const techDebtLabel =
    results.techDebtScore > 75
      ? "High"
      : results.techDebtScore > 40
      ? "Moderate"
      : "Low";
  const healthLabel =
    results.healthScore >= 80
      ? "Healthy"
      : results.healthScore >= 50
      ? "Moderate"
      : "Needs Attention";

  panel.webview.html = `<!DOCTYPE html><html><head><style>
    body { font-family: sans-serif; padding: 2rem; background: #1e1e1e; color: #d4d4d4; }
    h1, h2 { color: #ffffff; }
    .score { font-size: 2rem; color: ${healthColor}; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    footer { margin-top: 2rem; font-size: 12px; color: #aaa; border-top: 1px solid #444; padding-top: 1rem; }
  </style></head><body>
    <h1>Structure Report: ${path.basename(fileUri.fsPath)}</h1>
    <h2>📂 File Summary</h2>
    <ul><li><strong>Total Lines:</strong> ${lines}</li><li><strong>Functions:</strong> ${
    results.totalFunctions
  }</li><li><strong>Average Function Length:</strong> ${
    results.avgFnLength
  } lines</li><li><strong>Comment Density:</strong> ${
    results.commentDensity
  }%</li></ul>
    <h2>❤️ Health Score</h2><div class="score">${
      results.healthScore
    }% – ${healthLabel}</div>
    <h2>🔧 Technical Debt</h2><ul><li><strong>Score:</strong> ${
      results.techDebtScore
    }%</li><li><strong>Level:</strong> ${techDebtLabel}</li></ul>
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
    <h2>📝 Undocumented Functions</h2><ul>${safeMap(
      results.undocumented,
      (fn) => `<li>${fn.name} (line ${fn.line})</li>`
    )}</ul>
    <h2>💡 Observations</h2><ul>${safeMap(
      results.observations,
      (o) => `<li>${o}</li>`
    )}</ul>
    <footer>🕒 Report generated on: ${new Date().toLocaleString(
      "en-GB"
    )}</footer>
  </body></html>`;

  return panel;
}

function handlePanelMessages(
  panel,
  document,
  fileUri,
  markdownReport,
  analysisResults
) {
  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "copy") {
        await vscode.env.clipboard.writeText(markdownReport);
        vscode.window.showInformationMessage("📋 Markdown copied to clipboard");
      }
    },
    undefined,
    []
  );
}

module.exports = { run: runStructureCheck };