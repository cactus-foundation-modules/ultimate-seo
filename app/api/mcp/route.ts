import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { agentContentAllowed } from '@/lib/agent-content/visibility'
import { resolveSiteUrl } from '@/lib/seo/site-url'
import { handleMcpRequest } from '@/modules/ultimate-seo/lib/mcp/handler'
import {
  RPC_INVALID_REQUEST,
  RPC_INTERNAL_ERROR,
  RPC_PARSE_ERROR,
  fail,
  isJsonRpcRequest,
  isNotification,
} from '@/modules/ultimate-seo/lib/mcp/protocol'
import { getAiSettings } from '@/modules/ultimate-seo/lib/settings'

// The read-only agent endpoint: MCP over HTTP at /api/m/ultimate-seo/mcp.
//
// Everything it can answer is already public on the site. There is no auth on
// it for that reason, and no tool that writes anything - an agent can read the
// catalogue exactly as a person with a browser can, and do nothing else.
//
// Off unless the owner switches it on: unlike the Markdown twins, every call
// here is a function invocation and a query that would not otherwise happen.
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version',
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  // Streamable HTTP lets a server refuse the SSE half of the transport. This
  // one has nothing to push, so it does.
  return json({ error: 'This endpoint speaks JSON-RPC over POST.' }, 405)
}

export async function POST(request: Request) {
  const settings = await getAiSettings()
  if (!settings.mcp) return json({ error: 'Not found' }, 404)
  if (!await agentContentAllowed()) return json({ error: 'Not found' }, 404)

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json(fail(null, RPC_PARSE_ERROR, 'Could not parse that as JSON'), 400)
  }

  // A client may send several messages at once. Answering them one at a time in
  // order costs nothing and keeps the handler simple.
  const messages = Array.isArray(payload) ? payload : [payload]
  if (messages.length === 0) return json(fail(null, RPC_INVALID_REQUEST, 'Empty batch'), 400)

  const siteUrl = resolveSiteUrl() ?? ''
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { siteName: true } })
    .catch(() => null)
  const ctx = {
    siteName: config?.siteName ?? 'This site',
    siteUrl,
    maxResults: settings.mcpMaxResults,
  }

  const responses = []
  for (const message of messages) {
    if (!isJsonRpcRequest(message)) {
      responses.push(fail(null, RPC_INVALID_REQUEST, 'Not a JSON-RPC 2.0 request'))
      continue
    }
    try {
      const response = await handleMcpRequest(message, ctx)
      // A notification gets no answer, which is the protocol rather than an
      // oversight - see isNotification.
      if (response) responses.push(response)
      else if (!isNotification(message)) {
        responses.push(fail(message.id ?? null, RPC_INTERNAL_ERROR, 'No answer produced'))
      }
    } catch (err) {
      console.error('[ultimate-seo] MCP call failed:', err)
      responses.push(fail(message.id ?? null, RPC_INTERNAL_ERROR, 'Something went wrong answering that'))
    }
  }

  // Every message was a notification: the protocol says answer with no body.
  if (responses.length === 0) return new NextResponse(null, { status: 202, headers: CORS })

  return json(Array.isArray(payload) ? responses : responses[0])
}
