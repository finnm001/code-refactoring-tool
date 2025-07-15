const vscode = require("vscode");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const fs = require("fs");
const path = require("path");

async function runStructureCheck() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showWarningMessage("No active file");

  const document = editor.document;
  const fileUri = document.uri;

  if (document.isUntitled) {
    return vscode.window.showErrorMessage("❌ Please save the file first.");
  }

  if (document.isDirty) {
    const save = await vscode.window.showInformationMessage(
      "💾 Unsaved changes detected. Save before analysing?",
      "Save and Continue",
      "Cancel"
    );
    if (save !== "Save and Continue") return;
    await document.save();
  }

  const code = document.getText();
  const lines = code.split("\n").length;
  let ast;

  try {
    ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      ranges: true,
      tokens: true,
      errorRecovery: true,
      attachComment: true,
    });
  } catch (err) {
    return vscode.window.showErrorMessage("❌ Could not parse JS file.");
  }

  let topLevelFunctions = 0;
  let allFunctions = [];
  let largeFunctions = [];
  let undocumented = [];

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent.type === "Program") {
        topLevelFunctions++;
      }

      const start = path.node.loc.start.line;
      const end = path.node.loc.end.line;
      const size = end - start;
      const name = path.node.id?.name || "anonymous function";

      allFunctions.push({ name, lines: size, lineStart: start, lineEnd: end });

      if (size > 50) {
        largeFunctions.push({
          name,
          lines: size,
          lineStart: start,
          lineEnd: end,
        });
      }

      const leading = path.node.leadingComments || [];
      const hasJSDoc = leading.some((c) => c.value.startsWith("*"));
      if (!hasJSDoc) {
        undocumented.push({ name, line: start });
      }
    },
  });

  const longestFn = allFunctions.sort((a, b) => b.lines - a.lines)[0];
  const avgFnLength = (
    allFunctions.reduce((sum, fn) => sum + fn.lines, 0) / allFunctions.length
  ).toFixed(1);

  const commentLines = code
    .split("\n")
    .filter(
      (l) =>
        l.trim().startsWith("//") ||
        l.trim().startsWith("/*") ||
        l.trim().startsWith("*")
    ).length;
  const commentDensity = ((commentLines / lines) * 100).toFixed(1);

  const issueCount =
    (topLevelFunctions > 3 ? 1 : 0) +
    (largeFunctions.length > 0 ? 1 : 0) +
    (undocumented.length > 0 ? 1 : 0);
  const healthScore = Math.max(0, 100 - (issueCount / 5) * 100);

  const fileName = path.basename(fileUri.fsPath);
  const baseName = path.basename(fileUri.fsPath, path.extname(fileUri.fsPath));
  const now = new Date();
  const displayDate = now.toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}_${String(
    now.getHours()
  ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;

  const markdownReport = `# 📁 Structure Report: ${fileName}

## 📊 File Summary
- 📄 Total Lines: **${lines}**
- 🛠️ Top-Level Functions: **${topLevelFunctions}**
- 📏 Longest Function: \`${longestFn.name}\` (${longestFn.lines} lines)
- 📐 Average Function Length: **${avgFnLength}**
- 📝 Comment Density: **${commentDensity}%**

## 🧮 Health Score
✅ **${healthScore}%**

## 📚 Undocumented Functions
${
  undocumented.map((fn) => `- \`${fn.name}\` (line ${fn.line})`).join("\n") ||
  "🎉 None"
}

## 📏 Large Functions
${
  largeFunctions
    .map(
      (fn) =>
        `- \`${fn.name}\` (${fn.lines} lines, lines ${fn.lineStart}-${fn.lineEnd})`
    )
    .join("\n") || "🎉 None"
}

🕒 Report generated on: ${displayDate}
`;

  const undocumentedHtml = undocumented
    .map(
      (fn) =>
        `<li><button class="tag-btn" onclick="jumpTo(${fn.line})">➡️ ${fn.name}</button> <span>(line ${fn.line})</span></li>`
    )
    .join("");

  const largeFnsHtml = largeFunctions
    .map(
      (fn) =>
        `<li><span class="tag">${fn.name}</span> (${fn.lines} lines, lines ${fn.lineStart}-${fn.lineEnd})</li>`
    )
    .join("");

  const panel = vscode.window.createWebviewPanel(
    "structureReport",
    `Structure Report: ${fileName}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

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
      h1, h2 {
        color: #eaeaea;
      }
      ul {
        padding-left: 2rem;
      }
      .score {
        font-size: 2rem;
        font-weight: bold;
        color: ${
          healthScore >= 80
            ? "#4CAF50"
            : healthScore >= 50
            ? "#FFC107"
            : "#F44336"
        };
      }
      .tag {
        background: #3c3c3c;
        color: #ffd27f;
        font-family: monospace;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .tag-btn {
        background: #2d2d2d;
        color: #ffd27f;
        font-family: monospace;
        padding: 4px 8px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 14px;
      }
      .tag-btn:hover {
        background: #5e5e5e;
      }
      details {
        margin-top: 1.5rem;
      }
      .controls {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid #444;
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .export-btn, .copy-btn {
        font-size: 14px;
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
      }
      .export-btn {
        background: #4CAF50;
        color: white;
      }
      .export-btn:hover {
        background: #45a049;
      }
      .copy-btn {
        background: #007acc;
        color: white;
      }
      .copy-btn:hover {
        background: #005fa3;
      }
      footer {
        margin-top: 2rem;
        font-size: 13px;
        color: #888;
        border-top: 1px solid #444;
        padding-top: 1rem;
      }
    </style>
  </head>
  <body>
    <h1>📁 Structure Report: ${fileName}</h1>

    <h2>📊 File Summary</h2>
    <ul>
      <li>📄 Total Lines: ${lines}</li>
      <li>🛠️ Top-Level Functions: ${topLevelFunctions}</li>
      <li>📏 Longest Function: <span class="tag">${longestFn.name}</span> (${
    longestFn.lines
  } lines)</li>
      <li>📐 Avg Function Length: ${avgFnLength}</li>
      <li>📝 Comment Density: ${commentDensity}%</li>
    </ul>

    <h2>🧮 Health Score</h2>
    <div class="score">${healthScore}%</div>

    <details open>
      <summary>📚 Undocumented Functions (${undocumented.length})</summary>
      <ul>${undocumentedHtml || "<li>🎉 None</li>"}</ul>
    </details>

    <details open>
      <summary>📏 Large Functions (${largeFunctions.length})</summary>
      <ul>${largeFnsHtml || "<li>🎉 None</li>"}</ul>
    </details>

    <div class="controls">
      <button class="export-btn" onclick="exportReport()">💾 Export as Markdown (.md)</button>
      <button class="copy-btn" onclick="copyToClipboard()">📋 Copy to Clipboard</button>
    </div>

    <footer>
      🕒 Report generated on: ${displayDate}
    </footer>

    <script>
      const vscode = acquireVsCodeApi();
      function jumpTo(line) {
        vscode.postMessage({ type: 'jumpToLine', line });
      }
      function exportReport() {
        vscode.postMessage({ type: 'exportMarkdown' });
      }
      function copyToClipboard() {
        const text = document.body.innerText;
        navigator.clipboard.writeText(text).then(() => {
          vscode.postMessage({ type: 'copySuccess' });
        });
      }
    </script>
  </body>
  </html>`;

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
          `${baseName}-report-${timestamp}.md`
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

module.exports = {
  run: runStructureCheck,
};