# Arithmetic Expression Evaluator — AST + TAC + Stack

An interactive, browser-based arithmetic expression evaluator that shows **how** an expression is processed internally, not just the final answer. It tokenizes the input, builds an **Abstract Syntax Tree (AST)** with a recursive descent parser, evaluates it using **post-order traversal**, generates **Three-Address Code (TAC)**, and animates the **evaluation stack** step by step.

The AST is drawn with [D3.js](https://d3js.org/), and the whole project runs in the browser with no installation or build step.

![Step-by-step evaluation](screenshots/step-evaluation.png)

## Features

- **Expression input** with `+`, `-`, `*`, `/`, parentheses and unary minus (whole numbers)
- **Tokenization** (lexical analysis) of numbers, operators and brackets
- **Recursive descent parsing** that respects operator precedence and left-to-right associativity
- **AST visualization** with D3.js (zoom and pan supported)
- **Hover details**: the type, value/operator and AST id of each node
- **Three-Address Code** generation using temporaries `t1, t2, …`
- **Stack visualization** showing push and pop operations during evaluation
- **Animation controls**: Play, Pause, Step and Reset, with the current node ringed in amber
- **History** of the last 25 expressions (saved in the browser; click one to reload it)
- **Light/dark theme** and **PNG export** of the AST
- **Error messages** for invalid characters, missing brackets, incomplete expressions and division by zero

## How it works

```
Input string → Tokenizer → Parser → AST → Post-order evaluation → Result
                                      │              │
                                  D3.js view    TAC + stack animation
```

1. **Lexical analysis:** `tokenize()` scans the input character by character and produces `NUMBER`, operator and bracket tokens.
2. **Syntax analysis:** `parse()` is a recursive descent parser for this grammar:
   ```
   E → E + T | E - T | T
   T → T * F | T / F | F
   F → -F | ( E ) | num
   ```
   It builds the AST: operators are internal nodes and numbers are leaves.
3. **Post-order ids:** `assignIds()` numbers the nodes in post-order (left → right → operator), which is the order they are evaluated in.
4. **Evaluation and intermediate code:** `evaluateWithStepsAndTAC()` walks the tree in post-order. It computes each node's value, emits a TAC instruction for every operator, and records a snapshot of the stack at each step for the animation.
5. **Visualization:** `renderAST()` draws the tree. `highlightStep()` highlights the active node and updates the TAC and stack panels.

### Example

Input: `(3 + 5) * (2 - 4/2) + 7`

```
t1 = 3 + 5
t2 = 4 / 2
t3 = 2 - t2
t4 = t1 * t3
t5 = t4 + 7
```

Result: **7**

### More examples

| Expression | Result | Three-Address Code |
|---|---|---|
| `2+3*4-5` | 9 | `t1 = 3 * 4`, `t2 = 2 + t1`, `t3 = t2 - 5` |
| `10 - 2 - 3` | 5 | `t1 = 10 - 2`, `t2 = t1 - 3` |
| `(8+2)*(3-1)` | 20 | `t1 = 8 + 2`, `t2 = 3 - 1`, `t3 = t1 * t2` |
| `2*-(3+1)` | -8 | `t1 = 3 + 1`, `t2 = -t1`, `t3 = 2 * t2` |
| `1/0` | — | Error: Division by zero |

## Running the project

You need a modern web browser and an internet connection (D3.js is loaded from a CDN).

**Option 1: VS Code + Live Server (recommended)**
1. Install the **Live Server** extension (by Ritwick Dey).
2. Open this folder in VS Code.
3. Right-click `index.html` and choose **Open with Live Server**.

**Option 2: local server from a terminal**
```bash
python -m http.server 8000      # then open http://localhost:8000
# or
npx serve .
```

**Option 3:** double-click `index.html` to open it directly in a browser.

> If the buttons don't respond, check that `script.js` is in the same folder as `index.html` (lowercase name), then press **F12 → Console** to see the error. The page also shows a red message at the top if `script.js` fails to load.

## Usage

1. Type an expression, for example `(3 + 5) * (2 - 4/2) + 7`.
2. Click **Evaluate & Visualize** or press **Enter**.
3. Use **Step** to go one node at a time, or **Play** / **Pause** to animate the evaluation. **Reset** starts the animation over.
4. Hover over a node to see its details.
5. Use **Theme** to switch light/dark mode, and **Export PNG** to download the tree as an image.

## Project structure

```
ast-expression-evaluator/
├── index.html      # Layout, styles, and the D3.js script tag
├── script.js       # Tokenizer, parser, evaluator, TAC generation, rendering and UI logic
├── screenshots/    # Images used in this README
└── README.md
```

## Technologies

- HTML5, CSS3, JavaScript (no frameworks)
- [D3.js v7](https://d3js.org/) for the tree visualization

## Screenshots

| AST view | Dark theme |
|---|---|
| ![AST view](screenshots/ast-view.png) | ![Dark theme](screenshots/dark-theme.png) |
