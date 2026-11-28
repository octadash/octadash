/** Version reported by every process. Set at build time through OCTADASH_VERSION. */
export const OCTADASH_VERSION = process.env.OCTADASH_VERSION ?? '0.0.0-dev'

/** Commit the image was built from; empty outside the published images. */
export const OCTADASH_COMMIT = process.env.OCTADASH_COMMIT ?? ''
