// The root vitest `include` only covers src/__tests__; pull in the VS Code
// extension's own HTML-generation tests so they run with the main suite.
import "../../packages/vscode-lumen/test/render.test";
import "../../packages/vscode-lumen/test/links.test";
