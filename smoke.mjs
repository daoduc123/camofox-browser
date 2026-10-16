import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const client = new Client({ name: 'idechat-camofox-smoke', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('mcp/server.mjs')],
  env: { ...process.env, CAMOFOX_BASE_URL: 'http://127.0.0.1:9377' },
})
let tabId
try {
  await client.connect(transport)
  const tools = await client.listTools()
  console.log(JSON.stringify({ toolCount: tools.tools.length, tools: tools.tools.map((tool) => tool.name) }))
  const created = await client.callTool({ name: 'camofox_create_tab', arguments: { url: 'https://www.google.com' } })
  console.log(JSON.stringify({ create: created.content }).slice(0, 1000))
  const text = created.content.find((item) => item.type === 'text')?.text ?? ''
  const parsed = JSON.parse(text)
  tabId = parsed.tabId ?? parsed.id
  if (typeof tabId !== 'string') throw new Error('Missing tabId')
  const result = await client.callTool({
    name: 'camofox_navigate',
    arguments: { tabId, macro: '@google_search', query: 'site:experienceleague.adobe.com AEM 6.5 GraphQL persisted queries' },
  })
  console.log(JSON.stringify({ search: result.content }).slice(0, 5000))
  const snapshot = await client.callTool({ name: 'camofox_snapshot', arguments: { tabId } })
  console.log(JSON.stringify({ snapshot: snapshot.content }).slice(0, 6500))
} finally {
  if (tabId) await client.callTool({ name: 'camofox_close_tab', arguments: { tabId } }).catch(() => {})
  await client.close()
}
