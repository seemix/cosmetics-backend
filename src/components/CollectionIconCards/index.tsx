import { getTranslation } from '@payloadcms/translations'
import { Button, Card } from '@payloadcms/ui'
import { getNavGroups, getVisibleEntities } from '@payloadcms/ui/shared'
import { EntityType, getAccessResults, type WidgetServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { DynamicIcon } from 'payload-sidebar-plugin/components'

import { sidebarGroupOrder } from '@/utilities/sidebarGroupOrder'
import { SIDEBAR_ICONS } from '@/utilities/sidebarIcons'

const CARD_GAP = 12
/** Ширина картки як у стандартній сітці з 5 колонок; решта переноситься на наступний рядок. */
const CARD_WIDTH = `calc((100% - ${CARD_GAP * 4}px) / 5)`

/**
 * Віджет дашборда «Колекції»: те саме, що стандартний `collections`, але з іконкою перед назвою
 * (ті самі іконки, що в бічному меню) і групами в порядку бічного меню.
 */
export const CollectionIconCards = async ({ req }: WidgetServerProps) => {
  const { i18n, payload } = req
  const { t } = i18n
  const adminRoute = payload.config.routes.admin

  const permissions = await getAccessResults({ req })
  const visibleEntities = getVisibleEntities({ req })
  const navGroups = getNavGroups(permissions, visibleEntities, payload.config, i18n).sort(
    (a, b) => (sidebarGroupOrder[String(a.label)] ?? 50) - (sidebarGroupOrder[String(b.label)] ?? 50),
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--base) * 1.5)', width: '100%' }}>
      {navGroups.map(({ entities, label }) => (
        <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--base)' }}>
          <h2 style={{ margin: 0 }}>{label}</h2>
          <ul style={{ display: 'flex', flexWrap: 'wrap', gap: CARD_GAP, margin: 0, padding: 0, listStyle: 'none' }}>
            {entities.map(({ slug, type, label: entityLabel }) => {
              const isCollection = type === EntityType.collection
              const title = getTranslation(entityLabel, i18n)
              const href = formatAdminURL({ adminRoute, path: `/${isCollection ? 'collections' : 'globals'}/${slug}` })
              const canCreate = isCollection && permissions?.collections?.[slug]?.create

              return (
                <li key={slug} style={{ flex: 'none', width: CARD_WIDTH, minWidth: 180, listStyle: 'none' }}>
                  <Card
                    actions={
                      canCreate ? (
                        <Button
                          aria-label={t('general:createNewLabel', { label: title })}
                          buttonStyle="icon-label"
                          el="link"
                          icon="plus"
                          iconStyle="with-border"
                          round
                          to={formatAdminURL({ adminRoute, path: `/collections/${slug}/create` })}
                        />
                      ) : undefined
                    }
                    buttonAriaLabel={t(isCollection ? 'general:showAllLabel' : 'general:editLabel', { label: title })}
                    href={href}
                    id={`card-${slug}`}
                    title={
                      (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                          <DynamicIcon name={SIDEBAR_ICONS[slug] ?? 'file'} size={20} style={{ flex: 'none', opacity: 0.7 }} />
                          {title}
                        </span>
                      ) as unknown as string
                    }
                    titleAs="h3"
                  />
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
