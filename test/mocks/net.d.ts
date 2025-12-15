/**
 * Mock net module for testing socket connections
 */
import { EventEmitter } from 'events';
/**
 * Mock Socket for testing ScrcpyConnection
 */
export declare class MockSocket extends EventEmitter {
  destroyed: boolean;
  readable: boolean;
  writable: boolean;
  write: import('vitest').Mock<(_data: Buffer | Uint8Array) => boolean>;
  end: import('vitest').Mock<() => this>;
  destroy: import('vitest').Mock<() => this>;
  setTimeout: import('vitest').Mock<() => this>;
  setNoDelay: import('vitest').Mock<() => this>;
  setKeepAlive: import('vitest').Mock<() => this>;
  ref: import('vitest').Mock<() => this>;
  unref: import('vitest').Mock<() => this>;
  simulateData(data: Buffer | Uint8Array): void;
  simulateConnect(): void;
  simulateClose(hadError?: boolean): void;
  simulateError(error: Error): void;
  simulateEnd(): void;
}
/**
 * Mock Server for testing socket connections
 */
export declare class MockServer extends EventEmitter {
  listening: boolean;
  address: import('vitest').Mock<
    () => {
      address: string;
      family: string;
      port: number;
    }
  >;
  listen: import('vitest').Mock<
    (
      port?: number | string | Record<string, unknown>,
      host?: string | (() => void),
      callback?: () => void
    ) => MockServer
  >;
  close: import('vitest').Mock<(callback?: (err?: Error) => void) => MockServer>;
  ref: import('vitest').Mock<() => this>;
  unref: import('vitest').Mock<() => this>;
  simulateConnection(socket?: MockSocket): MockSocket;
  simulateError(error: Error): void;
  simulateClose(): void;
}
export declare const createServer: import('vitest').Mock<
  (
    options?: Record<string, unknown> | ((socket: MockSocket) => void),
    connectionListener?: (socket: MockSocket) => void
  ) => MockServer
>;
export declare const createConnection: import('vitest').Mock<
  (
    options?: number | string | Record<string, unknown>,
    _host?: string | (() => void),
    connectionListener?: () => void
  ) => MockSocket
>;
export declare const connect: import('vitest').Mock<
  (
    options?: number | string | Record<string, unknown>,
    _host?: string | (() => void),
    connectionListener?: () => void
  ) => MockSocket
>;
export declare const Socket: typeof MockSocket;
export declare const Server: typeof MockServer;
export declare function resetMocks(): void;
//# sourceMappingURL=net.d.ts.map
