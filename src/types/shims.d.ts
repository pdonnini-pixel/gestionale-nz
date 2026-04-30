// Type shims for libraries without native TypeScript support
// See MIGRATION_NOTES.md for details

declare module 'xlsx' {
  const XLSX: any;
  export default XLSX;
  export const read: any;
  export const utils: any;
  export const writeFile: any;
  export const write: any;
}
