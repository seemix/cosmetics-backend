import { localized } from '@/i18n'

/** Порядок груп бічного меню й дашборда: плагін порівнює за підписом групи, тож задаємо його для кожної мови. */
export const sidebarGroupOrder: Record<string, number> = {}
;(['ecommerce', 'stock', 'purchasing', 'finance', 'users', 'content'] as const).forEach((group, index) => {
  for (const text of Object.values(localized(`custom:group:${group}`))) sidebarGroupOrder[text] = index + 1
})
