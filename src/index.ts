import { WorkerEntrypoint } from "cloudflare:workers";
import { RPCEmailMessage } from "./rpcEmail";

import indexHtml from "./index.html";

interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  FrontEndAdminID: string;
  FrontEndAdminPassword: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMailBodies(rawEmail: string): { textBody: string | null; htmlBody: string | null } {
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = rawEmail.split(new RegExp(`--${escapedBoundary}(?:--)?\\r?\\n?`));

    let textBody: string | null = null;
    let htmlBody: string | null = null;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "--") continue;

      const headerBodyMatch = trimmed.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
      if (!headerBodyMatch) continue;

      const headers = headerBodyMatch[1];
      const body = headerBodyMatch[2].trim();
      if (!body) continue;

      const contentType = headers.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const encoding = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";

      let decoded = body;
      if (encoding === "base64") {
        try {
          decoded = atob(body.replace(/\s/g, ""));
        } catch {
          decoded = body;
        }
      } else if (encoding === "quoted-printable") {
        decoded = decodeQuotedPrintable(body);
      }

      if (contentType.includes("text/html") && !htmlBody) {
        htmlBody = decoded.trim();
      } else if (contentType.includes("text/plain") && !textBody) {
        textBody = decoded.trim();
      }
    }

    if (htmlBody || textBody) {
      if (!textBody && htmlBody) textBody = stripHtmlTags(htmlBody);
      return { textBody, htmlBody };
    }
  }

  const htmlMatch = rawEmail.match(/<html[\s\S]*<\/html>/i) ?? rawEmail.match(/<body[\s\S]*<\/body>/i);
  const htmlBody = htmlMatch ? decodeQuotedPrintable(htmlMatch[0]).trim() : null;

  const splitParts = rawEmail.split(/\r?\n\r?\n/);
  const bodyText = splitParts.length > 1 ? splitParts.slice(1).join("\n\n") : rawEmail;
  const decodedText = decodeQuotedPrintable(bodyText).trim();
  const textBody = decodedText ? decodedText : htmlBody ? stripHtmlTags(htmlBody) : null;

  return { textBody, htmlBody };
}

export default class extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const env: Env = this.env;
    const authHeader = request.headers.get("Authorization");

    if (!authHeader?.startsWith("Basic ")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": "Basic realm=\"User Visible Realm\"",
        },
      });
    }

    const base64Credentials = authHeader.substring("Basic ".length);
    const decodedCredentials = atob(base64Credentials);
    const [username, password] = decodedCredentials.split(":");

    if (username !== env.FrontEndAdminID || password !== env.FrontEndAdminPassword) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": "Basic realm=\"User Visible Realm\"",
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/mails" && request.method === "GET") {
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
      const offset = (page - 1) * pageSize;
      const { results } = await env.DB.prepare(
        `
          SELECT
            id,
            message_id AS messageId,
            NULL AS fromOrg,
            from_addr AS fromAddr,
            to_addr AS toAddr,
            subject AS topic,
            NULL AS code,
            created_at AS createdAt,
            subject
          FROM raw_mails
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
      )
        .bind(pageSize, offset)
        .all();

      const totalResult = await env.DB.prepare("SELECT COUNT(*) AS total FROM raw_mails").first<{ total: number }>();
      return jsonResponse({
        page,
        pageSize,
        total: Number(totalResult?.total ?? 0),
        items: results ?? [],
      });
    }

    const mailDetailMatch = url.pathname.match(/^\/api\/mails\/(\d+)$/);
    if (mailDetailMatch && request.method === "GET") {
      const mailId = Number.parseInt(mailDetailMatch[1], 10);
      const row = await env.DB.prepare(
        `
          SELECT
            id,
            message_id AS messageId,
            NULL AS fromOrg,
            from_addr AS fromAddr,
            to_addr AS toAddr,
            subject AS topic,
            NULL AS code,
            created_at AS createdAt,
            subject,
            raw
          FROM raw_mails
          WHERE id = ?
          LIMIT 1
        `
      )
        .bind(mailId)
        .first<any>();

      if (!row) {
        return jsonResponse({ error: "Mail not found" }, 404);
      }

      const { textBody, htmlBody } = extractMailBodies(String(row.raw ?? ""));
      return jsonResponse({
        id: row.id,
        messageId: row.messageId,
        fromOrg: row.fromOrg,
        fromAddr: row.fromAddr,
        toAddr: row.toAddr,
        topic: row.topic,
        code: row.code,
        createdAt: row.createdAt,
        subject: row.subject ?? null,
        raw: row.raw ?? null,
        textBody,
        htmlBody,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const indexRequest = new Request(new URL("/index.html", request.url).toString(), request);
        const indexResponse = await env.ASSETS.fetch(indexRequest);
        if (indexResponse.status !== 404) {
          return indexResponse;
        }
      }
    }

    try {
      const { results } = await env.DB.prepare(
        "SELECT from_addr, to_addr, subject, created_at FROM raw_mails ORDER BY created_at DESC"
      ).all();

      let dataHtml = "";
      for (const row of results) {
        dataHtml += `<tr>
                    <td>${row.from_addr ?? ""}</td>
                    <td>${row.to_addr ?? ""}</td>
                    <td>${row.subject ?? ""}</td>
                    <td>${row.created_at ?? ""}</td>
                </tr>`;
      }

      const responseHtml = indexHtml
        .replace(
          "{{TABLE_HEADERS}}",
          `
                    <tr>
                        <th>From</th>
                        <th>To</th>
                        <th>Subject</th>
                        <th>Receive Time (GMT)</th>
                    </tr>
                `
        )
        .replace("{{DATA}}", dataHtml);

      return new Response(responseHtml, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    } catch (error) {
      console.error("Error querying database:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  async email(message: ForwardableEmailMessage): Promise<void> {
    const env: Env = this.env;
    const rawEmail =
      message instanceof RPCEmailMessage
        ? (message as RPCEmailMessage).rawEmail
        : await new Response(message.raw).text();
    const messageId = message.headers.get("Message-ID") ?? crypto.randomUUID();
    const rawSubject = message.headers.get("Subject");

    const { success } = await env.DB.prepare(
      "INSERT INTO raw_mails (from_addr, to_addr, subject, raw, message_id) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(message.from, message.to, rawSubject, rawEmail, messageId)
      .run();

    if (!success) {
      message.setReject(`Failed to save message from ${message.from} to ${message.to}`);
      console.log(`Failed to save message from ${message.from} to ${message.to}`);
      return;
    }

    console.log(`Saved raw email from ${message.from} to ${message.to}: ${rawSubject}`);
  }

  async rpcEmail(requestBody: string): Promise<void> {
    const bodyObject = JSON.parse(requestBody);
    const headersObject = bodyObject.headers;
    const headers = new Headers(headersObject);
    const rpcEmailMessage: RPCEmailMessage = new RPCEmailMessage(
      bodyObject.from,
      bodyObject.to,
      bodyObject.rawEmail,
      headers
    );
    await this.email(rpcEmailMessage);
  }
}
