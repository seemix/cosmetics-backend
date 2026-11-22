/**
 * Мінімальні тестові дані: 3 бренди, 4 категорії, 6 опублікованих товарів (з nextlevelshop.md).
 *
 * Запуск (з кореня проєкту, потрібен `.env` з DATABASE_URI):
 *   npx tsx scripts/seed-test-data.ts
 *
 * Повторний запуск безпечний: бренд шукається за назвою, категорія за назвою, товар за артикулом,
 * наявні записи не змінюються. Картинки завантажуються з сайту; якщо картинка недоступна,
 * товар створюється чернеткою (галерея обов'язкова лише для публікації).
 * DeepL-переклад вимкнено на час сідування, щоб не витрачати ліміт ключа на тестові дані.
 */
import type { Payload } from 'payload'

const IMG = 'https://admin.nextlevelshop.md/api/media/file/'

const brands = [
  { title: 'Xflex', slug: 'xflex', logo: '94.jpg' },
  { title: 'Uppercut Deluxe', slug: 'uppercut-deluxe', logo: 'uppercut-logo.webp' },
  { title: 'Luxina', slug: 'luxina', logo: 'luxina-fixed.webp' },
]

const categories = [
  { title: 'Шампуни', slug: 'shampoos' },
  { title: 'Уход за бородой', slug: 'beard-care' },
  { title: 'Средства для укладки', slug: 'styling' },
  { title: 'После бритья', slug: 'aftershave' },
]

const products = [
  {
    title: 'XFLEX BEARD SHAMPOO',
    subtitle: 'Шампунь для бороды 250 ml',
    article: '2274',
    brand: 'Xflex',
    category: 'Уход за бородой',
    retailPrice: 410,
    image: '43.webp',
    shortDescription:
      'Шампунь на основе натуральных ингредиентов для ухода за бородой: очищает, питает и смягчает, не пересушивая кожу лица.',
  },
  {
    title: 'XFLEX AFTERSHAVE SENSETIVE SKIN',
    subtitle: 'Бальзам после бритья для чувствительной кожи 200 ml',
    article: '2278',
    brand: 'Xflex',
    category: 'После бритья',
    retailPrice: 321,
    image: '44.webp',
    shortDescription:
      'Бальзам освежает и восстанавливает кожу после бритья, помогает снять воспаление и успокоить чувствительную кожу.',
  },
  {
    title: 'UPPERCUT MATTE POMADE',
    subtitle: 'Матовая помада 100 g',
    article: '3106',
    brand: 'Uppercut Deluxe',
    category: 'Средства для укладки',
    retailPrice: 400,
    image: 'MP-F-preview.webp',
    shortDescription:
      'Помада с кремовой текстурой, застывает в матовый финиш средней фиксации. Подходит для классических и современных укладок.',
  },
  {
    title: 'UPPERCUT CLAY SPRAY',
    subtitle: 'Жидкая глина 150 ml',
    article: '3114',
    brand: 'Uppercut Deluxe',
    category: 'Средства для укладки',
    retailPrice: 370,
    image: 'CS-P1-preview.webp',
    shortDescription: 'Жидкая глина-спрей для объёма, плотности и фиксации, в том числе для тонких волос.',
  },
  {
    title: 'LUXINA SILVER SHAMPOO',
    subtitle: 'Шампунь против желтизны 400 ml',
    article: '1029',
    brand: 'Luxina',
    category: 'Шампуни',
    retailPrice: 370,
    image: '1999.webp',
    shortDescription:
      'Шампунь для светлых, осветлённых и седых волос: нейтрализует желтизну и сохраняет холодный оттенок.',
  },
  {
    title: 'LUXINA BEARD OIL',
    subtitle: 'Масло для бороды 30 ml',
    article: '1017',
    brand: 'Luxina',
    category: 'Уход за бородой',
    retailPrice: 365,
    image: '15.webp',
    shortDescription: 'Масло с витамином Е, абрикосовым маслом и жожоба: увлажняет бороду и кожу, придаёт блеск.',
  },
]

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** Завантажує картинку в `media`; повертає id або null, якщо файл недоступний. */
const uploadImage = async (payload: Payload, name: string, alt: string): Promise<string | null> => {
  const existing = await payload.find({ collection: 'media', where: { filename: { equals: name } }, limit: 1, depth: 0 })
  if (existing.docs[0]) return String(existing.docs[0].id)

  try {
    const response = await fetch(IMG + encodeURIComponent(name))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    const ext = name.split('.').pop()!.toLowerCase()
    const doc = await payload.create({
      collection: 'media',
      data: { alt },
      file: { data, name, mimetype: MIME[ext] ?? 'image/jpeg', size: data.length },
    })
    return String(doc.id)
  } catch (error) {
    payload.logger.warn(`Image ${name} skipped: ${(error as Error).message}`)
    return null
  }
}

const findOrCreate = async (
  payload: Payload,
  collection: 'brands' | 'categories',
  title: string,
  create: () => Promise<{ id: string | number }>,
): Promise<string> => {
  const { docs } = await payload.find({ collection, where: { title: { equals: title } }, limit: 1, depth: 0 })
  if (docs[0]) return String(docs[0].id)
  return String((await create()).id)
}

export const seedTestData = async (payload: Payload) => {
  const brandIds = new Map<string, string>()
  for (const brand of brands) {
    const id = await findOrCreate(payload, 'brands', brand.title, async () => {
      const logo = await uploadImage(payload, brand.logo, brand.title)
      return payload.create({ collection: 'brands', data: { title: brand.title, slug: brand.slug, ...(logo ? { logo } : {}) } })
    })
    brandIds.set(brand.title, id)
  }

  const categoryIds = new Map<string, string>()
  for (const { title, slug } of categories) {
    const id = await findOrCreate(payload, 'categories', title, () =>
      payload.create({ collection: 'categories', locale: 'ru', data: { title, slug } }),
    )
    categoryIds.set(title, id)
  }

  let created = 0
  const productIds = new Map<string, string>()
  for (const product of products) {
    const { docs } = await payload.find({
      collection: 'products',
      where: { article: { equals: product.article } },
      limit: 1,
      depth: 0,
      draft: true,
    })
    if (docs[0]) {
      productIds.set(product.article, String(docs[0].id))
      continue
    }

    const image = await uploadImage(payload, product.image, product.title)
    const doc = await payload.create({
      collection: 'products',
      locale: 'ru',
      draft: !image,
      data: {
        title: product.title,
        subtitle: product.subtitle,
        article: product.article,
        brand: brandIds.get(product.brand)!,
        categories: [categoryIds.get(product.category)!],
        retailPrice: product.retailPrice,
        shortDescription: product.shortDescription,
        gallery: image ? [{ image }] : [],
        _status: image ? 'published' : 'draft',
      } as never,
    })
    productIds.set(product.article, String(doc.id))
    created++
  }

  const openings = await seedOpeningStock(payload, productIds)

  return { brands: brandIds.size, categories: categoryIds.size, productsCreated: created, openings }
}

const OPENING_COMMENT = 'seed: test data'

/** Кількість на склад за кодом складу; собівартість одиниці ≈ 60% роздрібної ціни. */
const openingQty: Record<string, Record<string, number>> = {
  main: { '2274': 20, '2278': 15, '3106': 24, '3114': 12, '1029': 10, '1017': 18 },
  shop: { '2274': 4, '2278': 3, '3106': 6, '3114': 3, '1029': 2, '1017': 5 },
}

/**
 * Початкові залишки: по одному проведеному документу `opening-balances` (kind=stock) на склад.
 * Склад пропускається, якщо на ньому вже є непосторнований сид-документ.
 * Проведення робить перший admin: ті самі хуки й перевірки, що й в адмінці.
 */
const seedOpeningStock = async (payload: Payload, productIds: Map<string, string>): Promise<string[]> => {
  const { docs: admins } = await payload.find({
    collection: 'users',
    where: { roles: { contains: 'admin' } },
    limit: 1,
    depth: 0,
  })
  const admin = admins[0]
  if (!admin) throw new Error('No admin user found: opening stock is posted on behalf of an admin')
  const asAdmin = { user: { ...admin, collection: 'users' } as never, overrideAccess: false }

  const posted: string[] = []
  for (const [code, quantities] of Object.entries(openingQty)) {
    const { docs: warehouses } = await payload.find({
      collection: 'warehouses',
      where: { code: { equals: code } },
      limit: 1,
      depth: 0,
    })
    const warehouse = warehouses[0]
    if (!warehouse) {
      payload.logger.warn(`Warehouse ${code} not found, opening stock skipped`)
      continue
    }

    const { totalDocs } = await payload.count({
      collection: 'opening-balances',
      where: {
        kind: { equals: 'stock' },
        warehouse: { equals: warehouse.id },
        comment: { equals: OPENING_COMMENT },
        status: { not_equals: 'reversed' },
      },
    })
    if (totalDocs > 0) continue

    const stockLines = products.map((product) => ({
      product: productIds.get(product.article)!,
      quantity: quantities[product.article]!,
      unitCostBani: Math.round(product.retailPrice * 0.6) * 100,
    }))

    const draft = await payload.create({
      collection: 'opening-balances',
      data: {
        status: 'draft',
        kind: 'stock',
        documentDate: new Date().toISOString(),
        warehouse: warehouse.id,
        stockLines,
        comment: OPENING_COMMENT,
      } as never,
      ...asAdmin,
    })
    const doc = await payload.update({
      collection: 'opening-balances',
      id: draft.id,
      data: { status: 'posted' } as never,
      ...asAdmin,
    })
    posted.push(`${doc.number} (${code})`)
  }

  return posted
}

const main = async () => {
  const { loadEnv } = await import('payload/node')
  loadEnv()
  delete process.env.DEEPL_KEY

  const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../src/payload.config')])
  const payload = await getPayload({ config })
  const result = await seedTestData(payload)
  console.log(
    `Seed done: ${result.brands} brands, ${result.categories} categories, ${result.productsCreated} new products.`,
  )
  console.log(
    result.openings.length > 0
      ? `Opening stock posted: ${result.openings.join(', ')}`
      : 'Opening stock: nothing new to post.',
  )
  process.exit(0)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
