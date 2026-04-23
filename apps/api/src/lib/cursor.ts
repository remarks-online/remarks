import { ValidationError } from "@remarks/shared";
import { z } from "zod";

export interface AnnotationListCursor {
  createdAt: string;
  id: string;
}

// Short keys keep encoded cursors compact on the wire.
const cursorPayloadSchema = z.object({
  c: z.string().datetime(),
  i: z.string().uuid(),
});

export function encodeAnnotationListCursor(cursor: AnnotationListCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id })).toString("base64url");
}

export function decodeAnnotationListCursor(raw: string): AnnotationListCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError("Invalid cursor");
  }
  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError("Invalid cursor", result.error.issues);
  }
  return { createdAt: result.data.c, id: result.data.i };
}
