import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: 'DefaultTemplate' }))
vi.mock('@payloadcms/ui', () => ({ Gutter: 'Gutter', useTranslation: vi.fn() }))
vi.mock('@/components/ReportsView/ReportsView', () => ({ ReportsView: 'ReportsView' }))

import type { AdminViewServerProps } from 'payload'

import { ReportsPage } from '@/components/ReportsView'
import { ReportsNavLink } from '@/components/ReportsView/ReportsNavLink'

const props = (roles?: string[]) =>
  ({
    i18n: { language: 'ro', t: (key: string) => key },
    initPageResult: {
      req: { user: roles ? { id: '1', roles } : null },
      permissions: {},
      visibleEntities: { collections: [], globals: [] },
    },
    params: {},
    payload: { config: { routes: { admin: '/', api: '/api' } } },
    searchParams: {},
  }) as unknown as AdminViewServerProps

describe('сторінка /admin/reports: доступ лише admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('admin отримує шаблон зі сторінкою й мовою інтерфейсу', () => {
    const page = ReportsPage(props(['admin'])) as { type: unknown; props: { children: { props: { children: { props: Record<string, unknown> } } } } }

    expect(page.type).toBe('DefaultTemplate')
    expect(page.props.children.props.children.props).toMatchObject({
      language: 'ro',
      adminRoute: '/',
      apiRoute: '/api',
    })
  })

  it.each([['manager'], ['customer'], ['manager', 'customer']])('роль %s отримує notFound()', (...roles) => {
    expect(() => ReportsPage(props(roles))).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/)
  })

  it('без користувача теж notFound()', () => {
    expect(() => ReportsPage(props())).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/)
  })

  it('посилання в меню є лише в admin', () => {
    const nav = (roles?: string[]) =>
      ReportsNavLink({
        i18n: { t: (key: string) => key },
        payload: { config: { routes: { admin: '/' } } },
        user: roles ? { id: '1', roles } : undefined,
      } as never)

    expect(nav(['admin'])).not.toBeNull()
    expect(nav(['manager'])).toBeNull()
    expect(nav(['customer'])).toBeNull()
    expect(nav()).toBeNull()
  })
})
