/**
 * Minimal Server-Sent Events hub: analysis progress and folder-watch
 * notifications stream to the UI through per-channel subscriber lists.
 */
import type { FastifyReply } from "fastify";

type Client = { id: number; reply: FastifyReply };

const channels = new Map<string, Client[]>();
let nextId = 1;

export function sseSubscribe(channel: string, reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(": connected\n\n");
  const client: Client = { id: nextId++, reply };
  const list = channels.get(channel) ?? [];
  list.push(client);
  channels.set(channel, list);
  const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);
  reply.raw.on("close", () => {
    clearInterval(ping);
    const arr = channels.get(channel) ?? [];
    channels.set(channel, arr.filter((c) => c.id !== client.id));
  });
}

export function sseEmit(channel: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of channels.get(channel) ?? []) {
    try {
      c.reply.raw.write(payload);
    } catch {
      /* client gone — cleaned up on close */
    }
  }
}
