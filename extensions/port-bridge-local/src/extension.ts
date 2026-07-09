import * as net from 'node:net';
import * as vscode from 'vscode';
import { encodeFrame, Frame, FrameReader, FrameType } from './frame';

interface ConnectControlPayload {
  readonly uri: string;
}

interface OpenPayload {
  readonly name: string;
  readonly local: Endpoint[];
}

interface Session {
  readonly socket: net.Socket;
  readonly mappingName: string;
}

type Endpoint =
  | TcpEndpoint
  | UnixEndpoint;

interface TcpEndpoint {
  readonly kind: 'tcp';
  readonly host: string;
  readonly port: number;
}

interface UnixEndpoint {
  readonly kind: 'unix';
  readonly path: string;
}

class LocalBridge {
  private readonly output = vscode.window.createOutputChannel('Port Bridge Local');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly sessions = new Map<number, Session>();
  private readonly pendingData = new Map<number, Buffer[]>();
  private readonly closedSessions = new Set<number>();
  private control: net.Socket | undefined;

  constructor() {
    this.status.command = 'portBridge.local.showStatus';
    this.status.text = '$(plug) Port Bridge Local: waiting';
    this.status.show();
  }

  dispose(): void {
    this.disconnectControl();
    this.status.dispose();
    this.output.dispose();
  }

  showStatus(): void {
    const state = this.control && !this.control.destroyed ? 'connected' : 'waiting';
    void vscode.window.showInformationMessage(
      `Port Bridge Local is ${state}. sessions=${this.sessions.size}`
    );
  }

  connectControl(payload: ConnectControlPayload): void {
    this.disconnectControl();

    const url = new URL(payload.uri);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const host = url.hostname;

    this.log(`Connecting control channel to ${host}:${port} (${payload.uri})`);

    const socket = net.connect({ host, port });
    const reader = new FrameReader();
    this.control = socket;

    socket.setNoDelay(true);

    socket.on('connect', () => {
      this.setStatus('connected');
      this.log('Control channel connected.');
    });

    socket.on('data', (chunk) => {
      reader.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, (frame) => {
        this.handleFrame(frame);
      });
    });

    socket.on('error', (error) => {
      this.log(`Control channel error: ${error.message}`);
      this.setStatus('error');
    });

    socket.on('close', () => {
      if (this.control === socket) {
        this.control = undefined;
      }
      for (const session of this.sessions.values()) {
        session.socket.destroy();
      }
      this.sessions.clear();
      this.pendingData.clear();
      this.closedSessions.clear();
      this.setStatus('waiting');
      this.log('Control channel closed.');
    });
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Open:
        void this.openSession(frame);
        break;
      case FrameType.Data:
        this.writeSessionData(frame.sessionId, frame.payload);
        break;
      case FrameType.Close:
      case FrameType.Error:
        this.closeSession(frame.sessionId);
        break;
      default:
        this.log(`Ignoring unknown frame type ${frame.type}`);
    }
  }

  private async openSession(frame: Frame): Promise<void> {
    const payload = JSON.parse(frame.payload.toString('utf8')) as OpenPayload;
    this.closedSessions.delete(frame.sessionId);

    let socket: net.Socket;
    try {
      socket = await this.connectLocal(payload.local);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`${payload.name}: local connection error: ${message}`);
      this.pendingData.delete(frame.sessionId);
      this.send(FrameType.Error, frame.sessionId, Buffer.from(message, 'utf8'));
      this.send(FrameType.Close, frame.sessionId);
      return;
    }

    if (this.closedSessions.has(frame.sessionId)) {
      this.closedSessions.delete(frame.sessionId);
      this.pendingData.delete(frame.sessionId);
      socket.destroy();
      return;
    }

    socket.setNoDelay(true);
    this.sessions.set(frame.sessionId, {
      socket,
      mappingName: payload.name
    });
    this.flushPendingData(frame.sessionId, socket);

    socket.on('data', (chunk) => {
      this.send(FrameType.Data, frame.sessionId, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });

    socket.on('error', (error) => {
      this.log(`${payload.name}: local connection error: ${error.message}`);
      this.send(FrameType.Error, frame.sessionId, Buffer.from(error.message, 'utf8'));
    });

    socket.on('close', () => {
      this.sessions.delete(frame.sessionId);
      this.pendingData.delete(frame.sessionId);
      this.closedSessions.delete(frame.sessionId);
      this.send(FrameType.Close, frame.sessionId);
    });
  }

  private writeSessionData(sessionId: number, payload: Buffer): void {
    if (this.closedSessions.has(sessionId)) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.write(payload);
      return;
    }

    const pending = this.pendingData.get(sessionId) ?? [];
    pending.push(payload);
    this.pendingData.set(sessionId, pending);
  }

  private flushPendingData(sessionId: number, socket: net.Socket): void {
    const pending = this.pendingData.get(sessionId);
    if (!pending) {
      return;
    }

    this.pendingData.delete(sessionId);
    this.closedSessions.delete(sessionId);
    for (const payload of pending) {
      socket.write(payload);
    }
  }

  private async connectLocal(endpoints: readonly Endpoint[]): Promise<net.Socket> {
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      throw new Error('No local endpoints were provided.');
    }

    const errors: string[] = [];

    for (const endpoint of endpoints) {
      try {
        return await this.connectEndpoint(endpoint);
      } catch (error) {
        errors.push(`${this.formatEndpoint(endpoint)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`All local endpoints failed: ${errors.join('; ')}`);
  }

  private connectEndpoint(endpoint: Endpoint): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = endpoint.kind === 'tcp'
        ? net.connect({ host: endpoint.host, port: endpoint.port })
        : net.connect({ path: endpoint.path });

      const cleanup = (): void => {
        socket.off('connect', onConnect);
        socket.off('error', onError);
      };
      const onConnect = (): void => {
        cleanup();
        resolve(socket);
      };
      const onError = (error: Error): void => {
        cleanup();
        socket.destroy();
        reject(error);
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }

  private formatEndpoint(endpoint: Endpoint): string {
    if (endpoint.kind === 'unix') {
      return `unix:${endpoint.path}`;
    }

    return `${endpoint.host}:${endpoint.port}`;
  }

  private closeSession(sessionId: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.pendingData.delete(sessionId);
      this.closedSessions.add(sessionId);
      return;
    }

    this.sessions.delete(sessionId);
    this.pendingData.delete(sessionId);
    this.closedSessions.delete(sessionId);
    session.socket.destroy();
  }

  private send(type: FrameType, sessionId: number, payload?: Uint8Array): void {
    if (!this.control || this.control.destroyed) {
      return;
    }

    this.control.write(encodeFrame(type, sessionId, payload));
  }

  private disconnectControl(): void {
    for (const session of this.sessions.values()) {
      session.socket.destroy();
    }
    this.sessions.clear();
    this.pendingData.clear();
    this.closedSessions.clear();

    if (this.control) {
      this.control.destroy();
      this.control = undefined;
    }
  }

  private setStatus(state: string): void {
    this.status.text = `$(plug) Port Bridge Local: ${state}`;
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

let bridge: LocalBridge | undefined;

function isRunningInUiHost(): boolean {
  const extension = vscode.extensions.getExtension('lwmacct.port-bridge-local');
  return extension?.extensionKind === vscode.ExtensionKind.UI;
}

export function activate(context: vscode.ExtensionContext): void {
  if (!isRunningInUiHost()) {
    void vscode.window.showErrorMessage(
      'Port Bridge Local 必须运行在本机 UI extension host。请把它安装/启用在本机侧，不要作为远程 workspace 扩展运行。'
    );
    return;
  }

  bridge = new LocalBridge();
  context.subscriptions.push(
    bridge,
    vscode.commands.registerCommand('portBridge.local.connectControl', (payload: ConnectControlPayload) => {
      bridge?.connectControl(payload);
    }),
    vscode.commands.registerCommand('portBridge.local.showStatus', () => {
      bridge?.showStatus();
    })
  );
}

export function deactivate(): void {
  bridge?.dispose();
}
