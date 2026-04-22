export type BackgroundRequest = { kind: "ping" };

export type BackgroundResponse = { ok: true; pong: number } | { ok: false; error: string };
