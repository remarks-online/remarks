import type { InngestEvents } from "@remarks/shared";
import { EventSchemas, Inngest } from "inngest";
import { env } from "../env.js";

// Singleton client. The Inngest dashboard surfaces this app under id
// "remarks-api"; the dev CLI also uses it. Event types come from
// @remarks/shared so that any future MCP/API consumer publishes the same
// shape.
export const inngest = new Inngest({
  id: "remarks-api",
  eventKey: env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<InngestEvents>(),
});

export type AppInngest = typeof inngest;
