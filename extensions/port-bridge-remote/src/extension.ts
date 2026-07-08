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

class RemoteBridge {
  private readonly _output = vscode.window.createOutputChannel('Local Port Bridge Remote');
  private readonly _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  private readonly _sessions = new Map<number, Session>();
  private readonly _servers: net.Server[] = [];
  private _controlServer: net.Server | undefined;
  private _controlSocket: net.Socket | undefined;
  private _nextSessionId = 1;
  private _starting: Promise<void> | undefined;

  constructor() {
    this._status.command = 'localPortBridge.remote.showStatus';
    this._status.text = '$(plug) Port Bridge Remote: stopped';
    this._status.show();
  }

  dispose(): void {
    void this.stop();
    this._status.dispose();
    this._output.dispose();
  }

  async start(): Promise<void> {
    if (this._starting) {
      return this._starting;
    }

    this._starting = this.__start();
    try {
      await this._starting;
    } finally {
      this._starting = undefined;
    }
  }

  async stop(): Promise<void> {
    for (const _session of this._sessions.values()) {
      _session.socket.destroy();
    }
    this._sessions.clear();

    this._controlSocket?.destroy();
    this._controlSocket = undefined;

    for (const _server of this._servers.splice(0)) {
      _server.close();
    }

    if (this._controlServer) {
      this._controlServer.close();
      this._controlServer = undefined;
    }

    this.__setStatus('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  showStatus(): void {
    const _state = this._controlServer ? 'running' : 'stopped';
    const _control = this._controlSocket && !this._controlSocket.destroyed ? 'connected' : 'waiting';
    void vscode.window.showInformationMessage(
      `Local Port Bridge Remote is ${_state}. control=${_control}, sessions=${this._sessions.size}`
    );
  }

  private async __start(): Promise<void> {
    await this.stop();

    const _mappings = this.__readMappings();
    if (_mappings.length === 0) {
      this.__setStatus('no mappings');
      this.__log('No localPortBridge.mappings are configured.');
      return;
    }

    this.__setStatus('starting');
    await this.__startControlServer();

    for (const _mapping of _mappings) {
      if (_mapping.remoteSocket) {
        this.__listenUnixSocket(_mapping, _mapping.remoteSocket);
      }

      if (_mapping.remotePort) {
        this.__listenTcp(_mapping, _mapping.remoteHost, _mapping.remotePort);
      }
    }

    this.__setStatus('running');
  }

  private async __startControlServer(): Promise<void> {
    const _server = net.createServer((_socket) => this.__acceptControl(_socket));
    this._controlServer = _server;

    await new Promise<void>((_resolve, _reject) => {
      _server.once('error', _reject);
      _server.listen(0, '127.0.0.1', () => {
        _server.off('error', _reject);
        _resolve();
      });
    });

    const _address = _server.address();
    if (!_address || typeof _address === 'string') {
      throw new Error('Failed to resolve remote control server address.');
    }

    const _remoteUri = vscode.Uri.parse(`http://127.0.0.1:${_address.port}`);
    const _localUri = await vscode.env.asExternalUri(_remoteUri);
    this.__log(`Remote control server: ${_remoteUri.toString()}`);
    this.__log(`Forwarded control URI: ${_localUri.toString()}`);

    try {
      await vscode.commands.executeCommand('localPortBridge.local.connectControl', {
        uri: _localUri.toString()
      });
    } catch (_error) {
      throw new Error(
        `Port Bridge Local is not available on the UI side. Install and enable ` +
        `lwmacct.port-bridge-local locally, then reload the window. ` +
        `Original error: ${_error instanceof Error ? _error.message : String(_error)}`
      );
    }
  }

  private __acceptControl(_socket: net.Socket): void {
    this._controlSocket?.destroy();
    this._controlSocket = _socket;
    this.__setStatus('control connected');
    this.__log('Local control connection accepted.');

    const _reader = new FrameReader();
    _socket.setNoDelay(true);

    _socket.on('data', (_chunk) => {
      _reader.push(typeof _chunk === 'string' ? Buffer.from(_chunk) : _chunk, (_frame) => {
        this.__handleFrame(_frame);
      });
    });

    _socket.on('error', (_error) => {
      this.__log(`Control connection error: ${_error.message}`);
    });

    _socket.on('close', () => {
      if (this._controlSocket === _socket) {
        this._controlSocket = undefined;
      }
      for (const _session of this._sessions.values()) {
        _session.socket.destroy();
      }
      this._sessions.clear();
      this.__setStatus('waiting for local');
      this.__log('Local control connection closed.');
    });
  }

  private __listenUnixSocket(_mapping: Mapping, _socketPath: string): void {
    fs.mkdirSync(path.dirname(_socketPath), { recursive: true });
    fs.rmSync(_socketPath, { force: true });

    const _server = net.createServer((_socket) => this.__acceptSession(_mapping, _socket));
    _server.listen(_socketPath, () => {
      fs.chmodSync(_socketPath, 0o600);
      this.__log(`${_mapping.name}: listening on unix socket ${_socketPath}`);
    });
    _server.on('error', (_error) => this.__log(`${_mapping.name}: unix socket error: ${_error.message}`));
    this._servers.push(_server);
  }

  private __listenTcp(_mapping: Mapping, _host: string, _port: number): void {
    const _server = net.createServer((_socket) => this.__acceptSession(_mapping, _socket));
    _server.listen(_port, _host, () => {
      this.__log(`${_mapping.name}: listening on tcp ${_host}:${_port}`);
    });
    _server.on('error', (_error) => this.__log(`${_mapping.name}: tcp error: ${_error.message}`));
    this._servers.push(_server);
  }

  private __acceptSession(_mapping: Mapping, _socket: net.Socket): void {
    if (!this._controlSocket || this._controlSocket.destroyed) {
      _socket.destroy(new Error('Local control channel is not connected.'));
      return;
    }

    const _sessionId = this._nextSessionId++;
    _socket.setNoDelay(true);
    this._sessions.set(_sessionId, {
      socket: _socket,
      mappingName: _mapping.name
    });

    this.__send(FrameType.Open, _sessionId, Buffer.from(JSON.stringify({
      name: _mapping.name,
      localHost: _mapping.localHost,
      localPort: _mapping.localPort
    }), 'utf8'));

    _socket.on('data', (_chunk) => {
      this.__send(FrameType.Data, _sessionId, typeof _chunk === 'string' ? Buffer.from(_chunk) : _chunk);
    });

    _socket.on('error', (_error) => {
      this.__log(`${_mapping.name}: remote session error: ${_error.message}`);
      this.__send(FrameType.Error, _sessionId, Buffer.from(_error.message, 'utf8'));
    });

    _socket.on('close', () => {
      this._sessions.delete(_sessionId);
      this.__send(FrameType.Close, _sessionId);
    });
  }

  private __handleFrame(_frame: Frame): void {
    switch (_frame.type) {
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

  private __closeSession(_sessionId: number): void {
    const _session = this._sessions.get(_sessionId);
    if (!_session) {
      return;
    }

    this._sessions.delete(_sessionId);
    _session.socket.destroy();
  }

  private __send(_type: FrameType, _sessionId: number, _payload?: Uint8Array): void {
    if (!this._controlSocket || this._controlSocket.destroyed) {
      return;
    }

    this._controlSocket.write(encodeFrame(_type, _sessionId, _payload));
  }

  private __readMappings(): Mapping[] {
    const _config = vscode.workspace.getConfiguration('localPortBridge');
    const _rawMappings = _config.get<unknown[]>('mappings', []);
    const _mappings: Mapping[] = [];

    for (const _raw of _rawMappings) {
      if (!_raw || typeof _raw !== 'object') {
        continue;
      }

      const _item = _raw as Record<string, unknown>;
      const _name = typeof _item.name === 'string' ? _item.name.trim() : '';
      const _localHost = typeof _item.localHost === 'string' && _item.localHost.trim()
        ? _item.localHost.trim()
        : '127.0.0.1';
      const _localPort = typeof _item.localPort === 'number' ? _item.localPort : 0;
      const _remoteSocket = typeof _item.remoteSocket === 'string' && _item.remoteSocket.trim()
        ? _item.remoteSocket.trim()
        : undefined;
      const _remoteHost = typeof _item.remoteHost === 'string' && _item.remoteHost.trim()
        ? _item.remoteHost.trim()
        : '127.0.0.1';
      const _remotePort = typeof _item.remotePort === 'number' ? _item.remotePort : undefined;

      if (!_name || !_localPort || (!_remoteSocket && !_remotePort)) {
        this.__log(`Skipping invalid mapping: ${JSON.stringify(_item)}`);
        continue;
      }

      _mappings.push({
        name: _name,
        localHost: _localHost,
        localPort: _localPort,
        remoteSocket: _remoteSocket,
        remoteHost: _remoteHost,
        remotePort: _remotePort
      });
    }

    return _mappings;
  }

  private __setStatus(_state: string): void {
    this._status.text = `$(plug) Port Bridge Remote: ${_state}`;
  }

  private __log(_message: string): void {
    this._output.appendLine(`[${new Date().toISOString()}] ${_message}`);
  }
}

let _bridge: RemoteBridge | undefined;

function __isRunningInWorkspaceHost(): boolean {
  const _extension = vscode.extensions.getExtension('lwmacct.port-bridge-remote');
  return _extension?.extensionKind === vscode.ExtensionKind.Workspace;
}

export function activate(_context: vscode.ExtensionContext): void {
  if (!__isRunningInWorkspaceHost()) {
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

  _bridge = new RemoteBridge();
  _context.subscriptions.push(
    _bridge,
    vscode.commands.registerCommand('localPortBridge.remote.start', () => _bridge?.start()),
    vscode.commands.registerCommand('localPortBridge.remote.stop', () => _bridge?.stop()),
    vscode.commands.registerCommand('localPortBridge.remote.restart', () => _bridge?.restart()),
    vscode.commands.registerCommand('localPortBridge.remote.showStatus', () => _bridge?.showStatus())
  );

  const _config = vscode.workspace.getConfiguration('localPortBridge');
  if (_config.get<boolean>('autoStart', true)) {
    void _bridge.start().catch((_error) => {
      void vscode.window.showErrorMessage(`Local Port Bridge remote failed to start: ${_error.message}`);
    });
  }
}

export function deactivate(): void {
  void _bridge?.stop();
}
