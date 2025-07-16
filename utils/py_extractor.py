# utils/py_extractor.py
import ast
import sys
import json

def extract_names(code):
    names = set()
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        print(f"SyntaxError: {e}", file=sys.stderr)
        sys.exit(1)

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)

    return list(names)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Missing filename", file=sys.stderr)
        sys.exit(1)

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            code = f.read()
        result = extract_names(code)
        print(json.dumps(result))
    except Exception as e:
        print(f"Failed: {e}", file=sys.stderr)
        sys.exit(1)