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
  { title: 'Xflex', logo: '94.jpg' },
  { title: 'Uppercut Deluxe', logo: 'uppercut-logo.webp' },
  { title: 'Luxina', logo: 'luxina-fixed.webp' },
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
      return payload.create({ collection: 'brands', data: { title: brand.title, ...(logo ? { logo } : {}) } })
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
  for (const product of products) {
    const { docs } = await payload.find({
      collection: 'products',
      where: { article: { equals: product.article } },
      limit: 1,
      depth: 0,
      draft: true,
    })
    if (docs[0]) continue

    const image = await uploadImage(payload, product.image, product.title)
    await payload.create({
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
    created++
  }

  return { brands: brandIds.size, categories: categoryIds.size, productsCreated: created }
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
  process.exit(0)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
