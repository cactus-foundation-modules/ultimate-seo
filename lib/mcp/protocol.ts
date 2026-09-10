// The JSON-RPC half of the agent endpoint, with no database in it.
//
// MCP is JSON-RPC 2.0 over HTTP: a client sends one request object, the server
// answers with one response object, and a message with no `id` is a
// notification that gets no answer at all. Everything shape-related lives here
// so the handler below it only has to know about content.

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// The codes JSON-RPC reserves. Anything application-level uses -32000.
export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

/** The MCP revision this server speaks unless the client asks for another. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return v.jsonrpc === '2.0' && typeof v.method === 'string'
}

/** True for a message that expects no answer. */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined || request.id === null
}

export function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/** An MCP tool result: always text, because everything here is Markdown. */
export function textResult(text: string, isError = false): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

export function stringParam(params: Record<string, unknown> | undefined, name: string): string {
  const value = params?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function numberParam(params: Record<string, unknown> | undefined, name: string, fallback: number, max: number): number {
  const value = params?.[name]
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(1, Math.floor(n)))
}
