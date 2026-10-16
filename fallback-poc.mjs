import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const urls = [
  'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/administering/translation/overview',
  'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/administering/reusing-content/translation/overview',
]
const client = new Client({ name: 'idechat-camofox-fallback-poc', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('mcp/server.mjs')],
  env: { ...process.env, CAMOFOX_BASE_URL: 'http://127.0.0.1:9377' },
})

await client.connect(transport)
try {
  for (const url of urls) {
    let tabId
    try {
      const created = await client.callTool({ name: 'camofox_create_tab', arguments: { url } })
      const createText = created.content.find((item) => item.type === 'text')?.text ?? ''
      const create = JSON.parse(createText)
      tabId = create.tabId ?? create.id
      if (typeof tabId !== 'string') throw new Error(`No tabId: ${createText.slice(0, 300)}`)
      let snapshot
      let snapshotText = ''
      let page
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500))
        snapshot = await client.callTool({ name: 'camofox_snapshot', arguments: { tabId } })
        snapshotText = snapshot.content.find((item) => item.type === 'text')?.text ?? ''
        page = JSON.parse(snapshotText)
        if ((page.snapshot?.length ?? 0) > 1000) break
      }
      console.log(JSON.stringify({ url, createError: created.isError ?? false, snapshotError: snapshot.isError ?? false, renderedUrl: page.url, title: page.title, snapshotLength: page.snapshot?.length ?? 0, head: page.snapshot?.slice(0, 800) ?? snapshotText.slice(0, 800) }))
    } catch (error) {
      console.log(JSON.stringify({ url, error: String(error) }))
    } finally {
      if (tabId) await client.callTool({ name: 'camofox_close_tab', arguments: { tabId } }).catch(() => {})
    }
  }
} finally {
  await client.close()
}
