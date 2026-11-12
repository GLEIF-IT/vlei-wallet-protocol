import { createServer, type Server } from "node:http";
import { MtrDex, Saider, Serials } from "signify-ts";

export interface TestSchemaOptions {
  title?: string;
  credentialType?: string;
  /** Require an issuee (`a.i`): a credential held by an AID, usable for credential sign-in. */
  holder?: boolean;
}

/**
 * A self-made, edge-free ACDC schema served from this machine, so the live test does not depend on
 * which schemas the vlei-server container ships (KERIA 0.2.0-dev4 crashes on an empty OOBI body).
 * KERIA reaches it via `host.docker.internal`.
 */
export function makeTestSchema(options: TestSchemaOptions = {}): { said: string; body: string } {
  const attributes: Record<string, unknown> = {
    d: { type: "string" },
    dt: { type: "string", format: "date-time" },
    filename: { type: "string" },
    content_digest: { type: "string" },
  };
  const required = ["d", "dt", "filename", "content_digest"];
  if (options.holder) {
    attributes.i = { type: "string" };
    required.push("i");
  }
  const schema = {
    $id: "",
    $schema: "http://json-schema.org/draft-07/schema#",
    title: options.title ?? "Protocol Test Credential",
    description: "Credential used by vlei-wallet-protocol live and e2e tests",
    type: "object",
    credentialType: options.credentialType ?? "ProtocolTestCredential",
    version: "1.0.0",
    properties: {
      v: { type: "string" },
      d: { type: "string" },
      u: { type: "string" },
      i: { type: "string" },
      ri: { type: "string" },
      s: { type: "string" },
      a: {
        oneOf: [{ type: "string" }, { type: "object", properties: attributes, required }],
      },
    },
    required: ["v", "d", "i", "ri", "s", "a"],
  };
  const [saider, sad] = Saider.saidify(schema, MtrDex.Blake3_256, Serials.JSON, "$id");
  return { said: saider.qb64, body: JSON.stringify(sad) };
}

export interface SchemaServer {
  port: number;
  close(): Promise<void>;
}

/** Serves each schema at `/oobi/<said>` on a random port, on all interfaces (Docker reaches it). */
export async function serveSchemas(schemas: Record<string, string>): Promise<SchemaServer> {
  const server: Server = createServer((req, res) => {
    const said = req.url?.startsWith("/oobi/") ? req.url.slice("/oobi/".length) : undefined;
    const body = said ? schemas[said] : undefined;
    if (body) {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address() as { port: number };
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export function serveSchema(said: string, body: string): Promise<SchemaServer> {
  return serveSchemas({ [said]: body });
}
