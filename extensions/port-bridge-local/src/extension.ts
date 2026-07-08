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
  private readonly _output = vscode.window.createOutputChannel('Local Port Bridge Local');
  private readonly _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly _sessions = new Map<number, Session>();
  private _control: net.Socket | undefined;

  constructor() {
    this._status.command = 'localPortBridge.local.showStatus';
    this._status.text = '$(plug) Port Bridge Local: waiting';
    this._status.show();
  }

  dispose(): void {
    this.__disconnectControl();
    this._status.dispose();
    this._output.dispose();
  }

  showStatus(): void {
    const _state = this._control && !this._control.destroyed ? 'connected' : 'waiting';
    void vscode.window.showInformationMessage(
      `Local Port Bridge Local is ${_state}. sessions=${this._sessions.size}`
    );
  }

  connectControl(_payload: ConnectControlPayload): void {
    this.__disconnectControl();

    const _url = new URL(_payload.uri);
    const _port = Number(_url.port || (_url.protocol === 'https:' ? 443 : 80));
    const _host = _url.hostname;

    this.__log(`Connecting control channel to ${_host}:${_port} (${_payload.uri})`);

    const _socket = net.connect({ host: _host, port: _port });
    const _reader = new FrameReader();
    this._control = _socket;

    _socket.setNoDelay(true);

    _socket.on('connect', () => {
      this.__setStatus('connected');
      this.__log('Control channel connected.');
    });

    _socket.on('data', (_chunk) => {
      _reader.push(typeof _chunk === 'string' ? Buffer.from(_chunk) : _chunk, (_frame) => {
        this.__handleFrame(_frame);
      });
    });

    _socket.on('error', (_error) => {
      this.__log(`Control channel error: ${_error.message}`);
      this.__setStatus('error');
    });

    _socket.on('close', () => {
      if (this._control === _socket) {
        this._control = undefined;
      }
      for (const _session of this._sessions.values()) {
        _session.socket.destroy();
      }
      this._sessions.clear();
      this.__setStatus('waiting');
      this.__log('Control channel closed.');
    });
  }

  private __handleFrame(_frame: Frame): void {
    switch (_frame.type) {
      case FrameType.Open:
        this.__openSession(_frame);
        break;
      case FrameType.Data:
        this._sessions.get(_frame.sessionId)?.socket.write(_frame.payload);
        break;
      case FrameType.Close:
      case FrameType.Error:
        this.__closeSession(_frame.sessionId);
        break;
      default:
        this.__log(`Ignoring unknown frame type ${_frame.type}`);
    }
  }

  private __openSession(_frame: Frame): void {
    const _payload = JSON.parse(_frame.payload.toString('utf8')) as OpenPayload;
    const _socket = net.connect({
      host: _payload.localHost,
      port: _payload.localPort
    });

    _socket.setNoDelay(true);
    this._sessions.set(_frame.sessionId, {
      socket: _socket,
      mappingName: _payload.name
    });

    _socket.on('data', (_chunk) => {
      this.__send(FrameType.Data, _frame.sessionId, typeof _chunk === 'string' ? Buffer.from(_chunk) : _chunk);
    });

    _socket.on('error', (_error) => {
      this.__log(`${_payload.name}: local connection error: ${_error.message}`);
      this.__send(FrameType.Error, _frame.sessionId, Buffer.from(_error.message, 'utf8'));
    });

    _socket.on('close', () => {
      this._sessions.delete(_frame.sessionId);
      this.__send(FrameType.Close, _frame.sessionId);
    });
  }

  private __closeSession(_sessionId: number): void {
    const _session = this._sessions.get(_sessionId);
    if (!_session) {
      return;
    }

    this._sessions.delete(_sessionId);
    _session.socket.destroy();
  }

  private __send(_type: FrameType, _sessionId: number, _payload?: Uint8Array): void {
    if (!this._control || this._control.destroyed) {
      return;
    }

    this._control.write(encodeFrame(_type, _sessionId, _payload));
  }

  private __disconnectControl(): void {
    for (const _session of this._sessions.values()) {
      _session.socket.destroy();
    }
    this._sessions.clear();

    if (this._control) {
      this._control.destroy();
      this._control = undefined;
    }
  }

  private __setStatus(_state: string): void {
    this._status.text = `$(plug) Port Bridge Local: ${_state}`;
  }

  private __log(_message: string): void {
    this._output.appendLine(`[${new Date().toISOString()}] ${_message}`);
  }
}

let _bridge: LocalBridge | undefined;

function __isRunningInUiHost(): boolean {
  const _extension = vscode.extensions.getExtension('lwmacct.port-bridge-local');
  return _extension?.extensionKind === vscode.ExtensionKind.UI;
}

export function activate(_context: vscode.ExtensionContext): void {
  if (!__isRunningInUiHost()) {
    void vscode.window.showErrorMessage(
      'Port Bridge Local 必须运行在本机 UI extension host。请把它安装/启用在本机侧，不要作为远程 workspace 扩展运行。'
    );
    return;
  }

  _bridge = new LocalBridge();
  _context.subscriptions.push(
    _bridge,
    vscode.commands.registerCommand('localPortBridge.local.connectControl', (_payload: ConnectControlPayload) => {
      _bridge?.connectControl(_payload);
    }),
    vscode.commands.registerCommand('localPortBridge.local.showStatus', () => {
      _bridge?.showStatus();
    })
  );
}

export function deactivate(): void {
  _bridge?.dispose();
}
