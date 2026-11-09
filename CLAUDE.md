# Eggless — instructions for Claude

Next.js app: find cafés and show their breakfast menus with egg dishes removed. See README.md and docs/ARCHITECTURE.md.

## How to work (Karpathy's four rules)

1. **Think before coding.** State your assumptions and the plan in a few lines. If a request is unclear or two readings are possible, ask instead of guessing.
2. **Keep it simple.** Write the least code that solves the problem. No speculative abstractions, options or layers "for later".
3. **Make surgical changes.** Touch only what the task needs. Don't reformat, rename or refactor unrelated code; mention problems you notice instead of fixing them silently.
4. **Work to a success criterion.** Turn the task into a check you can run (a test, a type check, a script), then loop until it passes. Report what you ran and what's left.

## Checks

- Success means `npm run typecheck` and `npm test` (vitest) both pass. Add or update a test with every behaviour change.
- It is a preference filter, not an allergen tool: only clear egg dishes count, not hidden egg.
- Never commit keys or `.env.local`; use `.env.example` for new variables.
