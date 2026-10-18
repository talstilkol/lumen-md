/**
 * Plan 0.4.2: an empty `catch` block must say why the error is ignored, with
 * a comment that starts with `why:` inside the block:
 *
 *   try { localStorage.setItem(k, v); } catch { /* why: storage denied in private mode *\/ }
 *
 * A catch that does something (even just `return null`) is not affected.
 */
const WHY = /^\s*why:\s*\S/;

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Require a `why:` comment in empty catch blocks" },
    schema: [],
    messages: {
      missing: "Empty catch block: say why the error is ignored with a `// why: …` comment inside it.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      CatchClause(node) {
        const block = node.body;
        if (block.body.length > 0) return;
        const comments = source.getCommentsInside(block);
        if (comments.some((c) => WHY.test(c.value.replace(/^\*+/, "")))) return;
        context.report({ node: block, messageId: "missing" });
      },
    };
  },
};
