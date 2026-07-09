import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { encodeFrame, Frame, FrameReader, FrameType } from './frame';

interface Mapping {
  readonly name: string;
  readonly localHost: string;
  readonly localPort: number;
  readonly remoteSocket?: string;
  readonly remoteHost: string;
  readonly remotePort?: number;
}

interface Session {
  readonly socket: net.Socket;
  readonly mappingName: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SOCKET_DIR = '/tmp/vscode-port-bridge';

class RemoteBridge {
  private readonly output = vscode.window.createOutputChannel('Port Bridge Remote');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  private readonly sessions = new Map<number, Session>();
  private readonly servers: net.Server[] = [];
  private controlServer: net.Server | undefined;
  private controlSocket: net.Socket | undefined;
  private controlPort: number | undefined;
  private lastForwardedControlUri: string | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private running = false;
  private nextSessionId = 1;
  private starting: Promise<void> | undefined;

  constructor() {
    this.status.command = 'portBridge.remote.reconnectControl';
    this.status.text = '$(plug) Port Bridge Remote: stopped';
    this.status.tooltip = 'Reconnect Port Bridge control channel';
    this.status.show();
  }

  dispose(): void {
    void this.stop();
    this.status.dispose();
    this.output.dispose();
  }

  async start(): Promise<void> {
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startBridge();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearReconnectTimer();

    for (const session of this.sessions.values()) {
      session.socket.destroy();
    }
    this.sessions.clear();

    this.controlSocket?.destroy();
    this.controlSocket = undefined;

    for (const server of this.servers.splice(0)) {
      server.close();
    }

    if (this.controlServer) {
      this.controlServer.close();
      this.controlServer = undefined;
    }
    this.controlPort = undefined;
    this.lastForwardedControlUri = undefined;

    this.setStatus('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  showStatus(): void {
    const state = this.controlServer ? 'running' : 'stopped';
    const control = this.controlSocket && !this.controlSocket.destroyed ? 'connected' : 'waiting';
    void vscode.window.showInformationMessage(
      `Port Bridge Remote is ${state}. control=${control}, ` +
      `controlPort=${this.controlPort ?? 'none'}, forwarded=${this.lastForwardedControlUri ?? 'none'}, ` +
      `sessions=${this.sessions.size}`
    );
  }

  async reconnectControl(): Promise<void> {
    if (!this.controlServer || !this.controlPort) {
      await this.start();
      return;
    }

    this.controlSocket?.destroy();
    this.controlSocket = undefined;
    await this.connectLocalControl();
  }

  private async startBridge(): Promise<void> {
    await this.stop();
    this.running = true;

    const mappings = this.readMappings();
    if (mappings.length === 0) {
      this.setStatus('no mappings');
      this.log('No portBridge.mappings are configured.');
      this.running = false;
      return;
    }

    this.setStatus('starting');
    await this.startControlServer();

    for (const mapping of mappings) {
      if (mapping.remoteSocket) {
        this.listenUnixSocket(mapping, mapping.remoteSocket);
      }

      if (mapping.remotePort) {
        this.listenTcp(mapping, mapping.remoteHost, mapping.remotePort);
      }
    }

    this.setStatus('running');
  }

  private async startControlServer(): Promise<void> {
    const server = net.createServer((socket) => this.acceptControl(socket));
    this.controlServer = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, DEFAULT_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve remote control server address.');
    }

    this.controlPort = address.port;
    await this.connectLocalControl();
  }

  private async connectLocalControl(): Promise<void> {
    if (!this.controlPort) {
      throw new Error('Remote control server is not listening.');
    }

    const remoteUri = vscode.Uri.parse(`http://${DEFAULT_HOST}:${this.controlPort}`);
    const localUri = await vscode.env.asExternalUri(remoteUri);
    this.lastForwardedControlUri = localUri.toString();
    this.log(`Remote control server: ${remoteUri.toString()}`);
    this.log(`Forwarded control URI: ${localUri.toString()}`);

    try {
      await vscode.commands.executeCommand('portBridge.local.connectControl', {
        uri: localUri.toString()
      });
    } catch (error) {
      throw new Error(
        `Port Bridge Local is not available on the UI side. Install and enable ` +
        `lwmacct.port-bridge-local locally, then reload the window. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private scheduleControlReconnect(): void {
    if (!this.running || !this.controlServer || this.reconnectTimer) {
      return;
    }

    const config = vscode.workspace.getConfiguration('portBridge');
    const delayMs = config.get<number>('controlReconnectDelayMs', 1000);
    const delay = Math.min(Math.max(delayMs, 100), 30000);
    this.setStatus(`reconnecting in ${delay}ms`);
    this.log(`Scheduling control channel reconnect in ${delay}ms.`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectLocalControl().catch((error) => {
        this.log(`Control channel reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        this.scheduleControlReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private acceptControl(socket: net.Socket): void {
    this.clearReconnectTimer();
    this.controlSocket?.destroy();
    this.controlSocket = socket;
    this.setStatus('control connected');
    this.log('Local control connection accepted.');

    const reader = new FrameReader();
    socket.setNoDelay(true);

    socket.on('data', (chunk) => {
      reader.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, (frame) => {
        this.handleFrame(frame);
      });
    });

    socket.on('error', (error) => {
      this.log(`Control connection error: ${error.message}`);
    });

    socket.on('close', () => {
      if (this.controlSocket === socket) {
        this.controlSocket = undefined;
      }
      for (const session of this.sessions.values()) {
        session.socket.destroy();
      }
      this.sessions.clear();
      this.setStatus('waiting for local');
      this.log('Local control connection closed.');
      this.scheduleControlReconnect();
    });
  }

  private listenUnixSocket(mapping: Mapping, socketPath: string): void {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    fs.rmSync(socketPath, { force: true });

    const server = net.createServer((socket) => this.acceptSession(mapping, socket));
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      this.log(`${mapping.name}: listening on unix socket ${socketPath}`);
    });
    server.on('error', (error) => this.log(`${mapping.name}: unix socket error: ${error.message}`));
    this.servers.push(server);
  }

  private listenTcp(mapping: Mapping, host: string, port: number): void {
    const server = net.createServer((socket) => this.acceptSession(mapping, socket));
    server.listen(port, host, () => {
      this.log(`${mapping.name}: listening on tcp ${host}:${port}`);
    });
    server.on('error', (error) => this.log(`${mapping.name}: tcp error: ${error.message}`));
    this.servers.push(server);
  }

  private acceptSession(mapping: Mapping, socket: net.Socket): void {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      socket.destroy(new Error('Local control channel is not connected.'));
      return;
    }

    const sessionId = this.nextSessionId++;
    socket.setNoDelay(true);
    this.sessions.set(sessionId, {
      socket,
      mappingName: mapping.name
    });

    this.send(FrameType.Open, sessionId, Buffer.from(JSON.stringify({
      name: mapping.name,
      localHost: mapping.localHost,
      localPort: mapping.localPort
    }), 'utf8'));

    socket.on('data', (chunk) => {
      this.send(FrameType.Data, sessionId, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });

    socket.on('error', (error) => {
      this.log(`${mapping.name}: remote session error: ${error.message}`);
      this.send(FrameType.Error, sessionId, Buffer.from(error.message, 'utf8'));
    });

    socket.on('close', () => {
      this.sessions.delete(sessionId);
      this.send(FrameType.Close, sessionId);
    });
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Data:
        this.sessions.get(frame.sessionId)?.socket.write(frame.payload);
        break;
      case FrameType.Close:
      case FrameType.Error:
        this.closeSession(frame.sessionId);
        break;
      default:
        this.log(`Ignoring unknown frame type ${frame.type}`);
    }
  }

  private closeSession(sessionId: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    session.socket.destroy();
  }

  private send(type: FrameType, sessionId: number, payload?: Uint8Array): void {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      return;
    }

    this.controlSocket.write(encodeFrame(type, sessionId, payload));
  }

  private readMappings(): Mapping[] {
    const config = vscode.workspace.getConfiguration('portBridge');
    const rawMappings = config.get<unknown[]>('mappings', []);
    const mappings: Mapping[] = [];

    for (const raw of rawMappings) {
      const mapping = this.normalizeMapping(raw);
      if (!mapping) {
        this.log(`Skipping invalid mapping: ${JSON.stringify(raw)}`);
        continue;
      }

      mappings.push(mapping);
    }

    return mappings;
  }

  private normalizeMapping(raw: unknown): Mapping | undefined {
    if (this.isPort(raw)) {
      const name = `port-${raw}`;
      return {
        name,
        localHost: DEFAULT_HOST,
        localPort: raw,
        remoteSocket: this.defaultSocketPath(name),
        remoteHost: DEFAULT_HOST,
        remotePort: raw
      };
    }

    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const item = raw as Record<string, unknown>;
    const port = this.isPort(item.port) ? item.port : undefined;
    const localPort = this.isPort(item.localPort) ? item.localPort : port;
    if (!localPort) {
      return undefined;
    }

    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : `port-${localPort}`;
    const localHost = typeof item.localHost === 'string' && item.localHost.trim()
      ? item.localHost.trim()
      : DEFAULT_HOST;
    const remoteHost = typeof item.remoteHost === 'string' && item.remoteHost.trim()
      ? item.remoteHost.trim()
      : DEFAULT_HOST;
    const remotePort = this.isPort(item.remotePort) ? item.remotePort : port ?? localPort;
    const remoteSocket = typeof item.remoteSocket === 'string' && item.remoteSocket.trim()
      ? item.remoteSocket.trim()
      : this.defaultSocketPath(name);

    return {
      name,
      localHost,
      localPort,
      remoteSocket,
      remoteHost,
      remotePort
    };
  }

  private isPort(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
  }

  private defaultSocketPath(name: string): string {
    return path.join(DEFAULT_SOCKET_DIR, `${name}.sock`);
  }

  private setStatus(state: string): void {
    this.status.text = `$(plug) Port Bridge Remote: ${state}`;
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

let bridge: RemoteBridge | undefined;

function isRunningInWorkspaceHost(): boolean {
  const extension = vscode.extensions.getExtension('lwmacct.port-bridge-remote');
  return extension?.extensionKind === vscode.ExtensionKind.Workspace;
}

export function activate(context: vscode.ExtensionContext): void {
  if (!isRunningInWorkspaceHost()) {
    void vscode.window.showErrorMessage(
      'Port Bridge Remote 必须运行在远程 workspace extension host。请把它安装/启用在远程侧，不要作为本机 UI 扩展运行。'
    );
    return;
  }

  if (!vscode.env.remoteName) {
    void vscode.window.showErrorMessage(
      'Port Bridge Remote 只能在 Remote SSH、Dev Containers 等远程窗口中使用。'
    );
    return;
  }

  bridge = new RemoteBridge();
  context.subscriptions.push(
    bridge,
    vscode.commands.registerCommand('portBridge.remote.start', () => bridge?.start()),
    vscode.commands.registerCommand('portBridge.remote.stop', () => bridge?.stop()),
    vscode.commands.registerCommand('portBridge.remote.restart', () => bridge?.restart()),
    vscode.commands.registerCommand('portBridge.remote.reconnectControl', () => bridge?.reconnectControl()),
    vscode.commands.registerCommand('portBridge.remote.showStatus', () => bridge?.showStatus())
  );

  const config = vscode.workspace.getConfiguration('portBridge');
  if (config.get<boolean>('autoStart', true)) {
    void bridge.start().catch((error) => {
      void vscode.window.showErrorMessage(`Port Bridge remote failed to start: ${error.message}`);
    });
  }
}

export function deactivate(): void {
  void bridge?.stop();
}
