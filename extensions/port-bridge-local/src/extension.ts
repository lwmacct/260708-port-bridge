import * as net from 'node:net';
import * as vscode from 'vscode';
import { encodeFrame, Frame, FrameReader, FrameType } from './frame';

interface ConnectControlPayload {
  readonly uri: string;
}

interface OpenPayload {
  readonly name: string;
  readonly localHost: string;
  readonly localPort: number;
}

interface Session {
  readonly socket: net.Socket;
  readonly mappingName: string;
}

class LocalBridge {
  private readonly output = vscode.window.createOutputChannel('Port Bridge Local');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly sessions = new Map<number, Session>();
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
      this.setStatus('waiting');
      this.log('Control channel closed.');
    });
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Open:
        this.openSession(frame);
        break;
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

  private openSession(frame: Frame): void {
    const payload = JSON.parse(frame.payload.toString('utf8')) as OpenPayload;
    const socket = net.connect({
      host: payload.localHost,
      port: payload.localPort
    });

    socket.setNoDelay(true);
    this.sessions.set(frame.sessionId, {
      socket,
      mappingName: payload.name
    });

    socket.on('data', (chunk) => {
      this.send(FrameType.Data, frame.sessionId, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });

    socket.on('error', (error) => {
      this.log(`${payload.name}: local connection error: ${error.message}`);
      this.send(FrameType.Error, frame.sessionId, Buffer.from(error.message, 'utf8'));
    });

    socket.on('close', () => {
      this.sessions.delete(frame.sessionId);
      this.send(FrameType.Close, frame.sessionId);
    });
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
