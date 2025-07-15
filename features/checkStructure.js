const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Main function to analyse the structure
async function runStructureCheck() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showWarningMessage("❌ No active file");

  const document = editor.document;
  const fileUri = document.uri;

  if (document.isUntitled)
    return vscode.window.showErrorMessage("❌ Please save the file first.");

  if (document.isDirty) {
    const save = await promptSaveChanges(document);
    if (save !== "Save and Continue") return;
    await document.save();
  }

  const code = document.getText();
  const lines = code.split("\n").length;

  let ast;
  try {
    ast = parseCodeToAST(code);
  } catch (err) {
    return vscode.window.showErrorMessage("❌ Could not parse JS file.");
  }

  const analysisResults = analyseCodeStructure(ast, code, lines);
  const markdownReport = generateMarkdownReport(
    fileUri,
    analysisResults,
    lines
  );

  const panel = createWebviewPanel(
    fileUri,
    markdownReport,
    analysisResults,
    lines
  );
  handlePanelMessages(
    panel,
    document,
    fileUri,
    markdownReport,
    analysisResults
  );
}

// Helper function to prompt user to save changes
async function promptSaveChanges(document) {
  return await vscode.window.showInformationMessage(
    "💾 Unsaved changes detected. Save before analysing?",
    "Save and Continue",
    "Cancel"
  );
}

// Helper function to parse code into AST
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

// Function to generate a hash for a code block
function generateCodeHash(codeBlock) {
  const hash = crypto.createHash("sha256");
  hash.update(codeBlock);
  return hash.digest("hex");
}

// Function to clean a code block by removing excessive whitespace
function cleanCodeBlock(codeBlock) {
  return codeBlock.replace(/\s+/g, " ").trim();
}

// Function to check for code duplication
function checkCodeDuplication(code) {
  // Split the code into lines and filter out unwanted lines (like closing braces and empty lines)
  const codeBlocks = code
    .split("\n")
    .map((line, index) => ({
      lineNumber: index + 1, // 1-based line number
      code: line.trim(),
    }))
    .filter((block) => block.code !== "}" && block.code !== ""); // Filter out closing braces and empty lines

  const hashes = {};
  const duplicates = [];

  codeBlocks.forEach((block, index) => {
    const cleanedBlock = cleanCodeBlock(block.code); // Clean whitespace and make the block uniform
    const blockHash = generateCodeHash(cleanedBlock);

    if (hashes[blockHash]) {
      // Found a duplicate block
      duplicates.push({
        block: cleanedBlock,
        firstOccurrence: hashes[blockHash],
        secondOccurrence: block.lineNumber, // The current line of the duplicate
      });
    } else {
      hashes[blockHash] = block.lineNumber; // Store the index of the first occurrence
    }
  });

  return duplicates;
}

// Detect dead code such as unused variables/functions
function checkDeadCode(ast) {
  let unusedVariables = []; // This will store all variables initially
  let unusedFunctions = [];

  // Sets to track variable accesses and function calls
  const variableDeclarations = new Set();
  const variableAccesses = new Set();
  const functionDeclarations = new Set();
  const functionCalls = new Set();

  // Traverse AST for variable declarations and accesses
  traverse(ast, {
    VariableDeclarator(path) {
      const variableName = path.node.id.name;

      // Add variable to the set of declared variables
      variableDeclarations.add(variableName);
    },
    FunctionDeclaration(path) {
      const functionName = path.node.id.name;

      // Add function to the set of declared functions
      functionDeclarations.add(functionName);

      // Check if the function is called somewhere in the code
      traverse(ast, {
        CallExpression(callPath) {
          if (callPath.node.callee.name === functionName) {
            functionCalls.add(functionName); // Function is called
          }
        },
      });
    },
    // Track variable accesses in identifiers
    Identifier(path) {
      const variableName = path.node.name;

      // Ensure that we are tracking variables only when they are accessed (not during declaration)
      if (
        path.scope.hasBinding(variableName) &&
        !variableDeclarations.has(variableName)
      ) {
        variableAccesses.add(variableName); // Track variable as accessed
      }
    },
    // Track function calls such as `console.log`
    CallExpression(path) {
      // Ensure that we are not just calling the function itself, but also tracking its arguments
      path.node.arguments.forEach((arg) => {
        if (arg.type === "Identifier" && path.scope.hasBinding(arg.name)) {
          variableAccesses.add(arg.name); // Track variable used in function call (like console.log)
        }
      });
    },
  });

  // Now filter out accessed variables from unusedVariables
  unusedVariables = [...variableDeclarations].filter(
    (variable) => !variableAccesses.has(variable)
  );

  // Identify unused functions (functions that were declared but never called)
  unusedFunctions = [...functionDeclarations].filter(
    (func) => !functionCalls.has(func)
  );

  return { unusedVariables, unusedFunctions };
}

// Analysing the code structure
function analyseCodeStructure(ast, code, lines) {
  let topLevelFunctions = 0;
  let allFunctions = [];
  let largeFunctions = [];
  let undocumented = [];
  let duplicateCode = [];
  let deadCode = {
    unusedVariables: [],
    unusedFunctions: [],
  };

  // Detect code duplication
  duplicateCode = checkCodeDuplication(code);

  // Detect dead code
  deadCode = checkDeadCode(ast);

  // Traverse AST to gather function details
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent.type === "Program") {
        topLevelFunctions++;
      }

      const { name, size, start, end } = extractFunctionDetails(path);
      allFunctions.push({ name, lines: size, lineStart: start, lineEnd: end });

      if (size > 50) {
        largeFunctions.push({
          name,
          lines: size,
          lineStart: start,
          lineEnd: end,
        });
      }

      if (!hasJSDoc(path)) {
        undocumented.push({ name, line: start });
      }
    },
  });

  const longestFn = getLongestFunction(allFunctions);
  const avgFnLength = calculateAverageFunctionLength(allFunctions);
  const commentDensity = calculateCommentDensity(code, lines);

  // Return analysis results including code duplication
  return {
    topLevelFunctions,
    longestFn,
    avgFnLength,
    commentDensity,
    penalty: calculateHealthScore(
      topLevelFunctions,
      largeFunctions,
      undocumented,
      duplicateCode,
      deadCode,
      lines
    ),
    duplicateCode,
    deadCode,
    undocumented,
    largeFunctions,
  };
}

// Extract details of each function
function extractFunctionDetails(path) {
  const start = path.node.loc.start.line;
  const end = path.node.loc.end.line;
  const size = end - start;
  const name = path.node.id?.name || "anonymous function";
  return { name, size, start, end };
}

// Check if the function has JSDoc comments
function hasJSDoc(path) {
  const leading = path.node.leadingComments || [];
  return leading.some((c) => c.value.startsWith("*"));
}

// Get the longest function
function getLongestFunction(functions) {
  return functions.reduce(
    (maxFn, fn) => (fn.lines > maxFn.lines ? fn : maxFn),
    functions[0]
  );
}

// Calculate average function length
function calculateAverageFunctionLength(functions) {
  return (
    functions.reduce((sum, fn) => sum + fn.lines, 0) / functions.length
  ).toFixed(1);
}

// Calculate comment density
function calculateCommentDensity(code, lines) {
  const commentLines = code
    .split("\n")
    .filter(
      (l) =>
        l.trim().startsWith("//") ||
        l.trim().startsWith("/*") ||
        l.trim().startsWith("*")
    ).length;
  return ((commentLines / lines) * 100).toFixed(1);
}

// Calculate health score with dynamic thresholds based on codebase size
function calculateHealthScore(
  topLevelFunctions,
  largeFunctions,
  undocumented,
  duplicateCode,
  deadCode,
  lines
) {
  const sizeFactor = Math.floor(lines / 1000);

  const maxTopLevelFunctions = Math.min(30, 10 + sizeFactor);
  const maxLargeFunctions = Math.min(15, 5 + sizeFactor);
  const maxUndocumented = Math.min(15, sizeFactor + 2);
  const deadCodeInstances =
    deadCode.unusedVariables.length + deadCode.unusedFunctions.length;

  const topLevelFunctionIssue =
    topLevelFunctions > maxTopLevelFunctions ? 1 : 0;
  const largeFunctionIssue = largeFunctions.length > maxLargeFunctions ? 1 : 0;
  const undocumentedIssue = undocumented.length > maxUndocumented ? 1 : 0;
  const duplicationPenalty = duplicateCode.length > 0 ? 1 : 0;
  const deadCodePenalty = Math.floor(deadCodeInstances / 2);

  const issueCount =
    topLevelFunctionIssue +
    largeFunctionIssue +
    undocumentedIssue +
    duplicationPenalty +
    deadCodePenalty;

  const penalty = Math.max(0, 100 - issueCount * 15);

  return penalty;
}

// Generate markdown report from analysis results
function generateMarkdownReport(fileUri, analysisResults, lines) {
  const {
    longestFn,
    avgFnLength,
    commentDensity,
    penalty,
    duplicateCode,
    deadCode,
    undocumented,
    largeFunctions,
  } = analysisResults;

  const displayDate = new Date().toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Add code duplication section to the markdown report
  let duplicationText = "No duplicate code found";
  if (duplicateCode && duplicateCode.length > 0) {
    duplicationText = duplicateCode
      .map((dup) => {
        return `Duplicate code found at lines ${dup.firstOccurrence} and ${dup.secondOccurrence}:
        \`\`\`
        ${dup.block}
        \`\`\``;
      })
      .join("\n\n");
  }

  // Add dead code section to the markdown report
  let deadCodeText = "No dead code found";
  if (
    deadCode.unusedVariables.length > 0 ||
    deadCode.unusedFunctions.length > 0
  ) {
    deadCodeText = `
    **Unused Variables:** ${deadCode.unusedVariables.join(", ") || "None"}
    **Unused Functions:** ${deadCode.unusedFunctions.join(", ") || "None"}`;
  }

  return `# Structure Report: ${path.basename(fileUri.fsPath)}

## File Summary
- **Total Lines:** ${lines}
- **Top-Level Functions:** ${analysisResults.topLevelFunctions}
- **Longest Function:** \`${longestFn.name}\` (${longestFn.lines} lines)
- **Average Function Length:** ${avgFnLength}
- **Comment Density:** ${commentDensity}%

## Health Score
**${penalty}%**

## Code Duplication
${duplicationText}

## Dead Code
${deadCodeText}

## Undocumented Functions
${
  undocumented.map((fn) => `- \`${fn.name}\` (line ${fn.line})`).join("\n") ||
  "None"
}

## Large Functions
${
  largeFunctions
    .map(
      (fn) =>
        `- \`${fn.name}\` (${fn.lines} lines, lines ${fn.lineStart}-${fn.lineEnd})`
    )
    .join("\n") || "None"
}

🕒 Report generated on: ${displayDate}`;
}

// Create Webview panel for report display
function createWebviewPanel(fileUri, markdownReport, analysisResults, lines) {
  const panel = vscode.window.createWebviewPanel(
    "structureReport",
    `Structure Report: ${path.basename(fileUri.fsPath)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  const { longestFn, undocumented, largeFunctions, duplicateCode, deadCode } =
    analysisResults;

  panel.webview.html = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body {
        font-family: "Segoe UI", sans-serif;
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 2rem;
        font-size: 15px;
      }
      h1, h2 { color: #eaeaea; }
      ul { padding-left: 2rem; }
      .score { font-size: 2rem; font-weight: bold; color: ${
        analysisResults.penalty >= 80
          ? "#4CAF50"
          : analysisResults.penalty >= 50
          ? "#FFC107"
          : "#F44336"
      }; }
      .tag-btn { background: #2d2d2d; color: #ffd27f; font-family: monospace; padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
      .tag-btn:hover { background: #5e5e5e; }
      .controls { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #444; display: flex; gap: 1rem; flex-wrap: wrap; }
      .export-btn, .copy-btn { font-size: 14px; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; }
      .export-btn { background: #4CAF50; color: white; }
      .export-btn:hover { background: #45a049; }
      .copy-btn { background: #007acc; color: white; }
      .copy-btn:hover { background: #005fa3; }
      footer { margin-top: 2rem; font-size: 13px; color: #888; border-top: 1px solid #444; padding-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>Structure Report: ${path.basename(fileUri.fsPath)}</h1>
    <h2>File Summary</h2>
    <ul>
      <li><strong>Total Lines:</strong> ${lines}</li>
      <li><strong>Top-Level Functions:</strong> ${
        analysisResults.topLevelFunctions
      }</li>
      <li><strong>Longest Function:</strong> <span class="tag">${
        longestFn.name
      }</span> (${longestFn.lines} lines)</li>
      <li><strong>Avg Function Length:</strong> ${
        analysisResults.avgFnLength
      }</li>
      <li><strong>Comment Density:</strong> ${
        analysisResults.commentDensity
      }%</li>
    </ul>

    <h2>Health Score</h2>
    <div class="score">${analysisResults.penalty}%</div>

    <h2>Code Duplication</h2>
    <ul>
      ${
        duplicateCode.length > 0
          ? duplicateCode
              .map(
                (dup) =>
                  `<li>Duplicate code found at lines ${dup.firstOccurrence} and ${dup.secondOccurrence}:
                    <pre><code>${dup.block}</code></pre>
                  </li>`
              )
              .join("")
          : "<li>No duplicate code found</li>"
      }
    </ul>

    <h2>Dead Code</h2>
    <ul>
      ${
        deadCode.unusedVariables.length > 0
          ? `<li><strong>Unused Variables:</strong> ${deadCode.unusedVariables.join(
              ", "
            )}</li>`
          : "<li>No unused variables found</li>"
      }
      ${
        deadCode.unusedFunctions.length > 0
          ? `<li><strong>Unused Functions:</strong> ${deadCode.unusedFunctions.join(
              ", "
            )}</li>`
          : "<li>No unused functions found</li>"
      }
    </ul>

    <h2>Undocumented Functions</h2>
    <ul>${
      undocumented
        .map(
          (fn) =>
            `<li><button class="tag-btn" onclick="jumpTo(${fn.line})">➡️ ${fn.name}</button> <span>(line ${fn.line})</span></li>`
        )
        .join("") || "<li>None</li>"
    }</ul>

    <h2>Large Functions</h2>
    <ul>${
      largeFunctions
        .map((fn) => `<li>${fn.name} (${fn.lines} lines)</li>`)
        .join("") || "<li>None</li>"
    }</ul>

    <div class="controls">
      <button class="export-btn" onclick="exportReport()">💾 Export as Markdown (.md)</button>
      <button class="copy-btn" onclick="copyToClipboard()">📋 Copy to Clipboard</button>
    </div>

    <footer>🕒 Report generated on: ${new Date().toLocaleString(
      "en-GB"
    )}</footer>

    <script>
      const vscode = acquireVsCodeApi();
      function jumpTo(line) { vscode.postMessage({ type: 'jumpToLine', line }); }
      function exportReport() { vscode.postMessage({ type: 'exportMarkdown' }); }
      function copyToClipboard() {
        const text = document.body.innerText;
        navigator.clipboard.writeText(text).then(() => {
          vscode.postMessage({ type: 'copySuccess' });
        });
      }
    </script>
  </body>
  </html>`;

  return panel;
}

// Handle messages from the webview panel
function handlePanelMessages(
  panel,
  document,
  fileUri,
  markdownReport,
  analysisResults
) {
  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "jumpToLine") {
        const pos = new vscode.Position(message.line - 1, 0);
        const sel = new vscode.Selection(pos, pos);
        vscode.window.showTextDocument(document, { selection: sel });
      } else if (message.type === "exportMarkdown") {
        const folder = path.join(
          path.dirname(fileUri.fsPath),
          "structure-reports"
        );
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);

        const filePath = path.join(
          folder,
          `${path.basename(
            fileUri.fsPath,
            path.extname(fileUri.fsPath)
          )}-report-${new Date()
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, "-")}_${new Date()
            .toISOString()
            .slice(11, 16)
            .replace(/:/g, "-")}.md`
        );
        fs.writeFileSync(filePath, markdownReport);

        vscode.window.showInformationMessage(
          `📄 Markdown report saved as ${path.basename(filePath)}`
        );
      } else if (message.type === "copySuccess") {
        vscode.window.showInformationMessage("📋 Markdown copied to clipboard");
      }
    },
    undefined,
    []
  );
}

module.exports = { run: runStructureCheck };