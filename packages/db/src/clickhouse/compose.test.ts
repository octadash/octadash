import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

describe('bundled ClickHouse config', () => {
  it('is the same in docker/clickhouse/octadash.xml and in the Coolify compose', () => {
    const file = read('docker/clickhouse/octadash.xml').trimEnd()
    const coolify = read('docker-compose.coolify.yml')
    const block = /content: \|\n((?: {10}.*\n|\n)+)/.exec(coolify)?.[1] ?? ''
    const inline = block
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n')
      .trimEnd()
    expect(inline).toBe(file)
  })

  it('pins the same images in both compose files', () => {
    const images = (text: string) =>
      [...text.matchAll(/image: ((?:clickhouse|valkey|postgres)[^\s]*)/g)].map((m) => m[1]).sort()
    expect(images(read('docker-compose.coolify.yml'))).toEqual(images(read('docker-compose.yml')))
  })
})
