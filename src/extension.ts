import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { encodeFrame, Frame, FrameReader, FrameType } from './frame';

interface Mapping {
  readonly name: string;
  readonly localHost: string;
  readonly localPort: number;
  readonly remoteSocket?: string;
  readonly remoteHost?: string;
  readonly remotePort?: number;
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

class BridgeController {
  private readonly _output = vscode.window.createOutputChannel('Local Port Bridge');
  private readonly _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly _sessions = new Map<number, Session>();
  private _process: vscode.SpawnedCommand | undefined;
  private _starting: Promise<void> | undefined;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this._status.command = 'localPortBridge.showStatus';
    this._status.text = '$(plug) Port Bridge';
    this._status.tooltip = 'Local Port Bridge';
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

    if (this._process) {
      this._process.stdin.end();
      this._process = undefined;
    }

    this.__setStatus('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  showStatus(): void {
    const _mappingCount = this.__readMappings().length;
    const _state = this._process ? 'running' : 'stopped';
    void vscode.window.showInformationMessage(
      `Local Port Bridge is ${_state}. mappings=${_mappingCount}, sessions=${this._sessions.size}`
    );
  }

  private async __start(): Promise<void> {
    if (this._process) {
      this.__log('Bridge is already running.');
      return;
    }

    const _authority = vscode.env.remoteAuthority;
    if (!_authority) {
      this.__setStatus('local window');
      this.__log('No remote authority is active. Open a Remote SSH or Dev Container window first.');
      return;
    }

    const _mappings = this.__readMappings();
    if (_mappings.length === 0) {
      this.__setStatus('no mappings');
      this.__log('No localPortBridge.mappings are configured.');
      return;
    }

    this.__setStatus('starting');
    this.__log(`Resolving remote exec server for ${_authority}`);

    const _execServer = await vscode.workspace.getRemoteExecServer(_authority);
    if (!_execServer) {
      throw new Error(`No remote exec server is available for ${_authority}`);
    }

    const _env = await _execServer.env();
    if (_env.osPlatform === 'win32') {
      throw new Error('Remote Windows targets are not supported by this Unix socket PoC.');
    }

    const _remoteRoot = '/tmp/vscode-local-port-bridge';
    const _remoteHelper = `${_remoteRoot}/remote-helper-${this._context.extension.packageJSON.version}.js`;
    await _execServer.fs.mkdirp(_remoteRoot);
    await this.__uploadHelper(_execServer, _remoteHelper);

    const _config = Buffer.from(JSON.stringify({ mappings: _mappings }), 'utf8').toString('base64');
    const _shellCommand = `exec node ${this.__shellQuote(_remoteHelper)} ${this.__shellQuote(_config)}`;

    this.__log(`Starting remote helper: ${_remoteHelper}`);
    this._process = await _execServer.spawn('sh', ['-lc', _shellCommand], {
      env: {
        LOCAL_PORT_BRIDGE: '1'
      }
    });

    this.__wireProcess(this._process);
    this.__setStatus('running');
  }

  private async __uploadHelper(_execServer: vscode.ExecServer, _remotePath: string): Promise<void> {
    const _localPath = path.join(this._context.extensionUri.fsPath, 'dist', 'remote-helper.js');
    let _helper: Buffer;

    try {
      _helper = await fs.readFile(_localPath);
    } catch (_error) {
      throw new Error(`Missing ${_localPath}. Run npm run compile before starting the extension.`);
    }

    const _write = await _execServer.fs.write(_remotePath);
    _write.stream.write(_helper);
    _write.stream.end();
    await _write.done;
  }

  private __wireProcess(_process: vscode.SpawnedCommand): void {
    const _reader = new FrameReader();
    const _decoder = new TextDecoder();

    _process.stdout.onDidReceiveMessage((_chunk) => {
      _reader.push(_chunk, (_frame) => this.__handleFrame(_process, _frame));
    });

    _process.stderr.onDidReceiveMessage((_chunk) => {
      this.__log(_decoder.decode(_chunk).trimEnd());
    });

    void _process.onExit.then((_exit) => {
      this.__log(`Remote helper exited with status ${_exit.status}${_exit.message ? `: ${_exit.message}` : ''}`);
      if (this._process === _process) {
        this._process = undefined;
        this.__setStatus('stopped');
      }
    });
  }

  private __handleFrame(_process: vscode.SpawnedCommand, _frame: Frame): void {
    switch (_frame.type) {
      case FrameType.Open:
        this.__openLocalSession(_process, _frame);
        break;
      case FrameType.Data:
        this._sessions.get(_frame.sessionId)?.socket.write(_frame.payload);
        break;
      case FrameType.Close:
        this.__closeLocalSession(_process, _frame.sessionId);
        break;
      case FrameType.Error:
        this.__log(`remote session ${_frame.sessionId}: ${_frame.payload.toString('utf8')}`);
        this.__closeLocalSession(_process, _frame.sessionId);
        break;
      default:
        this.__log(`Ignoring unknown frame type ${_frame.type}`);
    }
  }

  private __openLocalSession(_process: vscode.SpawnedCommand, _frame: Frame): void {
    const _payload = JSON.parse(_frame.payload.toString('utf8')) as OpenPayload;
    const _socket = net.connect({
      host: _payload.localHost,
      port: _payload.localPort
    });

    this._sessions.set(_frame.sessionId, {
      socket: _socket,
      mappingName: _payload.name
    });

    _socket.on('data', (_chunk) => {
      _process.stdin.write(encodeFrame(
        FrameType.Data,
        _frame.sessionId,
        typeof _chunk === 'string' ? Buffer.from(_chunk) : _chunk
      ));
    });

    _socket.on('error', (_error) => {
      this.__log(`${_payload.name}: local connection error: ${_error.message}`);
      _process.stdin.write(encodeFrame(FrameType.Error, _frame.sessionId, Buffer.from(_error.message, 'utf8')));
      _process.stdin.write(encodeFrame(FrameType.Close, _frame.sessionId));
    });

    _socket.on('close', () => {
      this._sessions.delete(_frame.sessionId);
      _process.stdin.write(encodeFrame(FrameType.Close, _frame.sessionId));
    });
  }

  private __closeLocalSession(_process: vscode.SpawnedCommand, _sessionId: number): void {
    const _session = this._sessions.get(_sessionId);
    if (!_session) {
      return;
    }

    this._sessions.delete(_sessionId);
    _session.socket.destroy();
    _process.stdin.write(encodeFrame(FrameType.Close, _sessionId));
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

  private __shellQuote(_value: string): string {
    return `'${_value.replace(/'/g, `'\\''`)}'`;
  }

  private __setStatus(_state: string): void {
    this._status.text = `$(plug) Port Bridge: ${_state}`;
  }

  private __log(_message: string): void {
    if (_message) {
      this._output.appendLine(`[${new Date().toISOString()}] ${_message}`);
    }
  }
}

let _controller: BridgeController | undefined;

export function activate(_context: vscode.ExtensionContext): void {
  _controller = new BridgeController(_context);
  _context.subscriptions.push(_controller);

  _context.subscriptions.push(
    vscode.commands.registerCommand('localPortBridge.start', () => _controller?.start()),
    vscode.commands.registerCommand('localPortBridge.stop', () => _controller?.stop()),
    vscode.commands.registerCommand('localPortBridge.restart', () => _controller?.restart()),
    vscode.commands.registerCommand('localPortBridge.showStatus', () => _controller?.showStatus())
  );

  const _config = vscode.workspace.getConfiguration('localPortBridge');
  if (_config.get<boolean>('autoStart', true)) {
    void _controller.start().catch((_error) => {
      void vscode.window.showErrorMessage(`Local Port Bridge failed to start: ${_error.message}`);
    });
  }
}

export function deactivate(): void {
  void _controller?.stop();
}
