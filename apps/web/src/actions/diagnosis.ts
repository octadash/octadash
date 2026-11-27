'use server'

import { requestDiagnosis } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Any member may ask for a fresh diagnosis: it only reads the public site. */
export async function runDiagnosisAction(formData: FormData) {
  const { org } = await requireOrg()
  const projectId = String(formData.get('projectId') ?? '')
  if (!UUID.test(projectId)) return
  await requestDiagnosis(services().db, org.id, projectId, 'manual')
  revalidatePath('/', 'layout')
}
