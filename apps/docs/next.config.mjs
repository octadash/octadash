import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  // Plain files, served by nginx (see Dockerfile): no server to keep running.
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@octadash/snippets'],
  // The repository has its own AGENTS.md.
  agentRules: false,
}

export default withMDX(config)
