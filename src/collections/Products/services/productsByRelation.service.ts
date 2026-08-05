import { PayloadRequest } from 'payload'
import { ProductsByRelationResult } from '@/collections/Products/endpoints/types'
import { pageGenerator, sortGenerator } from '@/services/sortPage.service'
import { calculateProductPrice } from '@/services/price.service'

type RelationConfig = {
  relationCollection: 'brands' | 'categories'
  relationField: 'brand' | 'categories'
}

type Filter = {
  categories?: false
  brand?: false
}

// 1. Експортуємо transformProduct
export function transformProduct(product: any, req: PayloadRequest) {
  const transformed: any = {
    ...product,
    gallery: Array.isArray(product.gallery) ? product.gallery.slice(0, 1) : [],
  }

  const { isWholesale, discountPrice } = calculateProductPrice({
    product,
    user: req.user,
  })

  // Приховуємо оптову ціну для роздрібних користувачів
  if (!isWholesale) {
    delete transformed.wholesalePrice
  }

  // Додаємо discountPrice, якщо є брендова знижка
  if (discountPrice !== undefined) {
    transformed.discountPrice = discountPrice
  }

  return transformed
}

// 2. Експортуємо formatPaginatedProducts
export function formatPaginatedProducts(productsRes: any, req: PayloadRequest) {
  return {
    products: productsRes.docs.map((doc: any) => transformProduct(doc, req)),
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
  })

  const relation = relationRes.docs[0]
  if (!relation) {
    return emptyResult(page, limit)
  }

  const productsRes = await req.payload.find({
    collection: 'products',
    locale: req.locale,
    sort: sortGenerator(req.query.sort as string),
    page: pageGenerator(req.query.page as string),
    draft: false,
    limit,
    depth: 2,
    select: {
      shortDescription: false,
      description: false,
      generateSlug: false,
      _status: false,
      relatedProducts: false,
      ...filter,
    },
    where: {
      [config.relationField]: { equals: relation.id },
    },
  })

  if (!productsRes.docs.length) {
    return emptyResult(page, limit)
  }

  const firstProduct = productsRes.docs[0] as any
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

  const paginatedData = formatPaginatedProducts(productsRes, req)

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