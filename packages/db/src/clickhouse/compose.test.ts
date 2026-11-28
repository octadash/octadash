import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

/** The file Coolify writes from the `content:` block that mounts at `target`. */
function inline(coolify: string, target: string) {
  const at = coolify.indexOf(`target: ${target}`)
  const block = /content: \|\n((?: {10}.*\n|\n)+)/.exec(coolify.slice(at))?.[1] ?? ''
  return block
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
    .trimEnd()
}

describe('bundled ClickHouse and Garage config', () => {
  it('is the same in docker/ and in the Coolify compose', () => {
    const coolify = read('docker-compose.coolify.yml')
    expect(inline(coolify, '/etc/clickhouse-server/config.d/octadash.xml')).toBe(
      read('docker/clickhouse/octadash.xml').trimEnd(),
    )
    expect(inline(coolify, '/etc/garage.toml')).toBe(read('docker/garage/garage.toml').trimEnd())
  })

  it('pins the same images in both compose files', () => {
    const images = (text: string) =>
      [...text.matchAll(/image: ((?:clickhouse|valkey|postgres|dxflrs)[^\s]*)/g)]
        .map((m) => m[1])
        .sort()
    expect(images(read('docker-compose.coolify.yml'))).toEqual(images(read('docker-compose.yml')))
  })
})
