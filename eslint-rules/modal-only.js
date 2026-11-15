/**
 * Plan 10.1 / W10.E8: `aria-modal` only in src/ui/Modal.tsx. Every modal
 * dialog is <Modal> — a native <dialog> opened with showModal(), so the page
 * behind is inert, with the focus trap, Escape and focus back to the opener.
 * A `<div aria-modal="true">` promises all of that and delivers none of it.
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "Allow `aria-modal` only in the Modal primitive (src/ui/Modal.tsx)" },
    schema: [],
    messages: {
      useModal: "A modal dialog is <Modal> (src/ui/Modal.tsx): a native <dialog> with an inert page behind it. Do not set aria-modal by hand.",
    },
  },
  create(context) {
    const file = (context.filename ?? context.getFilename()).replace(/\\/g, "/");
    if (file.endsWith("src/ui/Modal.tsx")) return {};
    return {
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "aria-modal") context.report({ node, messageId: "useModal" });
      },
      CallExpression(node) {
        const c = node.callee;
        const a = node.arguments[0];
        if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && c.property.name === "setAttribute" && a?.type === "Literal" && a.value === "aria-modal") context.report({ node, messageId: "useModal" });
      },
      Property(node) {
        const k = node.key;
        if ((k.type === "Literal" && k.value === "aria-modal") || (k.type === "Identifier" && k.name === "aria-modal")) context.report({ node, messageId: "useModal" });
      },
    };
  },
};
