import type { NestedKeysStripped } from '@payloadcms/translations'

import type { en } from './en'

/** Форма словника: `ru` і `ro` типізовані нею, тож пропущений ключ ловить `tsc`. */
export type CustomTranslationsObject = typeof en

/** Усі ключі словника, напр. `custom:status:draft`. */
export type CustomTranslationsKeys = NestedKeysStripped<CustomTranslationsObject>
