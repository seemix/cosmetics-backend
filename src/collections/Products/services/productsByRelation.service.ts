import { withPublishedProducts } from '@/access/publishedProducts'
import { PayloadRequest } from 'payload'
import { ProductsByRelationResult } from '@/collections/Products/endpoints/types'
import { sortGenerator } from '@/services/sortPage.service'
import { calculateProductPrice } from '@/services/price.service'
import { canUserReadWholesalePrice } from '@/access/canReadWholesalePrice'

type RelationConfig = {
  relationCollection: 'brands' | 'categories'
  relationField: 'brand' | 'categories'
}

type Filter = {
  categories?: false
  brand?: false
}

/** Id товарів із залишком > 0 на складі сайту; `null`, якщо облік складу ще не ввімкнено. Один запит на сторінку. */
export async function loadInStock(req: PayloadRequest, products: Array<{ id: number | string }>) {
  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  const warehouse = settings.defaultWebWarehouse
  if (!settings.stockControlEnabled || !warehouse || products.length === 0) return null

  const balances = await req.payload.find({
    collection: 'stock-balances',
    where: {
      product: { in: products.map((product) => product.id) },
      warehouse: { equals: typeof warehouse === 'object' ? warehouse.id : warehouse },
      qty: { greater_than: 0 },
    },
    pagination: false,
    depth: 0,
    select: { product: true },
    req,
  })

  return new Set(balances.docs.map((balance) => String(balance.product)))
}

// 1. Експортуємо transformProduct
export function transformProduct(product: any, req: PayloadRequest, inStock: Set<string> | null = null) {
  const transformed: any = {
    ...product,
    gallery: Array.isArray(product.gallery) ? product.gallery : [],
    inStock: inStock ? inStock.has(String(product.id)) : true,
  }

  const { discountPrice } = calculateProductPrice({
    product,
    user: req.user,
  })

  // Приховуємо оптову ціну для тих, кому вона не доступна
  if (!canUserReadWholesalePrice(req.user)) {
    delete transformed.wholesalePrice
  }

  // Додаємо discountPrice, якщо є брендова знижка
  if (discountPrice !== undefined) {
    transformed.discountPrice = discountPrice
  }

  return transformed
}

// 2. Експортуємо formatPaginatedProducts
export async function formatPaginatedProducts(productsRes: any, req: PayloadRequest) {
  const inStock = await loadInStock(req, productsRes.docs)

  return {
    products: productsRes.docs.map((doc: any) => transformProduct(doc, req, inStock)),
    pagination: {
      page: productsRes?.page || 1,
      limit: productsRes.limit || 12,
      totalPages: productsRes.totalPages,
      totalDocs: productsRes.totalDocs,
      hasNextPage: productsRes.hasNextPage,
      hasPrevPage: productsRes.hasPrevPage,
      nextPage: (productsRes?.nextPage as number | null) ?? null,
      prevPage: (productsRes?.prevPage as number | null) ?? null,
    },
  }
}

function emptyResult(page: number, limit: number): ProductsByRelationResult {
  return {
    products: [],
    pagination: {
      page,
      limit,
      totalPages: 0,
      totalDocs: 0,
      hasNextPage: false,
      hasPrevPage: false,
      nextPage: null,
      prevPage: null,
    },
  }
}

// 3. Експортуємо getProductsByRelation
export async function getProductsByRelation(
  req: PayloadRequest,
  slug: string | undefined,
  config: RelationConfig,
): Promise<ProductsByRelationResult> {
  const page = Number(req.query?.page ?? 1)
  const limit = Number(req.query?.limit ?? 12)

  if (!slug) {
    return emptyResult(page, limit)
  }

  const filter: Filter = config.relationField === 'brand' ? { categories: false } : {}

  const relationRes = await req.payload.find({
    collection: config.relationCollection,
    where: { slug: { equals: slug } },
    locale: req.locale,
    limit: 1,
    req,
  })

  const relation = relationRes.docs[0]
  if (!relation) {
    return emptyResult(page, limit)
  }

  // Отримуємо ВСІ товари зв'язку без пагінації (limit: 0),
  // щоб коректно перенести unavailable товари на абсолютно останню сторінку загалом.
  const productsRes = await req.payload.find({
    collection: 'products',
    locale: req.locale,
    sort: sortGenerator(req.query.sort as string),
    draft: false,
    limit: 0,
    depth: 2,
    select: {
      shortDescription: false,
      description: false,
      generateSlug: false,
      _status: false,
      relatedProducts: false,
      inventory: false,
      ...filter,
    },
    where: withPublishedProducts({ [config.relationField]: { equals: relation.id } }, req.user),
    req,
  })

  if (!productsRes.docs.length) {
    return emptyResult(page, limit)
  }

  // Сортуємо ВСІ товари: спочатку доступні, потім unavailable: true (зберігаючи початковий сорт)
  const allDocs = [...productsRes.docs].sort((a: any, b: any) => {
    const aUnavailable = a.unavailable ? 1 : 0
    const bUnavailable = b.unavailable ? 1 : 0
    return aUnavailable - bUnavailable
  })

  const totalDocs = allDocs.length
  const totalPages = Math.ceil(totalDocs / limit)
  const validPage = Math.max(1, Math.min(page, totalPages || 1))

  // Вирізаємо масив документів лише для поточної сторінки
  const startIndex = (validPage - 1) * limit
  const endIndex = startIndex + limit
  const paginatedDocs = allDocs.slice(startIndex, endIndex)

  // Формуємо об'єкт результату для formatPaginatedProducts
  const paginatedResMock = {
    docs: paginatedDocs,
    totalDocs,
    totalPages,
    limit,
    page: validPage,
    hasNextPage: validPage < totalPages,
    hasPrevPage: validPage > 1,
    nextPage: validPage < totalPages ? validPage + 1 : null,
    prevPage: validPage > 1 ? validPage - 1 : null,
  }

  const firstProduct = allDocs[0] as any
  const extension: Record<string, unknown> = {}

  if (config.relationField === 'categories') {
    const category = firstProduct?.categories?.[0]
    if (category) {
      extension.categories = category.parent
        ? [category.parent, { ...category, parent: undefined }]
        : [category]
    }
  }

  if (config.relationField === 'brand' && firstProduct.brand) {
    const { description, generateSlug, ...safeBrand } = firstProduct.brand
    extension.brand = safeBrand
  }

  const paginatedData = await formatPaginatedProducts(paginatedResMock, req)

  if (config.relationField === 'brand') {
    paginatedData.products = paginatedData.products.map((p: any) => {
      delete p.brand
      return p
    })
  }

  return {
    ...extension,
    ...paginatedData,
  }
}