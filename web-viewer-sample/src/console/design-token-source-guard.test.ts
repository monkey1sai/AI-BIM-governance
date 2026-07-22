import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type GuardCategory =
  | "color"
  | "gradient"
  | "shadow"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "line-height"
  | "letter-spacing"
  | "radius"
  | "spacing"
  | "other";

type ViolationCode =
  | "LOCAL_AB_TOKEN_DEFINITION"
  | "INVALID_AUTHORITY_TOKEN_SCOPE"
  | "DUPLICATE_AUTHORITY_TOKEN"
  | "NON_AB_TOKEN"
  | "RAW_COLOR"
  | "RAW_RADIUS"
  | "RAW_SPACING"
  | "RAW_TYPOGRAPHY"
  | "TOKEN_FALLBACK_NOT_ALLOWED"
  | "UNKNOWN_AB_TOKEN"
  | "UNPROVABLE_STYLE_SOURCE"
  | "UNPROVABLE_TOKEN_VALUE"
  | "WRONG_TOKEN_CATEGORY";

type Violation = {
  code: ViolationCode;
  file: string;
  line: number;
  property: string;
  value: string;
};

type Primitive = string | number | null;
type ValueNode = ReturnType<typeof valueParser>["nodes"][number];
type PrimitiveResult = { values: Primitive[]; unresolved: boolean };
type ExpressionResult = { expressions: ts.Expression[]; unresolved: boolean };
type ResolveEnv = Map<ts.Node, ts.Expression>;
type AuditContext = {
  checker?: ts.TypeChecker;
  locals: Map<string, ts.Declaration[]>;
  tokens: Map<string, GuardCategory>;
};

const packageRoot = process.cwd();
const consoleDir = resolve(packageRoot, "src", "console");
const authorityPath = resolve(packageRoot, "..", "docs", "plans", "ai-bim-governance.css");

const colorFunctions = new Set([
  "color",
  "color-mix",
  "device-cmyk",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "light-dark",
  "oklab",
  "oklch",
  "rgb",
  "rgba",
]);

const namedColors = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid " +
    "mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown " +
    "salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(/\s+/),
);

const systemColors = new Set(
  (
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext currentcolor field " +
    "fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext"
  ).split(/\s+/),
);

function collectFiles(dir: string, extensions: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full, extensions));
    else if (entry.isFile() && extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) files.push(full);
  }
  return files.sort();
}

function inferTokenCategory(token: string): GuardCategory {
  if (/^--ab-r-/.test(token)) return "radius";
  if (/^--ab-space-/.test(token)) return "spacing";
  if (/^--ab-(font|mono)$/.test(token)) return "font-family";
  if (/^--ab-fs-/.test(token)) return "font-size";
  if (/^--ab-fw-/.test(token)) return "font-weight";
  if (/^--ab-lh-/.test(token)) return "line-height";
  if (/^--ab-track-/.test(token)) return "letter-spacing";
  if (/^--ab-(dur|ease)/.test(token)) return "other";
  if (/^--ab-gradient(?:-|$)/.test(token)) return "gradient";
  if (/^--ab-(?:shadow|glow)(?:-|$)/.test(token)) return "shadow";
  return "color";
}

function parseAuthorityTokens(source: string, file: string): { tokens: Map<string, GuardCategory>; violations: Violation[] } {
  const tokens = new Map<string, GuardCategory>();
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const root = postcss.parse(source, { from: file });
  root.walkDecls(/^--ab-/, (decl) => {
    const line = decl.source?.start?.line ?? 1;
    if (seen.has(decl.prop)) {
      violations.push(makeViolation("DUPLICATE_AUTHORITY_TOKEN", file, line, decl.prop, decl.value));
    }
    seen.add(decl.prop);

    const rule = decl.parent;
    const selectors = rule?.type === "rule" ? postcss.list.comma(rule.selector).map((selector) => selector.trim()) : [];
    const validScope =
      rule?.type === "rule" &&
      rule.parent?.type === "root" &&
      selectors.includes(":root") &&
      selectors.every((selector) => selector === ":root" || selector === "[data-ab-theme]");
    if (!validScope) {
      violations.push(makeViolation("INVALID_AUTHORITY_TOKEN_SCOPE", file, line, decl.prop, decl.value));
      return;
    }
    if (!tokens.has(decl.prop)) tokens.set(decl.prop, inferTokenCategory(decl.prop));
  });
  return { tokens, violations: normalizeViolations(violations) };
}

function readAuthorityTokens(): { tokens: Map<string, GuardCategory>; violations: Violation[] } {
  return parseAuthorityTokens(readFileSync(authorityPath, "utf8"), authorityPath);
}

function normalizeProperty(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
}

function propertyCategory(property: string): GuardCategory | null {
  const prop = normalizeProperty(property);
  if (/^border-(?:top-|right-|bottom-|left-|start-|end-)?(?:start-|end-)?radius$/.test(prop) || prop === "border-radius") {
    return "radius";
  }
  if (/^(?:margin|padding)(?:-|$)/.test(prop) || /^(?:row-|column-)?gap$/.test(prop) || /^scroll-(?:margin|padding)(?:-|$)/.test(prop)) {
    return "spacing";
  }
  if (/^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule)-width$/.test(prop)) {
    return "spacing";
  }
  if (prop === "font-family") return "font-family";
  if (prop === "font-size") return "font-size";
  if (prop === "font-weight") return "font-weight";
  if (prop === "line-height") return "line-height";
  if (prop === "letter-spacing") return "letter-spacing";
  if (prop === "font") return "font-family";
  if (
    prop === "color" ||
    prop === "background" ||
    prop === "background-color" ||
    prop === "background-image" ||
    prop === "fill" ||
    prop === "stroke" ||
    prop === "stop-color" ||
    prop === "flood-color" ||
    prop === "lighting-color" ||
    prop === "caret-color" ||
    prop === "accent-color" ||
    prop === "box-shadow" ||
    prop === "text-shadow" ||
    /^(?:border|outline|column-rule)(?:-|$)/.test(prop)
  ) {
    return "color";
  }
  return null;
}

function makeViolation(
  code: ViolationCode,
  file: string,
  line: number,
  property: string,
  value: string,
): Violation {
  return { code, file: file.replace(/\\/g, "/"), line, property: normalizeProperty(property), value };
}

function allowedTokenCategories(property: string, category: GuardCategory): Set<GuardCategory> {
  const prop = normalizeProperty(property);
  if (prop === "font") {
    return new Set(["font-family", "font-size", "font-weight", "line-height", "letter-spacing"]);
  }
  if (category !== "color") return new Set([category]);
  if (prop === "box-shadow" || prop === "text-shadow") return new Set(["color", "shadow"]);
  if (prop === "background" || prop === "background-image") return new Set(["color", "gradient"]);
  if (/^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule)$/.test(prop)) {
    return new Set(["color", "spacing"]);
  }
  return new Set(["color"]);
}

function validateTokenFunctions(
  property: string,
  category: GuardCategory,
  value: string,
  tokens: Map<string, GuardCategory>,
): ViolationCode[] {
  const codes = new Set<ViolationCode>();
  const allowed = allowedTokenCategories(property, category);
  const visit = (nodes: ValueNode[], insideUrl = false): void => {
    for (const node of nodes) {
      if (node.type !== "function") continue;
      const fn = node.value.toLowerCase();
      if (fn === "url" || insideUrl) continue;
      if (fn === "var") {
        const tokenNode = node.nodes.find((part) => part.type === "word");
        const token = tokenNode?.value ?? "";
        if (node.nodes.some((part) => part.type === "div" && part.value === ",")) {
          codes.add("TOKEN_FALLBACK_NOT_ALLOWED");
        }
        if (!token.startsWith("--ab-")) codes.add("NON_AB_TOKEN");
        else if (!tokens.has(token)) codes.add("UNKNOWN_AB_TOKEN");
        else if (!allowed.has(tokens.get(token)!)) codes.add("WRONG_TOKEN_CATEGORY");
        continue;
      }
      visit(node.nodes, fn === "url");
    }
  };
  visit(valueParser(value).nodes);
  return [...codes];
}

function containsRawColor(value: string): boolean {
  let raw = false;
  const visit = (nodes: ValueNode[], insideUrl = false): void => {
    for (const node of nodes) {
      if (raw || insideUrl) continue;
      if (node.type === "word") {
        const word = node.value.toLowerCase();
        if (/^#[0-9a-f]{3,8}$/i.test(word) || namedColors.has(word) || systemColors.has(word)) raw = true;
      } else if (node.type === "function") {
        const fn = node.value.toLowerCase();
        if (fn === "url" || fn === "var") continue;
        if (colorFunctions.has(fn)) raw = true;
        else visit(node.nodes, fn === "url");
      }
    }
  };
  visit(valueParser(value).nodes);
  return raw;
}

function containsRawTypography(value: string): boolean {
  let raw = false;
  const visit = (nodes: ValueNode[]): void => {
    for (const node of nodes) {
      if (node.type === "space" || node.type === "comment" || node.type === "div") continue;
      if (node.type === "function" && node.value.toLowerCase() === "var") continue;
      if (node.type === "word" && node.value.toLowerCase() === "inherit") continue;
      raw = true;
    }
  };
  visit(valueParser(value).nodes);
  return raw;
}

function containsRawRadius(value: string): boolean {
  let raw = false;
  for (const node of valueParser(value).nodes) {
    if (node.type === "space" || node.type === "comment" || node.type === "div") continue;
    if (node.type === "function" && node.value.toLowerCase() === "var") continue;
    if (node.type === "word" && (Number(node.value) === 0 || node.value.toLowerCase() === "inherit")) continue;
    raw = true;
  }
  return raw;
}

function containsRawSpacing(property: string, value: string): boolean {
  let raw = false;
  const visit = (nodes: ValueNode[], inCalc = false): void => {
    for (const node of nodes) {
      if (node.type === "space" || node.type === "comment" || node.type === "div") continue;
      if (node.type === "function") {
        const fn = node.value.toLowerCase();
        if (fn === "var") continue;
        if (fn === "calc") visit(node.nodes, true);
        else raw = true;
        continue;
      }
      if (node.type !== "word") {
        raw = true;
        continue;
      }
      const word = node.value.toLowerCase();
      const unit = valueParser.unit(word);
      if (word === "inherit" || (normalizeProperty(property).startsWith("margin") && word === "auto")) continue;
      if (unit && unit.unit === "" && (Number(unit.number) === 0 || inCalc)) continue;
      if (inCalc && /^[+\-*/]$/.test(word)) continue;
      raw = true;
    }
  };
  visit(valueParser(value).nodes);
  return raw;
}

function isBorderShorthand(property: string): boolean {
  const prop = normalizeProperty(property);
  return /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule)$/.test(prop);
}

function containsRawBorderWidth(value: string): boolean {
  const visit = (nodes: ValueNode[]): boolean => {
    for (const node of nodes) {
      if (node.type === "space" || node.type === "comment" || node.type === "div") continue;
      if (node.type === "function") {
        const fn = node.value.toLowerCase();
        if (fn === "var") continue;
        if ((fn === "calc" || fn === "min" || fn === "max" || fn === "clamp") && visit(node.nodes)) return true;
        continue;
      }
      if (node.type !== "word") continue;
      const word = node.value.toLowerCase();
      if (word === "thin" || word === "medium" || word === "thick") return true;
      const unit = valueParser.unit(word);
      if (unit && unit.unit !== "" && Number(unit.number) !== 0) return true;
    }
    return false;
  };
  return visit(valueParser(value).nodes);
}

function validateValue(
  property: string,
  value: string | number,
  tokens: Map<string, GuardCategory>,
): ViolationCode[] {
  const category = propertyCategory(property);
  if (!category) return [];
  const cssValue = String(value).trim();
  const codes = new Set(validateTokenFunctions(property, category, cssValue, tokens));
  if (isBorderShorthand(property) && containsRawBorderWidth(cssValue)) codes.add("RAW_SPACING");
  if (category === "color" && (typeof value === "number" || containsRawColor(cssValue))) codes.add("RAW_COLOR");
  else if (category === "radius" && containsRawRadius(cssValue)) codes.add("RAW_RADIUS");
  else if (category === "spacing" && containsRawSpacing(property, cssValue)) codes.add("RAW_SPACING");
  else if (category.startsWith("font") || category === "line-height" || category === "letter-spacing") {
    if (containsRawTypography(cssValue)) codes.add("RAW_TYPOGRAPHY");
  }
  return [...codes];
}

function buildLocalIndex(sourceFile: ts.SourceFile): Map<string, ts.Declaration[]> {
  const locals = new Map<string, ts.Declaration[]>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isPropertyAssignment(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const bucket = locals.get(node.name.text) ?? [];
      bucket.push(node);
      locals.set(node.name.text, bucket);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return locals;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function declarationsFor(expression: ts.Expression, context: AuditContext): ts.Declaration[] {
  const target = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  if (context.checker) {
    if (
      ts.isIdentifier(target) &&
      ts.isShorthandPropertyAssignment(target.parent) &&
      target.parent.name === target
    ) {
      const valueSymbol = context.checker.getShorthandAssignmentValueSymbol(target.parent);
      if (valueSymbol?.declarations?.length) return [...valueSymbol.declarations];
    }
    let symbol = context.checker.getSymbolAtLocation(target);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
    if (symbol?.declarations?.length) return [...symbol.declarations];
  }
  if (ts.isIdentifier(target)) return context.locals.get(target.text) ?? [];
  return [];
}

function initializerFor(declaration: ts.Declaration): ts.Expression | undefined {
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isParameter(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertyAssignment(declaration) ||
    ts.isBindingElement(declaration) ||
    ts.isEnumMember(declaration)
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function functionLikeFor(declaration: ts.Declaration): ts.FunctionLikeDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isArrowFunction(declaration)
  ) {
    return declaration;
  }
  const initializer = initializerFor(declaration);
  if (initializer && (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer))) return initializer;
  return undefined;
}

function returnExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== fn.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression);
    else ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return expressions;
}

type UndefinedState = "always" | "never" | "maybe";

function mergeUndefinedStates(states: UndefinedState[]): UndefinedState {
  if (states.length === 0) return "maybe";
  return states.every((state) => state === states[0]) ? states[0] : "maybe";
}

function isMutableVariableDeclaration(declaration: ts.Declaration): boolean {
  return (
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) === 0
  );
}

function undefinedState(
  rawExpression: ts.Expression,
  context: AuditContext,
  env: ResolveEnv,
  seen: Set<ts.Node> = new Set(),
): UndefinedState {
  const expression = unwrapExpression(rawExpression);
  if (seen.has(expression)) return "maybe";
  if (ts.isVoidExpression(expression)) return "always";
  if (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isArrowFunction(expression) ||
    ts.isClassExpression(expression) ||
    ts.isTemplateExpression(expression)
  ) {
    return "never";
  }
  const nextSeen = new Set(seen).add(expression);
  if (ts.isConditionalExpression(expression)) {
    return mergeUndefinedStates([
      undefinedState(expression.whenTrue, context, env, nextSeen),
      undefinedState(expression.whenFalse, context, env, nextSeen),
    ]);
  }
  if (!ts.isIdentifier(expression)) return "maybe";
  const declarations = declarationsFor(expression, context);
  if (expression.text === "undefined" && declarations.length === 0) return "always";
  if (declarations.length === 0) return "maybe";
  return mergeUndefinedStates(declarations.map((declaration) => {
    const value = environmentBinding(declaration, env) ?? initializerFor(declaration);
    if (isMutableVariableDeclaration(declaration) || !value) return "maybe";
    return undefinedState(value, context, env, nextSeen);
  }));
}

function unionExpression(left: ts.Expression, right: ts.Expression): ts.Expression {
  return ts.factory.createConditionalExpression(
    ts.factory.createTrue(),
    ts.factory.createToken(ts.SyntaxKind.QuestionToken),
    left,
    ts.factory.createToken(ts.SyntaxKind.ColonToken),
    right,
  );
}

function childEnvForCall(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  parent: ResolveEnv,
  context: AuditContext,
): ResolveEnv {
  const child = new Map(parent);
  fn.parameters.forEach((parameter, index) => {
    const supplied = call.arguments[index];
    let argument = supplied ?? parameter.initializer ?? ts.factory.createIdentifier("undefined");
    if (parameter.initializer && supplied) {
      const state = undefinedState(supplied, context, parent);
      if (state === "always") argument = parameter.initializer;
      else if (state === "maybe") argument = unionExpression(supplied, parameter.initializer);
    }
    child.set(parameter, argument);
  });
  return child;
}

function environmentBinding(declaration: ts.Declaration, env: ResolveEnv): ts.Expression | undefined {
  const direct = env.get(declaration);
  if (direct) return direct;
  const source = declaration.getSourceFile().fileName;
  for (const [candidate, expression] of env) {
    if (
      candidate.kind === declaration.kind &&
      candidate.pos === declaration.pos &&
      candidate.end === declaration.end &&
      candidate.getSourceFile().fileName === source
    ) {
      return expression;
    }
  }
  return undefined;
}

function enclosingFunctionLike(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function functionBindingIdentifier(fn: ts.FunctionLikeDeclaration): ts.Identifier | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name && ts.isIdentifier(fn.name)) {
    return fn.name;
  }
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return fn.parent.name;
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function isExportedFunctionBinding(fn: ts.FunctionLikeDeclaration): boolean {
  if (ts.isFunctionDeclaration(fn)) return hasExportModifier(fn);
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isVariableDeclarationList(fn.parent.parent) &&
    ts.isVariableStatement(fn.parent.parent.parent)
  ) {
    return hasExportModifier(fn.parent.parent.parent);
  }
  return false;
}

function directCallEnvironments(node: ts.Node, context: AuditContext): ResolveEnv[] {
  const fn = enclosingFunctionLike(node);
  const binding = fn ? functionBindingIdentifier(fn) : undefined;
  if (!fn || !binding || !context.checker || isExportedFunctionBinding(fn)) return [];

  const calls = new Set<ts.CallExpression>();
  let hasIndirectReference = false;
  const visit = (candidate: ts.Node): void => {
    const refersToBinding =
      ts.isIdentifier(candidate) &&
      candidate !== binding &&
      declarationsFor(candidate, context).some((declaration) => functionLikeFor(declaration) === fn);
    if (refersToBinding) {
      if (ts.isCallExpression(candidate.parent) && candidate.parent.expression === candidate) calls.add(candidate.parent);
      else hasIndirectReference = true;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node.getSourceFile());
  if (hasIndirectReference || calls.size === 0) return [];
  return [...calls].map((call) => childEnvForCall(fn, call, new Map(), context));
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) {
    return name.expression.text;
  }
  return null;
}

function resolveArrayElements(
  rawExpression: ts.Expression,
  context: AuditContext,
  seen: Set<ts.Node>,
  depth: number,
): ExpressionResult {
  const expression = unwrapExpression(rawExpression);
  if (depth > 24 || seen.has(expression)) return { expressions: [], unresolved: true };
  const nextSeen = new Set(seen).add(expression);
  if (ts.isArrayLiteralExpression(expression)) {
    const expressions: ts.Expression[] = [];
    let unresolved = false;
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = resolveArrayElements(element.expression, context, nextSeen, depth + 1);
        expressions.push(...spread.expressions);
        unresolved ||= spread.unresolved;
      } else {
        expressions.push(element);
      }
    }
    return { expressions, unresolved };
  }
  if (ts.isIdentifier(expression)) {
    const initializers = declarationsFor(expression, context)
      .map(initializerFor)
      .filter((value): value is ts.Expression => Boolean(value));
    if (!initializers.length) return { expressions: [], unresolved: true };
    const results = initializers.map((value) => resolveArrayElements(value, context, nextSeen, depth + 1));
    return {
      expressions: results.flatMap((result) => result.expressions),
      unresolved: results.some((result) => result.unresolved),
    };
  }
  if (ts.isConditionalExpression(expression)) {
    const yes = resolveArrayElements(expression.whenTrue, context, nextSeen, depth + 1);
    const no = resolveArrayElements(expression.whenFalse, context, nextSeen, depth + 1);
    return { expressions: [...yes.expressions, ...no.expressions], unresolved: yes.unresolved || no.unresolved };
  }
  return { expressions: [], unresolved: true };
}

function mapCallbackPropertyInitializers(
  expression: ts.Expression,
  keys: string[] | null,
  context: AuditContext,
  seen: Set<ts.Node>,
  depth: number,
): ExpressionResult {
  if (!keys?.length || !ts.isIdentifier(unwrapExpression(expression))) {
    return { expressions: [], unresolved: false };
  }
  const initializers: ts.Expression[] = [];
  let matchedCallback = false;
  let unresolved = false;
  for (const declaration of declarationsFor(unwrapExpression(expression), context)) {
    if (!ts.isParameter(declaration)) continue;
    const fn = declaration.parent;
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue;
    const call = fn.parent;
    if (
      !ts.isCallExpression(call) ||
      !call.arguments.some((argument) => argument === fn) ||
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== "map" ||
      fn.parameters[0] !== declaration
    ) {
      continue;
    }
    matchedCallback = true;
    const elements = resolveArrayElements(call.expression.expression, context, seen, depth + 1);
    unresolved ||= elements.unresolved;
    for (const element of elements.expressions) {
      const object = unwrapExpression(element);
      if (!ts.isObjectLiteralExpression(object)) {
        unresolved = true;
        continue;
      }
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = staticPropertyName(property.name);
        if (name !== null && keys.includes(name)) initializers.push(property.initializer);
      }
    }
  }
  return {
    expressions: initializers,
    unresolved: matchedCallback && (unresolved || initializers.length === 0),
  };
}

function accessPropertyInitializers(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  context: AuditContext,
  env: ResolveEnv,
  seen: Set<ts.Node>,
  depth: number,
): ExpressionResult {
  const direct = declarationsFor(expression, context)
    .map(initializerFor)
    .filter((value): value is ts.Expression => Boolean(value));
  if (direct.length) return { expressions: direct, unresolved: false };

  let keys: string[] | null = null;
  if (ts.isPropertyAccessExpression(expression)) keys = [expression.name.text];
  else if (expression.argumentExpression) {
    const resolvedKeys = resolvePrimitiveValues(expression.argumentExpression, context, env, seen, depth + 1);
    if (!resolvedKeys.unresolved) keys = resolvedKeys.values.filter((value): value is string => typeof value === "string");
  }
  const callback = mapCallbackPropertyInitializers(expression.expression, keys, context, seen, depth + 1);
  if (callback.expressions.length || callback.unresolved) return callback;

  const base = resolveObjectExpressions(expression.expression, context, env, seen, depth + 1);
  const initializers: ts.Expression[] = [];
  for (const object of base.expressions) {
    if (!ts.isObjectLiteralExpression(object)) continue;
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      if (name !== null && (keys === null || keys.includes(name))) initializers.push(property.initializer);
    }
  }
  return { expressions: initializers, unresolved: base.unresolved || initializers.length === 0 };
}

function resolveObjectExpressions(
  rawExpression: ts.Expression,
  context: AuditContext,
  env: ResolveEnv = new Map(),
  seen: Set<ts.Node> = new Set(),
  depth = 0,
): ExpressionResult {
  const expression = unwrapExpression(rawExpression);
  if (depth > 24 || seen.has(expression)) return { expressions: [], unresolved: true };
  if (ts.isObjectLiteralExpression(expression)) return { expressions: [expression], unresolved: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(expression) && expression.text === "undefined")) {
    return { expressions: [], unresolved: false };
  }
  const nextSeen = new Set(seen).add(expression);
  if (ts.isConditionalExpression(expression)) {
    const yes = resolveObjectExpressions(expression.whenTrue, context, env, nextSeen, depth + 1);
    const no = resolveObjectExpressions(expression.whenFalse, context, env, nextSeen, depth + 1);
    return { expressions: [...yes.expressions, ...no.expressions], unresolved: yes.unresolved || no.unresolved };
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return resolveObjectExpressions(expression.right, context, env, nextSeen, depth + 1);
    }
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      const left = resolveObjectExpressions(expression.left, context, env, nextSeen, depth + 1);
      const right = resolveObjectExpressions(expression.right, context, env, nextSeen, depth + 1);
      return { expressions: [...left.expressions, ...right.expressions], unresolved: left.unresolved || right.unresolved };
    }
  }
  if (ts.isIdentifier(expression)) {
    for (const declaration of declarationsFor(expression, context)) {
      const bound = environmentBinding(declaration, env);
      if (bound) return resolveObjectExpressions(bound, context, env, nextSeen, depth + 1);
    }
    const initializers = declarationsFor(expression, context)
      .map(initializerFor)
      .filter((value): value is ts.Expression => Boolean(value));
    if (!initializers.length) return { expressions: [], unresolved: true };
    const results = initializers.map((value) => resolveObjectExpressions(value, context, env, nextSeen, depth + 1));
    return {
      expressions: results.flatMap((result) => result.expressions),
      unresolved: results.some((result) => result.unresolved),
    };
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const access = accessPropertyInitializers(expression, context, env, nextSeen, depth + 1);
    const results = access.expressions.map((value) => resolveObjectExpressions(value, context, env, nextSeen, depth + 1));
    return {
      expressions: results.flatMap((result) => result.expressions),
      unresolved: access.unresolved || results.some((result) => result.unresolved),
    };
  }
  if (ts.isCallExpression(expression)) {
    const calleeText = expression.expression.getText();
    if (calleeText === "Object.assign") {
      const results = expression.arguments.map((value) =>
        resolveObjectExpressions(value, context, env, nextSeen, depth + 1),
      );
      return {
        expressions: results.flatMap((result) => result.expressions),
        unresolved: results.length === 0 || results.some((result) => result.unresolved),
      };
    }
    if (calleeText === "Object.freeze" && expression.arguments[0]) {
      return resolveObjectExpressions(expression.arguments[0], context, env, nextSeen, depth + 1);
    }
    const declarations = declarationsFor(expression.expression, context);
    const functions = declarations.map(functionLikeFor).filter((fn): fn is ts.FunctionLikeDeclaration => Boolean(fn));
    if (!functions.length && /(?:^|\.)useMemo$/.test(calleeText) && expression.arguments[0]) {
      const synthetic = ts.isArrowFunction(expression.arguments[0]) || ts.isFunctionExpression(expression.arguments[0])
        ? expression.arguments[0]
        : undefined;
      if (synthetic) functions.push(synthetic);
    }
    if (!functions.length) return { expressions: [], unresolved: true };
    const results = functions.flatMap((fn) => {
      const child = childEnvForCall(fn, expression, env, context);
      return returnExpressions(fn).map((value) => resolveObjectExpressions(value, context, child, nextSeen, depth + 1));
    });
    return {
      expressions: results.flatMap((result) => result.expressions),
      unresolved: results.length === 0 || results.some((result) => result.unresolved),
    };
  }
  return { expressions: [], unresolved: true };
}

function mergePrimitiveResults(results: PrimitiveResult[]): PrimitiveResult {
  return {
    values: [...new Set(results.flatMap((result) => result.values))],
    unresolved: results.some((result) => result.unresolved),
  };
}

function resolvePrimitiveValues(
  rawExpression: ts.Expression,
  context: AuditContext,
  env: ResolveEnv = new Map(),
  seen: Set<ts.Node> = new Set(),
  depth = 0,
): PrimitiveResult {
  const expression = unwrapExpression(rawExpression);
  if (depth > 24 || seen.has(expression)) return { values: [], unresolved: true };
  if (ts.isStringLiteralLike(expression)) return { values: [expression.text], unresolved: false };
  if (ts.isNumericLiteral(expression)) return { values: [Number(expression.text)], unresolved: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(expression) && expression.text === "undefined")) {
    return { values: [null], unresolved: false };
  }
  const nextSeen = new Set(seen).add(expression);
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    const number = Number(expression.operand.text);
    return { values: [expression.operator === ts.SyntaxKind.MinusToken ? -number : number], unresolved: false };
  }
  if (ts.isTemplateExpression(expression)) {
    let values = [expression.head.text];
    let unresolved = false;
    for (const span of expression.templateSpans) {
      const resolved = resolvePrimitiveValues(span.expression, context, env, nextSeen, depth + 1);
      unresolved ||= resolved.unresolved || resolved.values.length === 0;
      const parts = resolved.values.filter((value): value is string | number => value !== null);
      values = values.flatMap((prefix) => parts.map((part) => `${prefix}${part}${span.literal.text}`)).slice(0, 128);
    }
    return { values, unresolved };
  }
  if (ts.isConditionalExpression(expression)) {
    return mergePrimitiveResults([
      resolvePrimitiveValues(expression.whenTrue, context, env, nextSeen, depth + 1),
      resolvePrimitiveValues(expression.whenFalse, context, env, nextSeen, depth + 1),
    ]);
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      const right = resolvePrimitiveValues(expression.right, context, env, nextSeen, depth + 1);
      return { values: [...right.values, null], unresolved: right.unresolved };
    }
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      return mergePrimitiveResults([
        resolvePrimitiveValues(expression.left, context, env, nextSeen, depth + 1),
        resolvePrimitiveValues(expression.right, context, env, nextSeen, depth + 1),
      ]);
    }
    if (operator === ts.SyntaxKind.PlusToken) {
      const left = resolvePrimitiveValues(expression.left, context, env, nextSeen, depth + 1);
      const right = resolvePrimitiveValues(expression.right, context, env, nextSeen, depth + 1);
      const values = left.values.flatMap((a) =>
        right.values
          .filter((b): b is string | number => b !== null && a !== null)
          .map((b) => `${String(a)}${String(b)}`),
      );
      return { values: values.slice(0, 128), unresolved: left.unresolved || right.unresolved };
    }
  }
  if (ts.isIdentifier(expression)) {
    const declarations = declarationsFor(expression, context);
    for (const declaration of declarations) {
      const bound = environmentBinding(declaration, env);
      if (bound) return resolvePrimitiveValues(bound, context, env, nextSeen, depth + 1);
    }
    if (declarations.some(isMutableVariableDeclaration)) return { values: [], unresolved: true };
    const initializers = declarations.map(initializerFor).filter((value): value is ts.Expression => Boolean(value));
    if (!initializers.length) return { values: [], unresolved: true };
    return mergePrimitiveResults(
      initializers.map((value) => resolvePrimitiveValues(value, context, env, nextSeen, depth + 1)),
    );
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const access = accessPropertyInitializers(expression, context, env, nextSeen, depth + 1);
    const result = mergePrimitiveResults(
      access.expressions.map((value) => resolvePrimitiveValues(value, context, env, nextSeen, depth + 1)),
    );
    return { values: result.values, unresolved: access.unresolved || result.unresolved };
  }
  if (ts.isCallExpression(expression)) {
    const calleeText = expression.expression.getText();
    if ((calleeText === "String" || calleeText === "Number") && expression.arguments[0]) {
      return resolvePrimitiveValues(expression.arguments[0], context, env, nextSeen, depth + 1);
    }
    const functions = declarationsFor(expression.expression, context)
      .map(functionLikeFor)
      .filter((fn): fn is ts.FunctionLikeDeclaration => Boolean(fn));
    if (!functions.length) return { values: [], unresolved: true };
    const results = functions.flatMap((fn) => {
      const child = childEnvForCall(fn, expression, env, context);
      return returnExpressions(fn).map((value) => resolvePrimitiveValues(value, context, child, nextSeen, depth + 1));
    });
    return results.length ? mergePrimitiveResults(results) : { values: [], unresolved: true };
  }
  return { values: [], unresolved: true };
}

function isNumberLikeExpression(
  rawExpression: ts.Expression,
  context: AuditContext,
  seen: Set<ts.Node> = new Set(),
): boolean {
  const expression = unwrapExpression(rawExpression);
  if (seen.has(expression)) return false;
  const nextSeen = new Set(seen).add(expression);
  if (ts.isNumericLiteral(expression)) return true;
  if (ts.isPrefixUnaryExpression(expression)) return isNumberLikeExpression(expression.operand, context, nextSeen);
  if (ts.isConditionalExpression(expression)) {
    return (
      isNumberLikeExpression(expression.whenTrue, context, nextSeen) &&
      isNumberLikeExpression(expression.whenFalse, context, nextSeen)
    );
  }
  if (ts.isBinaryExpression(expression)) {
    const arithmetic = new Set([
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
    ]);
    return (
      arithmetic.has(expression.operatorToken.kind) &&
      isNumberLikeExpression(expression.left, context, nextSeen) &&
      isNumberLikeExpression(expression.right, context, nextSeen)
    );
  }
  if (context.checker) {
    const type = context.checker.getTypeAtLocation(expression);
    if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return true;
  }
  if (ts.isIdentifier(expression)) {
    return declarationsFor(expression, context).some((declaration) => {
      if (
        (ts.isParameter(declaration) || ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
        declaration.type?.kind === ts.SyntaxKind.NumberKeyword
      ) {
        return true;
      }
      const initializer = initializerFor(declaration);
      return initializer ? isNumberLikeExpression(initializer, context, nextSeen) : false;
    });
  }
  return false;
}

function tokenizedNumericCalcTemplate(
  rawExpression: ts.Expression,
  property: string,
  context: AuditContext,
): string | null {
  const expression = unwrapExpression(rawExpression);
  if (propertyCategory(property) !== "spacing" || !ts.isTemplateExpression(expression)) return null;
  if (!expression.templateSpans.every((span) => isNumberLikeExpression(span.expression, context))) return null;
  let value = expression.head.text;
  for (const span of expression.templateSpans) value += `1${span.literal.text}`;
  return /^calc\(/i.test(value.trim()) ? value : null;
}

function nodeLocation(node: ts.Node): { file: string; line: number } {
  const sourceFile = node.getSourceFile();
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const file = sourceFile.fileName.startsWith("<")
    ? sourceFile.fileName
    : relative(packageRoot, sourceFile.fileName);
  return { file, line };
}

function auditPrimitiveExpression(
  property: string,
  expression: ts.Expression,
  locationNode: ts.Node,
  context: AuditContext,
  env: ResolveEnv,
): Violation[] {
  if (property.startsWith("--ab-")) {
    const location = nodeLocation(locationNode);
    return [makeViolation("LOCAL_AB_TOKEN_DEFINITION", location.file, location.line, property, expression.getText())];
  }
  const category = propertyCategory(property);
  if (!category) return [];
  const numericCalc = tokenizedNumericCalcTemplate(expression, property, context);
  if (numericCalc !== null) {
    const location = nodeLocation(locationNode);
    return validateValue(property, numericCalc, context.tokens).map((code) =>
      makeViolation(code, location.file, location.line, property, numericCalc),
    );
  }
  const result = resolvePrimitiveValues(expression, context, env);
  const location = nodeLocation(locationNode);
  const violations: Violation[] = [];
  if (result.unresolved || result.values.length === 0) {
    violations.push(makeViolation("UNPROVABLE_TOKEN_VALUE", location.file, location.line, property, expression.getText()));
  }
  for (const value of result.values) {
    if (value === null) continue;
    for (const code of validateValue(property, value, context.tokens)) {
      violations.push(makeViolation(code, location.file, location.line, property, String(value)));
    }
  }
  return violations;
}

function auditStyleExpression(
  expression: ts.Expression,
  locationNode: ts.Node,
  context: AuditContext,
  env: ResolveEnv = new Map(),
): Violation[] {
  const resolved = resolveObjectExpressions(expression, context, env);
  const location = nodeLocation(locationNode);
  const violations: Violation[] = [];
  if (resolved.unresolved) {
    violations.push(makeViolation("UNPROVABLE_STYLE_SOURCE", location.file, location.line, "style", expression.getText()));
  }
  for (const object of resolved.expressions) {
    if (!ts.isObjectLiteralExpression(object)) continue;
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        violations.push(...auditStyleExpression(property.expression, property, context, env));
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const name = staticPropertyName(property.name);
        if (name === null) {
          const propLocation = nodeLocation(property);
          violations.push(
            makeViolation(
              "UNPROVABLE_STYLE_SOURCE",
              propLocation.file,
              propLocation.line,
              "computed-style-property",
              property.getText(),
            ),
          );
        } else {
          violations.push(...auditPrimitiveExpression(name, property.initializer, property, context, env));
        }
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        violations.push(...auditPrimitiveExpression(property.name.text, property.name, property, context, env));
      }
    }
  }
  return violations;
}

function auditStyleExpressionAtNode(
  expression: ts.Expression,
  locationNode: ts.Node,
  context: AuditContext,
): Violation[] {
  const callEnvironments = directCallEnvironments(locationNode, context);
  if (callEnvironments.length === 0) return auditStyleExpression(expression, locationNode, context);
  return callEnvironments.flatMap((environment) =>
    auditStyleExpression(expression, locationNode, context, environment),
  );
}

function auditCssSource(source: string, file: string, tokens: Map<string, GuardCategory>): Violation[] {
  const violations: Violation[] = [];
  const root = postcss.parse(source, { from: file });
  root.walkDecls((decl) => {
    const line = decl.source?.start?.line ?? 1;
    if (decl.prop.startsWith("--ab-")) {
      violations.push(makeViolation("LOCAL_AB_TOKEN_DEFINITION", file, line, decl.prop, decl.value));
      return;
    }
    if (!propertyCategory(decl.prop)) return;
    for (const code of validateValue(decl.prop, decl.value, tokens)) {
      violations.push(makeViolation(code, file, line, decl.prop, decl.value));
    }
  });
  return violations;
}

function isStyleAccess(expression: ts.Expression): boolean {
  const target = unwrapExpression(expression);
  return (
    (ts.isPropertyAccessExpression(target) && target.name.text === "style") ||
    (ts.isElementAccessExpression(target) &&
      target.argumentExpression !== undefined &&
      ts.isStringLiteralLike(target.argumentExpression) &&
      target.argumentExpression.text === "style")
  );
}

function auditInlineStyleText(
  expression: ts.Expression,
  locationNode: ts.Node,
  context: AuditContext,
): Violation[] {
  const resolved = resolvePrimitiveValues(expression, context);
  const location = nodeLocation(locationNode);
  const violations: Violation[] = [];
  if (resolved.unresolved || resolved.values.length === 0) {
    violations.push(
      makeViolation("UNPROVABLE_TOKEN_VALUE", location.file, location.line, "style", expression.getText()),
    );
  }
  for (const value of resolved.values) {
    if (typeof value !== "string") continue;
    const parsed = auditCssSource(`.inline { ${value} }`, location.file, context.tokens);
    violations.push(...parsed.map((violation) => ({ ...violation, line: location.line })));
  }
  return violations;
}

function isIntrinsicJsxAttribute(node: ts.JsxAttribute): boolean {
  const element = node.parent.parent;
  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return false;
  if (ts.isJsxNamespacedName(element.tagName)) return true;
  return ts.isIdentifier(element.tagName) && /^[a-z]/.test(element.tagName.text);
}

function collectStyleSourceDeclarations(
  rawExpression: ts.Expression,
  context: AuditContext,
  declarations: Set<ts.Declaration>,
  seen: Set<ts.Node> = new Set(),
): void {
  const expression = unwrapExpression(rawExpression);
  if (seen.has(expression)) return;
  const nextSeen = new Set(seen).add(expression);

  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    for (const declaration of declarationsFor(expression, context)) {
      declarations.add(declaration);
      const initializer = initializerFor(declaration);
      if (initializer) collectStyleSourceDeclarations(initializer, context, declarations, nextSeen);
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      collectStyleSourceDeclarations(expression.expression, context, declarations, nextSeen);
    }
    return;
  }

  if (ts.isConditionalExpression(expression)) {
    collectStyleSourceDeclarations(expression.whenTrue, context, declarations, nextSeen);
    collectStyleSourceDeclarations(expression.whenFalse, context, declarations, nextSeen);
    return;
  }

  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      collectStyleSourceDeclarations(expression.left, context, declarations, nextSeen);
      collectStyleSourceDeclarations(expression.right, context, declarations, nextSeen);
    }
    return;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        collectStyleSourceDeclarations(property.expression, context, declarations, nextSeen);
      }
    }
    return;
  }

  if (ts.isCallExpression(expression)) {
    const calleeText = expression.expression.getText();
    if (calleeText === "Object.assign" || calleeText === "Object.freeze") {
      for (const argument of expression.arguments) {
        collectStyleSourceDeclarations(argument, context, declarations, nextSeen);
      }
      return;
    }
    for (const declaration of declarationsFor(expression.expression, context)) {
      const fn = functionLikeFor(declaration);
      if (!fn) continue;
      for (const returned of returnExpressions(fn)) {
        collectStyleSourceDeclarations(returned, context, declarations, nextSeen);
      }
    }
  }
}

function mutatesTrackedStyleObject(
  expression: ts.Expression,
  context: AuditContext,
  styleSources: ReadonlySet<ts.Declaration>,
): boolean {
  if (isStyleAccess(expression)) return true;
  return declarationsFor(unwrapExpression(expression), context).some((declaration) => styleSources.has(declaration));
}

function aliasesTrackedStyleObject(
  expression: ts.Expression,
  context: AuditContext,
  styleSources: ReadonlySet<ts.Declaration>,
): boolean {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return declarationsFor(target, context).some((declaration) => styleSources.has(declaration));
  }
  if (ts.isConditionalExpression(target)) {
    return (
      aliasesTrackedStyleObject(target.whenTrue, context, styleSources) ||
      aliasesTrackedStyleObject(target.whenFalse, context, styleSources)
    );
  }
  if (ts.isBinaryExpression(target)) {
    const operator = target.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return (
        aliasesTrackedStyleObject(target.left, context, styleSources) ||
        aliasesTrackedStyleObject(target.right, context, styleSources)
      );
    }
  }
  return false;
}

const assignmentOperators = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function auditSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker | undefined, tokens: Map<string, GuardCategory>): Violation[] {
  const context: AuditContext = { checker, locals: buildLocalIndex(sourceFile), tokens };
  const styleSources = new Set<ts.Declaration>();
  const collectStyleSources = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      collectStyleSourceDeclarations(node.initializer.expression, context, styleSources);
    }
    ts.forEachChild(node, collectStyleSources);
  };
  collectStyleSources(sourceFile);
  let foundAlias = true;
  while (foundAlias) {
    foundAlias = false;
    const collectAliases = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !styleSources.has(node) &&
        aliasesTrackedStyleObject(node.initializer, context, styleSources)
      ) {
        styleSources.add(node);
        foundAlias = true;
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sourceFile);
  }

  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (name === "style" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        violations.push(...auditStyleExpressionAtNode(node.initializer.expression, node, context));
      } else if (isIntrinsicJsxAttribute(node) && propertyCategory(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          for (const code of validateValue(name, node.initializer.text, tokens)) {
            const location = nodeLocation(node);
            violations.push(makeViolation(code, location.file, location.line, name, node.initializer.text));
          }
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          violations.push(...auditPrimitiveExpression(name, node.initializer.expression, node, context, new Map()));
        }
      }
    }

    if (ts.isBinaryExpression(node) && assignmentOperators.has(node.operatorToken.kind)) {
      const left = unwrapExpression(node.left);
      if (
        (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) &&
        mutatesTrackedStyleObject(left.expression, context, styleSources)
      ) {
        if (ts.isPropertyAccessExpression(left)) {
          if (left.name.text === "cssText") violations.push(...auditInlineStyleText(node.right, node, context));
          else violations.push(...auditPrimitiveExpression(left.name.text, node.right, node, context, new Map()));
        } else if (left.argumentExpression) {
          const properties = resolvePrimitiveValues(left.argumentExpression, context);
          const propertyNames = properties.values.filter((value): value is string => typeof value === "string");
          if (properties.unresolved || propertyNames.length === 0) {
            const location = nodeLocation(node);
            violations.push(
              makeViolation(
                "UNPROVABLE_STYLE_SOURCE",
                location.file,
                location.line,
                "style-assignment",
                left.argumentExpression.getText(),
              ),
            );
          }
          for (const property of propertyNames) {
            violations.push(...auditPrimitiveExpression(property, node.right, node, context, new Map()));
          }
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (
        node.expression.expression.getText() === "Object" &&
        node.expression.name.text === "assign" &&
        node.arguments[0] &&
        mutatesTrackedStyleObject(node.arguments[0], context, styleSources)
      ) {
        for (const source of node.arguments.slice(1)) {
          violations.push(...auditStyleExpression(source, node, context));
        }
      }
      const method = node.expression.name.text;
      if (method === "setProperty" && isStyleAccess(node.expression.expression) && node.arguments[0] && node.arguments[1]) {
        const properties = resolvePrimitiveValues(node.arguments[0], context);
        const propertyNames = properties.values.filter((value): value is string => typeof value === "string");
        if (properties.unresolved || propertyNames.length === 0) {
          const location = nodeLocation(node);
          violations.push(
            makeViolation(
              "UNPROVABLE_STYLE_SOURCE",
              location.file,
              location.line,
              "style.set-property",
              node.arguments[0].getText(),
            ),
          );
        }
        for (const property of propertyNames) {
          violations.push(...auditPrimitiveExpression(property, node.arguments[1], node, context, new Map()));
        }
      }
      if (method === "setAttribute" && node.arguments[0] && node.arguments[1]) {
        const attributes = resolvePrimitiveValues(node.arguments[0], context);
        for (const attribute of attributes.values) {
          if (attribute === "style") violations.push(...auditInlineStyleText(node.arguments[1], node, context));
          else if (typeof attribute === "string" && propertyCategory(attribute)) {
            violations.push(...auditPrimitiveExpression(attribute, node.arguments[1], node, context, new Map()));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function normalizeViolations(violations: Violation[]): Violation[] {
  const unique = new Map<string, Violation>();
  for (const violation of violations) {
    const key = [
      violation.file,
      violation.line,
      violation.property,
      violation.code,
      violation.value,
    ].join("\u0000");
    unique.set(key, violation);
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.property.localeCompare(b.property) ||
      a.code.localeCompare(b.code) ||
      a.value.localeCompare(b.value),
  );
}

function auditFixture(source: string, fileName: string, tokens: Map<string, GuardCategory>): Violation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  return normalizeViolations(auditSourceFile(sourceFile, undefined, tokens));
}

function auditFixtureWithChecker(source: string, tokens: Map<string, GuardCategory>): Violation[] {
  const fileName = resolve(packageRoot, "__design-token-guard-fixture.tsx");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const fixtureKey = fileName.replace(/\\/g, "/").toLowerCase();
  const isFixture = (path: string): boolean => path.replace(/\\/g, "/").toLowerCase() === fixtureKey;
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (path) => isFixture(path) || defaultFileExists(path);
  host.readFile = (path) => (isFixture(path) ? source : defaultReadFile(path));
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    isFixture(path)
      ? ts.createSourceFile(path, source, languageVersion, true, ts.ScriptKind.TSX)
      : defaultGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFiles().find((candidate) => isFixture(candidate.fileName));
  if (!sourceFile) throw new Error("failed to create checker-backed guard fixture");
  return normalizeViolations(auditSourceFile(sourceFile, program.getTypeChecker(), tokens));
}

function auditProduction(tokens: Map<string, GuardCategory>): Violation[] {
  const scriptFiles = collectFiles(consoleDir, new Set([".ts", ".tsx"])).filter(
    (file) => !/\.(?:test|spec)\.[tj]sx?$/.test(file),
  );
  const program = ts.createProgram(scriptFiles, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const violations: Violation[] = [];
  for (const file of scriptFiles) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile) violations.push(...auditSourceFile(sourceFile, checker, tokens));
  }
  for (const file of collectFiles(consoleDir, new Set([".css"]))) {
    violations.push(...auditCssSource(readFileSync(file, "utf8"), relative(packageRoot, file), tokens));
  }
  return normalizeViolations(violations);
}

function compactFindings(violations: Violation[]): string[] {
  return violations.map(({ code, property, line }) => `${code}:${property}:${line}`);
}

function formatViolations(violations: Violation[]): string {
  const shown = violations
    .slice(0, 120)
    .map((violation) =>
      `${violation.file}:${violation.line} ${violation.code} ${violation.property}=${JSON.stringify(violation.value)}`,
    );
  if (violations.length > shown.length) shown.push(`... ${violations.length - shown.length} more violation(s)`);
  return `design token source violations (${violations.length}):\n${shown.join("\n")}`;
}

const authorityRegistry = readAuthorityTokens();
const authorityTokens = authorityRegistry.tokens;

describe("design token source guard", () => {
  it("loads the repo authority token registry", () => {
    expect(authorityRegistry.violations).toEqual([]);
    expect(authorityTokens.size).toBeGreaterThan(50);
    expect(authorityTokens.get("--ab-text")).toBe("color");
    expect(authorityTokens.get("--ab-space-3")).toBe("spacing");
    expect(authorityTokens.get("--ab-r-md")).toBe("radius");
  });

  it("ignores comments, domain hashes, and unguarded geometry while accepting authority values", () => {
    const source = `
const domain = { route: "#a10", hash: "#abc", width: 320, padding: 8 };
// color: #fff; padding: 8px
const view = <div className="ab-card ab-mono" style={{
  width: 320,
  height: 56,
  top: 8,
  color: "var(--ab-text)",
  padding: "var(--ab-space-3)",
  marginLeft: "auto",
  borderRadius: "var(--ab-r-md)",
}} />;`.trim();
    expect(auditFixture(source, "<false-positive.tsx>", authorityTokens)).toEqual([]);
  });

  it("rejects raw inline color, typography, radius, and spacing values", () => {
    const source = `
const view = (
  <div
    style={{
      color: "#fff",
      background: "rgba(0,0,0,.5)",
      fontSize: 12,
      fontFamily: "monospace",
      fontWeight: 700,
      lineHeight: 1.5,
      letterSpacing: ".1em",
      padding: "8px 12px",
      gap: 8,
      borderRadius: "50%",
    }}
  />
);`.trim();
    expect(compactFindings(auditFixture(source, "<raw.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:color:4",
      "RAW_COLOR:background:5",
      "RAW_TYPOGRAPHY:font-size:6",
      "RAW_TYPOGRAPHY:font-family:7",
      "RAW_TYPOGRAPHY:font-weight:8",
      "RAW_TYPOGRAPHY:line-height:9",
      "RAW_TYPOGRAPHY:letter-spacing:10",
      "RAW_SPACING:padding:11",
      "RAW_SPACING:gap:12",
      "RAW_RADIUS:border-radius:13",
    ]);
  });

  it("follows object spreads and both conditional branches", () => {
    const source = `
const raw = { color: "#fff" };
const indirect = { ...raw };
const view = <div style={ok ? indirect : { padding: 8 }} />;`.trim();
    expect(compactFindings(auditFixture(source, "<indirect.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:color:1",
      "RAW_SPACING:padding:3",
    ]);
  });

  it("fails closed when a JSX style source cannot be resolved", () => {
    const source = "const view = <div style={externalStyle} />;";
    expect(compactFindings(auditFixture(source, "<unresolved.tsx>", authorityTokens))).toEqual([
      "UNPROVABLE_STYLE_SOURCE:style:1",
    ]);
  });

  it("rejects unknown tokens, wrong categories, and raw var fallbacks", () => {
    const source = `
const view = <div style={{
  color: "var(--ab-not-real)",
  padding: "var(--ab-text)",
  margin: "var(--ab-space-3, 8px)",
}} />;`.trim();
    expect(compactFindings(auditFixture(source, "<token-validation.tsx>", authorityTokens))).toEqual([
      "UNKNOWN_AB_TOKEN:color:2",
      "WRONG_TOKEN_CATEGORY:padding:3",
      "TOKEN_FALLBACK_NOT_ALLOWED:margin:4",
    ]);
  });

  it("rejects local authority token definitions in inline style APIs", () => {
    const source = `
const view = <div style={{ "--ab-text": "#fff", color: "var(--ab-text)" }} />;
node.style.setProperty("--ab-bg", "#000");
node.style["--ab-panel"] = "#111";`.trim();
    expect(compactFindings(auditFixture(source, "<local-token.tsx>", authorityTokens))).toEqual([
      "LOCAL_AB_TOKEN_DEFINITION:--ab-text:1",
      "LOCAL_AB_TOKEN_DEFINITION:--ab-bg:2",
      "LOCAL_AB_TOKEN_DEFINITION:--ab-panel:3",
    ]);
  });

  it("separates scalar color, gradient, shadow, and border-width tokens", () => {
    const source = `
const invalid = <div style={{
  borderColor: "var(--ab-space-3)",
  boxShadow: "var(--ab-space-3)",
  color: "var(--ab-gradient)",
}} />;
const valid = <div style={{
  background: "var(--ab-gradient)",
  backgroundImage: "linear-gradient(var(--ab-bg), var(--ab-panel))",
  boxShadow: "var(--ab-shadow-pop)",
  border: "var(--ab-space-px-1) solid var(--ab-border)",
}} />;`.trim();
    expect(compactFindings(auditFixture(source, "<categories.tsx>", authorityTokens))).toEqual([
      "WRONG_TOKEN_CATEGORY:border-color:2",
      "WRONG_TOKEN_CATEGORY:box-shadow:3",
      "WRONG_TOKEN_CATEGORY:color:4",
    ]);
  });

  it("rejects raw border shorthand widths while accepting the authority width token", () => {
    const source = `
const raw = <div style={{ border: "1px solid var(--ab-border)" }} />;
const safe = <div style={{ border: "var(--ab-space-px-1) solid var(--ab-border)" }} />;`.trim();
    expect(compactFindings(auditFixture(source, "<border-width.tsx>", authorityTokens))).toEqual([
      "RAW_SPACING:border:1",
    ]);
  });

  it("rejects raw border shorthand widths nested in CSS math functions", () => {
    const rawWidths = [
      "calc(1px)",
      "min(var(--ab-space-px-1), 2px)",
      "max(var(--ab-space-px-1), 2px)",
      "clamp(1px, var(--ab-space-px-1), 2px)",
      "calc(max(1px, var(--ab-space-px-1)))",
    ];
    for (const width of rawWidths) {
      const source = `<div style={{ border: "${width} solid var(--ab-border)" }} />`;
      expect(compactFindings(auditFixture(source, "<border-function-width.tsx>", authorityTokens))).toEqual([
        "RAW_SPACING:border:1",
      ]);
    }

    const tokenWidths = [
      "calc(var(--ab-space-px-1) * 2)",
      "min(var(--ab-space-px-1), var(--ab-space-1))",
      "max(var(--ab-space-px-1), var(--ab-space-1))",
      "clamp(var(--ab-space-px-1), var(--ab-space-1), var(--ab-space-2))",
    ];
    for (const width of tokenWidths) {
      const source = `<div style={{ border: "${width} solid var(--ab-border)" }} />`;
      expect(auditFixture(source, "<border-function-token.tsx>", authorityTokens)).toEqual([]);
    }
  });

  it("proves mapped object properties from a typed fixture array", () => {
    const source = `
interface AlertRow { c: string }
const alerts: AlertRow[] = [
  { c: "var(--ab-danger)" },
  { c: "#fff" },
];
const view = alerts.map((alert) => <div style={{ background: alert.c }} />);`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "RAW_COLOR:background:6",
    ]);
  });

  it("proves design values passed to every direct call of a private local helper", () => {
    const source = `
function card(color: string, spacing?: string) {
  return <div style={{ color, padding: spacing }} />;
}
const a = card("var(--ab-text)", "var(--ab-space-3)");
const b = card("var(--ab-danger)");`.trim();
    expect(auditFixtureWithChecker(source, authorityTokens)).toEqual([]);
  });

  it("applies a private helper default when a direct caller passes undefined", () => {
    const source = `
function card(color = "#fff") {
  return <div style={{ color }} />;
}
const raw = card(undefined);`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "RAW_COLOR:color:2",
    ]);
  });

  it("audits a raw helper default when an argument path may be undefined", () => {
    const source = `
const value = ok ? undefined : "var(--ab-text)";
function card(color = "#fff") {
  return <div style={{ color }} />;
}
const view = card(value);`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "RAW_COLOR:color:3",
    ]);
  });

  it("fails closed for mutable aliases passed into private style helpers", () => {
    const source = `
let value = undefined;
value = "#fff";
function card(color = "var(--ab-text)") {
  return <div style={{ color }} />;
}
const view = card(value);`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "UNPROVABLE_TOKEN_VALUE:color:4",
    ]);
  });

  it("rejects a raw design value passed to a private local helper", () => {
    const source = `
function card(color: string) {
  return <div style={{ color }} />;
}
const safe = card("var(--ab-text)");
const raw = card("#fff");`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "RAW_COLOR:color:2",
    ]);
  });

  it("fails closed when a local style helper escapes direct-call analysis", () => {
    const source = `
function card(color: string) {
  return <div style={{ color }} />;
}
const escaped = card;`.trim();
    expect(compactFindings(auditFixtureWithChecker(source, authorityTokens))).toEqual([
      "UNPROVABLE_TOKEN_VALUE:color:2",
    ]);
  });

  it("requires globally available, unique authority token definitions", () => {
    const registry = parseAuthorityTokens(
      `
:root, [data-ab-theme] {
  --ab-ok: #0f0;
  --ab-ok: #0a0;
}
.card { --ab-local: #fff; }
[data-ab-theme] { --ab-theme-only: #000; }`.trim(),
      "<authority.css>",
    );
    expect(compactFindings(registry.violations)).toEqual([
      "DUPLICATE_AUTHORITY_TOKEN:--ab-ok:3",
      "INVALID_AUTHORITY_TOKEN_SCOPE:--ab-local:5",
      "INVALID_AUTHORITY_TOKEN_SCOPE:--ab-theme-only:6",
    ]);
    expect([...registry.tokens.keys()]).toEqual(["--ab-ok"]);
  });

  it("does not treat custom component props as CSS declarations", () => {
    const source = `
const custom = <StatusPill color="red" padding={8} />;
const member = <UI.Pill color="#fff" />;
const svg = <path fill="#fff" />;`.trim();
    expect(compactFindings(auditFixture(source, "<component-props.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:fill:3",
    ]);
  });

  it("audits the Object.assign target object", () => {
    const source = `
const style = Object.assign(
  { color: "#fff" },
  { padding: "var(--ab-space-3)" },
);
const view = <div style={style} />;`.trim();
    expect(compactFindings(auditFixture(source, "<assign.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:color:2",
    ]);
  });

  it("audits mutations applied to an object later consumed as JSX style", () => {
    const source = `
const style = {};
style.color = "#fff";
Object.assign(style, { padding: 8, "--ab-text": "#fff" });
const view = <div style={style} />;`.trim();
    expect(compactFindings(auditFixture(source, "<mutable-style.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:color:2",
      "LOCAL_AB_TOKEN_DEFINITION:--ab-text:3",
      "RAW_SPACING:padding:3",
    ]);
  });

  it("audits reverse aliases and logical assignment mutations of JSX style objects", () => {
    const source = `
const style = {};
const alias = style;
alias.color ||= "#fff";
alias.padding ??= 8;
Object.assign(alias, { "--ab-text": "#fff" });
const view = <div style={style} />;`.trim();
    expect(compactFindings(auditFixture(source, "<mutable-style-alias.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:color:3",
      "RAW_SPACING:padding:4",
      "LOCAL_AB_TOKEN_DEFINITION:--ab-text:5",
    ]);
  });

  it("does not classify non-color background geometry as a color token", () => {
    const source = '<div style={{ backgroundPosition: "var(--ab-space-3)" }} />';
    expect(auditFixture(source, "<background-geometry.tsx>", authorityTokens)).toEqual([]);
  });

  it("accepts explicit absent style values", () => {
    const source = `
const absent = undefined;
const a = <div style={null} />;
const b = <div style={undefined} />;
const c = <div style={ok ? absent : { color: "var(--ab-text)" }} />;`.trim();
    expect(auditFixture(source, "<absent-style.tsx>", authorityTokens)).toEqual([]);
  });

  it("rejects CSS system colors", () => {
    const source =
      '<div style={{ color: "CanvasText", background: "ButtonFace", borderColor: "Highlight" }} />';
    expect(compactFindings(auditFixture(source, "<system-colors.tsx>", authorityTokens))).toEqual([
      "RAW_COLOR:background:1",
      "RAW_COLOR:border-color:1",
      "RAW_COLOR:color:1",
    ]);
  });

  it("accepts number-typed runtime factors only when the spacing length is tokenized", () => {
    const safe = [
      "function indent(depth: number) {",
      "  return <div style={{ marginLeft: `calc(${depth} * var(--ab-space-5))` }} />;",
      "}",
    ].join("\n");
    expect(auditFixture(safe, "<numeric-calc-safe.tsx>", authorityTokens)).toEqual([]);

    const raw = [
      "function indent(depth: number) {",
      "  return <div style={{ marginLeft: `calc(${depth} * 12px)` }} />;",
      "}",
    ].join("\n");
    expect(compactFindings(auditFixture(raw, "<numeric-calc-raw.tsx>", authorityTokens))).toEqual([
      "RAW_SPACING:margin-left:2",
    ]);
  });

  it("parses CSS declarations without treating selectors, comments, or url fragments as colors", () => {
    const safe = `
/* #fff; padding: 8px */
#a10 {
  width: 320px;
  inset: 8px;
  background-image: url("/icons.svg#a10");
}`.trim();
    expect(auditCssSource(safe, "<safe.css>", authorityTokens)).toEqual([]);

    const raw = `
.raw {
  color: red;
  background: linear-gradient(90deg, #fff, rgba(0,0,0,.5));
  font-size: 12px;
  padding: 8px;
  border-radius: 50%;
  --ab-local-shadow: #fff;
}`.trim();
    expect(compactFindings(normalizeViolations(auditCssSource(raw, "<raw.css>", authorityTokens)))).toEqual([
      "RAW_COLOR:color:2",
      "RAW_COLOR:background:3",
      "RAW_TYPOGRAPHY:font-size:4",
      "RAW_SPACING:padding:5",
      "RAW_RADIUS:border-radius:6",
      "LOCAL_AB_TOKEN_DEFINITION:--ab-local-shadow:7",
    ]);
  });

  it("keeps every production console color, typography, radius, and spacing value on the authority", () => {
    const violations = normalizeViolations([...authorityRegistry.violations, ...auditProduction(authorityTokens)]);
    const output = process.env.TOKEN_AUTHORITY_AUDIT_OUTPUT;
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(
        output,
        `${JSON.stringify({ schemaVersion: "1.0", authority: relative(packageRoot, authorityPath).replace(/\\/g, "/"), violations }, null, 2)}\n`,
        "utf8",
      );
    }
    if (violations.length) throw new Error(formatViolations(violations));
  });
});
