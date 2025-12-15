/**
 * Minimal VS Code API mock for testing
 * Based on @types/vscode but with stubbed implementations
 */
export declare const l10n: {
  t: (message: string, ...args: unknown[]) => string;
};
export declare const window: {
  showErrorMessage: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showWarningMessage: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showInformationMessage: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showQuickPick: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showInputBox: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showSaveDialog: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  showOpenDialog: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  withProgress: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  createOutputChannel: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
};
export declare const workspace: {
  getConfiguration: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  onDidChangeConfiguration: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  fs: {
    writeFile: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
    readFile: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
  };
};
export declare const env: {
  clipboard: {
    readText: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
    writeText: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
  };
  openExternal: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
};
export declare class Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
  static file(path: string): Uri;
  static parse(value: string): Uri;
  static joinPath(base: Uri, ...pathSegments: string[]): Uri;
  constructor(scheme: string, authority: string, path: string, query: string, fragment: string);
  toString(): string;
  get fsPath(): string;
  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri;
}
export declare const commands: {
  registerCommand: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
  executeCommand: import('vitest').Mock<
    import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
  >;
};
export declare enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}
export declare enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}
export declare class Disposable {
  private callOnDispose;
  static from(
    ...disposables: {
      dispose: () => unknown;
    }[]
  ): Disposable;
  constructor(callOnDispose: () => unknown);
  dispose(): unknown;
}
export declare class EventEmitter<T> {
  private listeners;
  event: (listener: (e: T) => unknown) => Disposable;
  fire(event: T): void;
  dispose(): void;
}
//# sourceMappingURL=vscode.d.ts.map
