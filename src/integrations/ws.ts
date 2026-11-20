import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsConnection {
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return null;
  }
  const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const handlers: Array<(text: string) => void> = [];
  let closeHandler: (() => void) | null = null;
  let buffer = Buffer.alloc(0);

  const send = (text: string): void => {
    const payload = Buffer.from(text, "utf8");
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65_536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (buffer.length < 2) return;
      const first = buffer[0] ?? 0;
      const second = buffer[1] ?? 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const data = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (mask) {
        for (let index = 0; index < data.length; index += 1) {
          data[index] = (data[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      buffer = buffer.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        socket.end();
        closeHandler?.();
        return;
      }
      if (opcode === 0x1) {
        const text = data.toString("utf8");
        for (const handler of handlers) handler(text);
      }
    }
  });
  socket.on("close", () => closeHandler?.());
  socket.on("error", () => closeHandler?.());

  return {
    send,
    onMessage(handler) {
      handlers.push(handler);
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      socket.end();
    },
  };
}
