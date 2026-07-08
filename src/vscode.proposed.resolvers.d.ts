import type {
  Disposable,
  Event,
  FileStat,
  FileType,
  ProviderResult,
  Uri
} from 'vscode';

declare module 'vscode' {
  export interface MessageOptions {
    useCustom?: boolean;
  }

  export interface ManagedMessagePassing {
    readonly onDidReceiveMessage: Event<Uint8Array>;
    readonly onDidClose: Event<Error | undefined>;
    readonly onDidEnd: Event<void>;
    send: (data: Uint8Array) => void;
    end: () => void;
    drain?: () => Thenable<void>;
  }

  export interface ExecServer {
    spawn(command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<SpawnedCommand>;
    spawnRemoteServerConnector?(command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<RemoteServerConnector>;
    downloadCliExecutable?(buildTarget: CliBuild, command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<ProcessExit>;
    env(): Thenable<ExecEnvironment>;
    kill(processId: number): Thenable<void>;
    tcpConnect(host: string, port: number): Thenable<{ stream: WriteStream & ReadStream; done: Thenable<void> }>;
    readonly fs: RemoteFileSystem;
  }

  export type ProcessEnv = Record<string, string>;

  export interface ExecServerSpawnOptions {
    readonly env?: ProcessEnv;
    readonly cwd?: string;
  }

  export interface SpawnedCommand {
    readonly stdin: WriteStream;
    readonly stdout: ReadStream;
    readonly stderr: ReadStream;
    readonly onExit: Thenable<ProcessExit>;
  }

  export interface RemoteServerConnector {
    readonly logs: ReadStream;
    readonly onExit: Thenable<ProcessExit>;
    connect(params: ServeParams): Thenable<ManagedMessagePassing>;
  }

  export interface ProcessExit {
    readonly status: number;
    readonly message?: string;
  }

  export interface ReadStream {
    readonly onDidReceiveMessage: Event<Uint8Array>;
    readonly onEnd: Thenable<void>;
  }

  export interface WriteStream {
    write(data: Uint8Array): void;
    end(): void;
  }

  export interface ServeParams {
    readonly socketId: number;
    readonly commit?: string;
    readonly quality: string;
    readonly extensions: string[];
    readonly compress?: boolean;
    readonly connectionToken?: string;
  }

  export interface CliBuild {
    readonly quality: string;
    readonly buildTarget: string;
    readonly commit: string;
  }

  export interface ExecEnvironment {
    readonly env: ProcessEnv;
    readonly osPlatform: string;
    readonly osRelease?: string;
  }

  export interface RemoteFileSystem {
    stat(path: string): Thenable<FileStat>;
    mkdirp(path: string): Thenable<void>;
    rm(path: string): Thenable<void>;
    read(path: string): Thenable<ReadStream>;
    write(path: string): Thenable<{ stream: WriteStream; done: Thenable<void> }>;
    connect(path: string): Thenable<{ stream: WriteStream & ReadStream; done: Thenable<void> }>;
    rename(fromPath: string, toPath: string): Thenable<void>;
    readdir(path: string): Thenable<DirectoryEntry[]>;
  }

  export interface DirectoryEntry {
    type: FileType;
    name: string;
  }

  export interface RemoteAuthorityResolverContext {
    resolveAttempt: number;
    execServer?: ExecServer;
  }

  export interface RemoteAuthorityResolver {
    resolve(authority: string, context: RemoteAuthorityResolverContext): unknown | Thenable<unknown>;
    resolveExecServer?(remoteAuthority: string, context: RemoteAuthorityResolverContext): ExecServer | Thenable<ExecServer>;
    getCanonicalURI?(uri: Uri): ProviderResult<Uri>;
  }

  export interface ResourceLabelFormatter {
    scheme: string;
    authority?: string;
    formatting: unknown;
  }

  export namespace workspace {
    export function registerRemoteAuthorityResolver(authorityPrefix: string, resolver: RemoteAuthorityResolver): Disposable;
    export function registerResourceLabelFormatter(formatter: ResourceLabelFormatter): Disposable;
    export function getRemoteExecServer(authority: string): Thenable<ExecServer | undefined>;
  }

  export namespace env {
    export const remoteAuthority: string | undefined;
  }
}
