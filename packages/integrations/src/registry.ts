import type { Integration, IntegrationKind } from './types'

export class IntegrationRegistry {
  readonly #byId = new Map<string, Integration>()

  constructor(integrations: Integration[] = []) {
    for (const integration of integrations) this.register(integration)
  }

  register(integration: Integration): this {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(integration.id)) {
      throw new Error(`Integration id must be kebab-case: ${integration.id}`)
    }
    if (this.#byId.has(integration.id)) {
      throw new Error(`Integration already registered: ${integration.id}`)
    }
    this.#byId.set(integration.id, integration)
    return this
  }

  get(id: string): Integration | undefined {
    return this.#byId.get(id)
  }

  list(kind?: IntegrationKind): Integration[] {
    const all = [...this.#byId.values()]
    return kind ? all.filter((i) => i.kind === kind) : all
  }
}
