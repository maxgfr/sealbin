/**
 * The editor's colours for a code theme, so Compose follows the theme picked in the header the way
 * the viewer does. CodeMirror highlights with Lezer tags while Shiki themes colour TextMate scopes:
 * each tag is mapped to the scopes that usually carry its colour, and the theme's rules are
 * resolved for them the way TextMate does (the most specific matching selector wins).
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { type Tag, tags as t } from "@lezer/highlight";
import { codeThemeDefinition } from "./highlight";

export interface ScopeRule {
  readonly scope?: string | readonly string[];
  readonly settings: { readonly foreground?: string; readonly fontStyle?: string };
}

export interface ScopeStyle {
  color?: string;
  fontStyle?: string;
}

/** Whether TextMate selector `selector` (a single scope name) matches scope `scope`. */
function selects(selector: string, scope: string): boolean {
  return scope === selector || scope.startsWith(`${selector}.`);
}

/**
 * Style the theme gives `scope`: the rule with the longest matching selector, the later rule on a
 * tie. Selectors with a parent scope (`a b`) only apply in context and are left out.
 */
export function resolveScope(rules: readonly ScopeRule[], scope: string): ScopeStyle | null {
  let best: ScopeRule | null = null;
  let bestLength = -1;
  for (const rule of rules) {
    if (!rule.scope || (!rule.settings.foreground && !rule.settings.fontStyle)) continue;
    const selectors = typeof rule.scope === "string" ? rule.scope.split(",") : rule.scope;
    for (const raw of selectors) {
      const selector = raw.trim();
      if (selector.includes(" ") || !selects(selector, scope)) continue;
      if (selector.length >= bestLength) {
        best = rule;
        bestLength = selector.length;
      }
    }
  }
  if (!best) return null;
  const style: ScopeStyle = {};
  if (best.settings.foreground) style.color = best.settings.foreground;
  if (best.settings.fontStyle) style.fontStyle = best.settings.fontStyle;
  return style;
}

/** Lezer tags and the TextMate scopes that colour them, most specific first. */
const TAG_SCOPES: readonly [Tag | readonly Tag[], readonly string[]][] = [
  [[t.comment, t.lineComment, t.blockComment, t.docComment], ["comment"]],
  [
    [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
    ["keyword.control", "keyword"],
  ],
  [t.definitionKeyword, ["storage.type", "keyword"]],
  [t.modifier, ["storage.modifier", "keyword"]],
  [[t.string, t.special(t.string), t.attributeValue], ["string"]],
  [t.regexp, ["string.regexp", "string"]],
  [t.escape, ["constant.character.escape", "string"]],
  [
    [t.number, t.integer, t.float],
    ["constant.numeric", "constant"],
  ],
  [
    [t.bool, t.null, t.atom],
    ["constant.language", "constant"],
  ],
  [t.constant(t.variableName), ["variable.other.constant", "constant"]],
  [
    [t.self, t.special(t.variableName)],
    ["variable.language", "keyword"],
  ],
  [t.standard(t.variableName), ["support.variable", "variable.language", "variable"]],
  [[t.variableName, t.definition(t.variableName)], ["variable"]],
  [
    [t.function(t.variableName), t.function(t.propertyName)],
    ["entity.name.function", "support.function"],
  ],
  [t.macroName, ["entity.name.function.preprocessor", "entity.name.function"]],
  [
    [t.propertyName, t.definition(t.propertyName)],
    ["variable.other.property", "support.type.property-name", "meta.property-name", "variable"],
  ],
  [
    [t.typeName, t.standard(t.typeName)],
    ["entity.name.type", "support.type", "storage.type"],
  ],
  [t.className, ["entity.name.class", "entity.name.type", "support.class"]],
  [t.namespace, ["entity.name.namespace", "entity.name.type"]],
  [t.labelName, ["entity.name.label", "variable"]],
  [t.tagName, ["entity.name.tag"]],
  [t.attributeName, ["entity.other.attribute-name"]],
  [[t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator], ["keyword.operator"]],
  [
    [t.meta, t.processingInstruction],
    ["meta.preprocessor", "meta.directive", "keyword.control"],
  ],
  [t.annotation, ["meta.decorator", "entity.name.function"]],
  [t.heading, ["markup.heading", "entity.name.section"]],
  [t.emphasis, ["markup.italic"]],
  [t.strong, ["markup.bold"]],
  [t.strikethrough, ["markup.strikethrough"]],
  [
    [t.link, t.url],
    ["markup.underline.link", "string.other.link"],
  ],
  [t.quote, ["markup.quote"]],
  [t.monospace, ["markup.inline.raw", "markup.raw"]],
  [t.inserted, ["markup.inserted"]],
  [t.deleted, ["markup.deleted"]],
  [t.changed, ["markup.changed"]],
  [t.invalid, ["invalid"]],
];

/** Font styles a tag keeps whatever the theme says (Markdown emphasis, strong, links). */
const FIXED_STYLE = new Map<
  Tag,
  { fontStyle?: string; fontWeight?: string; textDecoration?: string }
>([
  [t.heading, { fontWeight: "bold" }],
  [t.emphasis, { fontStyle: "italic" }],
  [t.strong, { fontWeight: "bold" }],
  [t.strikethrough, { textDecoration: "line-through" }],
  [t.link, { textDecoration: "underline" }],
]);

/** CodeMirror style spec for a TextMate font style ("italic bold underline"). */
function fontSpec(fontStyle: string | undefined) {
  const words = new Set((fontStyle ?? "").split(/\s+/));
  return {
    ...(words.has("italic") ? { fontStyle: "italic" } : {}),
    ...(words.has("bold") ? { fontWeight: "bold" } : {}),
    ...(words.has("underline") ? { textDecoration: "underline" } : {}),
    ...(words.has("strikethrough") ? { textDecoration: "line-through" } : {}),
  };
}

/** CodeMirror highlight style for a theme's token rules. */
export function highlightStyleFor(rules: readonly ScopeRule[]): HighlightStyle {
  const specs = [];
  for (const [tagOrTags, scopes] of TAG_SCOPES) {
    const tagList = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags as Tag];
    let style: ScopeStyle | null = null;
    for (const scope of scopes) {
      style = resolveScope(rules, scope);
      if (style) break;
    }
    for (const tag of tagList) {
      const fixed = FIXED_STYLE.get(tag);
      if (!style && !fixed) continue;
      specs.push({
        tag,
        ...(style?.color ? { color: style.color } : {}),
        ...fontSpec(style?.fontStyle),
        ...fixed,
      });
    }
  }
  return HighlightStyle.define(specs);
}

export interface EditorLook {
  /** Syntax colours (a CodeMirror extension). */
  highlight: Extension;
  fg: string;
  bg: string;
}

/** Editor colours for Shiki theme `theme`. */
export async function editorLook(theme: string): Promise<EditorLook> {
  const def = await codeThemeDefinition(theme);
  return { highlight: syntaxHighlighting(highlightStyleFor(def.settings)), fg: def.fg, bg: def.bg };
}
