import { router } from './detailed-statuses'
// @ts-expect-error the module does not exist
import { missing } from './missing-procedure'

export const unresolved = { missing, ok: router.sections }
