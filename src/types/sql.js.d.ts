// sql.js ships no TypeScript declarations; the block defines its own minimal
// runtime interfaces and only needs these module shims.
declare module "sql.js" {
  const initSqlJs: unknown;
  export default initSqlJs;
}
declare module "sql.js/dist/sql-wasm.wasm?url" {
  const url: string;
  export default url;
}
