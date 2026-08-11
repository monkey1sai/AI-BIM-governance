---
name: gitnexus-refactoring
description: "Use when the user wants to rename, extract, split, move, or restructure code safely"
---

# Refactoring with GitNexus CLI

## Workflow

```bash
gitnexus status
gitnexus impact "SymbolName" -d upstream -r AI-BIM-governance
gitnexus query "SymbolName" -r AI-BIM-governance
gitnexus context "SymbolName" -r AI-BIM-governance
```

Then plan the update order: interfaces → implementations → callers → tests.

If the index is stale, use the unavailable gate unless the current turn authorizes the pinned refresh:

```bash
npx gitnexus@1.6.9 analyze --index-only
gitnexus status
```

## Rename checklist

- [ ] Run `impact` and `context` for the old symbol.
- [ ] Search strings and dynamic references directly in source.
- [ ] Use a language-aware rename or explicit per-file edits; the GitNexus CLI has no rename command.
- [ ] Review every changed path.
- [ ] Run `gitnexus detect-changes --scope compare --base-ref main -r AI-BIM-governance`.
- [ ] Run affected tests.

## Extract or split checklist

- [ ] Use `context` to map callers, callees, and processes.
- [ ] Use upstream `impact` to identify external dependants.
- [ ] Define the new boundary before moving code.
- [ ] Update imports and callers in dependency order.
- [ ] Run detect-changes and affected tests.

## Useful commands

```bash
gitnexus impact "validateUser" -d upstream -r AI-BIM-governance
gitnexus context "validateUser" -r AI-BIM-governance
gitnexus detect-changes --scope compare --base-ref main -r AI-BIM-governance
gitnexus cypher 'MATCH (caller)-[:CodeRelation {type: "CALLS"}]->(f:Function {name: "validateUser"}) RETURN caller.name, caller.filePath' -r AI-BIM-governance
```

## Risk rules

| Risk factor | Mitigation |
| --- | --- |
| Many callers | Update direct callers first and widen tests |
| Cross-area references | Preserve interfaces or coordinate the boundary change |
| String/dynamic references | Use direct source search in addition to the graph |
| Public API | Version or deprecate explicitly |
| Graph unavailable | Report UNKNOWN and use the documented unavailable gate |

Never use blind find-and-replace for a symbol rename.
