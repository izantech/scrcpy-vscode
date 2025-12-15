/**
 * Mock child_process module for testing ADB commands
 */
import { EventEmitter } from 'events';
/**
 * Mock ChildProcess for testing spawned processes
 */
export declare class MockChildProcess extends EventEmitter {
  stdout: EventEmitter<[never]>;
  stderr: EventEmitter<[never]>;
  stdin: {
    write: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
    end: import('vitest').Mock<
      import('@vitest/spy', { with: { 'resolution-mode': 'import' } }).Procedure
    >;
  };
  killed: boolean;
  pid: number;
  kill: import('vitest').Mock<() => boolean>;
  simulateStdout(data: string | Buffer): void;
  simulateStderr(data: string | Buffer): void;
  simulateExit(code: number, signal?: string | null): void;
  simulateClose(code: number, signal?: string | null): void;
  simulateError(error: Error): void;
}
export declare const spawn: import('vitest').Mock<() => MockChildProcess>;
export declare const exec: import('vitest').Mock<
  (
    command: string,
    optionsOrCallback?:
      | Record<string, unknown>
      | ((error: Error | null, stdout: string, stderr: string) => void),
    callback?: (error: Error | null, stdout: string, stderr: string) => void
  ) => MockChildProcess
>;
export declare const execSync: import('vitest').Mock<() => Buffer>;
export declare function getLastMockProcess(): MockChildProcess | null;
export declare function resetMocks(): void;
//# sourceMappingURL=child_process.d.ts.map
