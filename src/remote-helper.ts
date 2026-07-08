import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

const enum FrameType {
  Open = 1,
  Data = 2,
  Close = 3,
  Error = 4
}

const HEADER_LENGTH = 9;

interface Mapping {
  readonly name: string;
  readonly localHost: string;
  readonly localPort: number;
  readonly remoteSocket?: string;
  readonly remoteHost?: string;
  readonly remotePort?: number;
}

interface Config {
  readonly mappings: Mapping[];
}

interface Frame {
  readonly type: FrameType;
  readonly sessionId: number;
  readonly payload: Buffer;
}

function __encodeFrame(_type: FrameType, _sessionId: number, _payload?: Uint8Array): Buffer {
  const _body = _payload ? Buffer.from(_payload) : Buffer.alloc(0);
  const _frame = Buffer.allocUnsafe(HEADER_LENGTH + _body.length);
  _frame.writeUInt8(_type, 0);
  _frame.writeUInt32BE(_sessionId, 1);
  _frame.writeUInt32BE(_body.length, 5);
  _body.copy(_frame, HEADER_LENGTH);
  return _frame;
}

class FrameReader {
  private _buffer = Buffer.alloc(0);

  push(_chunk: Uint8Array, _onFrame: (_frame: Frame) => void): void {
    this._buffer = Buffer.concat([this._buffer, Buffer.from(_chunk)]);

    while (this._buffer.length >= HEADER_LENGTH) {
      const _type = this._buffer.readUInt8(0);
      const _sessionId = this._buffer.readUInt32BE(1);
      const _payloadLength = this._buffer.readUInt32BE(5);
      const _frameLength = HEADER_LENGTH + _payloadLength;

      if (this._buffer.length < _frameLength) {
        return;
      }

      const _payload = this._buffer.subarray(HEADER_LENGTH, _frameLength);
      this._buffer = this._buffer.subarray(_frameLength);

      _onFrame({
        type: _type as FrameType,
        sessionId: _sessionId,
        payload: _payload
      });
    }
  }
}

let _nextSessionId = 1;
const _sessions = new Map<number, net.Socket>();
const _servers: net.Server[] = [];

function __log(_message: string): void {
  process.stderr.write(`[remote-helper] ${_message}\n`);
}

function __sendFrame(_type: FrameType, _sessionId: number, _payload?: Uint8Array): void {
  process.stdout.write(__encodeFrame(_type, _sessionId, _payload));
}

function __handleConnection(_mapping: Mapping, _socket: net.Socket): void {
  const _sessionId = _nextSessionId++;
  let _closed = false;

  _sessions.set(_sessionId, _socket);
  __sendFrame(
    FrameType.Open,
    _sessionId,
    Buffer.from(JSON.stringify({
      name: _mapping.name,
      localHost: _mapping.localHost,
      localPort: _mapping.localPort
    }), 'utf8')
  );

  _socket.on('data', (_chunk) => {
    __sendFrame(FrameType.Data, _sessionId, _chunk);
  });

  _socket.on('error', (_error) => {
    __sendFrame(FrameType.Error, _sessionId, Buffer.from(_error.message, 'utf8'));
  });

  _socket.on('close', () => {
    if (_closed) {
      return;
    }

    _closed = true;
    _sessions.delete(_sessionId);
    __sendFrame(FrameType.Close, _sessionId);
  });
}

function __listenUnixSocket(_mapping: Mapping, _socketPath: string): void {
  fs.mkdirSync(path.dirname(_socketPath), { recursive: true });

  try {
    fs.rmSync(_socketPath, { force: true });
  } catch {
    // Ignore cleanup failures; listen() will report the real error if the path is unusable.
  }

  const _server = net.createServer((_socket) => __handleConnection(_mapping, _socket));
  _server.listen(_socketPath, () => {
    fs.chmodSync(_socketPath, 0o600);
    __log(`${_mapping.name}: listening on unix socket ${_socketPath}`);
  });
  _server.on('error', (_error) => __log(`${_mapping.name}: unix socket error: ${_error.message}`));
  _servers.push(_server);
}

function __listenTcp(_mapping: Mapping, _host: string, _port: number): void {
  const _server = net.createServer((_socket) => __handleConnection(_mapping, _socket));
  _server.listen(_port, _host, () => {
    __log(`${_mapping.name}: listening on tcp ${_host}:${_port}`);
  });
  _server.on('error', (_error) => __log(`${_mapping.name}: tcp error: ${_error.message}`));
  _servers.push(_server);
}

function __handleFrame(_frame: Frame): void {
  const _socket = _sessions.get(_frame.sessionId);

  switch (_frame.type) {
    case FrameType.Data:
      _socket?.write(_frame.payload);
      break;
    case FrameType.Close:
    case FrameType.Error:
      _sessions.delete(_frame.sessionId);
      _socket?.destroy();
      break;
    default:
      __log(`ignoring unknown frame type ${_frame.type}`);
  }
}

function __shutdown(): void {
  for (const _socket of _sessions.values()) {
    _socket.destroy();
  }
  _sessions.clear();

  for (const _server of _servers) {
    _server.close();
  }
}

function __main(): void {
  const _encodedConfig = process.argv[2];
  if (!_encodedConfig) {
    throw new Error('missing base64 config argument');
  }

  const _config = JSON.parse(Buffer.from(_encodedConfig, 'base64').toString('utf8')) as Config;
  for (const _mapping of _config.mappings) {
    if (_mapping.remoteSocket) {
      __listenUnixSocket(_mapping, _mapping.remoteSocket);
    }

    if (_mapping.remotePort) {
      __listenTcp(_mapping, _mapping.remoteHost || '127.0.0.1', _mapping.remotePort);
    }
  }

  const _reader = new FrameReader();
  process.stdin.on('data', (_chunk: Buffer) => {
    _reader.push(_chunk, __handleFrame);
  });
  process.stdin.on('end', () => {
    __shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    __shutdown();
    process.exit(0);
  });
}

__main();
