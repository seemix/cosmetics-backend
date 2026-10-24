import type { Payload, PayloadRequest } from 'payload'

type CollectionSlug = 'orders' | 'carts' | 'promo-codes' | 'users' | 'products' | 'brands'

let counter = 0
const uid = () => `${Date.now()}-${++counter}`

/**
 * Фікстури для інтеграційних тестів. Запам'ятовує створені документи
 * і видаляє лише їх, тому чужі дані в тестовій БД не чіпаються.
 */
export class TestData {
  private created: Array<{ collection: CollectionSlug; id: string }> = []

  constructor(readonly payload: Payload) {}

  private track(collection: CollectionSlug, id: string | number) {
    this.created.push({ collection, id: String(id) })
  }

  async brand(title = `Brand ${uid()}`) {
    const doc = await this.payload.create({
      collection: 'brands',
      data: { title, slug: `brand-${uid()}` },
    })
    this.track('brands', doc.id)
    return doc
  }

  async product(options: {
    brand: string
    retailPrice: number
    wholesalePrice?: number
    subtitle?: string
  }) {
    const doc = await this.payload.create({
      collection: 'products',
      data: {
        title: `Product ${uid()}`,
        slug: `product-${uid()}`,
        subtitle: options.subtitle ?? 'Підзаголовок',
        article: `ART-${uid()}`,
        brand: options.brand,
        retailPrice: options.retailPrice,
        wholesalePrice: options.wholesalePrice,
        _status: 'published',
      },
    })
    this.track('products', doc.id)
    return doc
  }

  async user(
    options: { wholesale?: boolean; brandDiscounts?: Array<{ brand: string; discountPercent: number }> } = {},
  ) {
    const doc = await this.payload.create({
      collection: 'users',
      data: {
        email: `user-${uid()}@example.test`,
        password: 'test-password-123',
        name: 'Test',
        surname: 'User',
        phone: '+37360000000',
        wholesale: options.wholesale ?? false,
        brandDiscounts: options.brandDiscounts,
      },
      disableVerificationEmail: true,
    })
    this.track('users', doc.id)
    return doc
  }

  async promo(
    options: {
      brands?: string[]
      percent?: number
      wholesale?: boolean
      isActive?: boolean
      expirationDate?: string
    } = {},
  ) {
    const doc = await this.payload.create({
      collection: 'promo-codes',
      data: {
        code: `PROMO-${uid()}`,
        'discount %': options.percent ?? 10,
        brands: options.brands,
        wholesale: options.wholesale ?? false,
        isActive: options.isActive ?? true,
        expirationDate: options.expirationDate,
      },
    })
    this.track('promo-codes', doc.id)
    return doc
  }

  async cart(options: {
    customer: string
    items: Array<{ product: string; quantity: number }>
  }) {
    const doc = await this.payload.create({
      collection: 'carts',
      data: { customer: options.customer, currency: 'MDL', items: options.items },
    })
    this.track('carts', doc.id)
    return doc
  }

  /** Реєструє замовлення, створене через ендпоінт, щоб прибрати його після тесту. */
  trackOrder(id: string | number) {
    this.track('orders', id)
  }

  async cleanup() {
    // Видаляємо у зворотному порядку створення: залежні документи першими.
    for (const { collection, id } of this.created.reverse()) {
      try {
        await this.payload.delete({ collection, id })
      } catch {
        // Документ уже видалено або його немає.
      }
    }
    this.created = []
  }
}

/** Мінімальний запит для прямого виклику хендлерів ендпоінтів. */
export function makeRequest(
  payload: Payload,
  options: { user?: unknown; body?: unknown; locale?: string } = {},
): PayloadRequest {
  return {
    payload,
    user: options.user ?? null,
    locale: options.locale ?? 'ru',
    json: async () => options.body,
  } as unknown as PayloadRequest
}
