import { PayloadRequest } from 'payload'
import { ProductsByRelationResult } from '@/collections/Products/endpoints/types'
import { pageGenerator, sortGenerator } from './sort-page.service'

type RelationConfig = {
  relationCollection: 'brands' | 'categories'
  relationField: 'brand' | 'categories'
}

type Filter = {
  categories?: false
  brand?: false
}


function emptyResult(
  page: number,
  limit: number,
): ProductsByRelationResult {
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

export async function getProductsByRelation(
  req: PayloadRequest,
  slug: string | undefined,
  config: RelationConfig,
): Promise<ProductsByRelationResult> {
  const page = Number(req.query?.page ?? 1)
  const limit = Number(req.query?.limit ?? 10)

  if (!slug) {
    return emptyResult(page, limit)
  }

  const isWholesaleUser = req.user?.wholesale === true

  const filter: Filter =
    config.relationField === 'brand'
      ? { categories: false }
      : { brand: false }

  const relationRes = await req.payload.find({
    collection: config.relationCollection,
    where: { slug: { equals: slug } },
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

  const firstProduct = productsRes.docs[0]
  const extension: Record<string, unknown> = {}

  // 🟦 Categories extension
  if (config.relationField === 'categories') {
    // @ts-ignore
    const category = firstProduct?.categories?.[0]

    if (category) {
      extension.categories = category.parent
        ? [category.parent, { ...category, parent: undefined }]
        : [category]
    }
  }

  // 🟨 Brand extension
  // @ts-ignore
  if (config.relationField === 'brand' && firstProduct.brand) {
    // @ts-ignore
    const { description, generateSlug, ...safeBrand } = firstProduct.brand
    extension.brand = safeBrand
  }

  // @ts-ignore
  return {
    ...extension,

    products: productsRes.docs.map((product) => {
      const base: any = {
        ...product,
        gallery: Array.isArray(product.gallery)
          ? product.gallery.slice(0, 1)
          : [],
      }

      if (!isWholesaleUser) {
        delete base.wholesalePrice
      }

      if (config.relationField === 'categories') {
        delete base.categories
      }

      if (config.relationField === 'brand') {
        delete base.brand
      }

      return base
    }),

    pagination: {
      page: productsRes?.page || 1,
      limit: productsRes.limit || 10,
      totalPages: productsRes.totalPages,
      totalDocs: productsRes.totalDocs,
      hasNextPage: productsRes.hasNextPage,
      hasPrevPage: productsRes.hasPrevPage,
      nextPage: productsRes?.nextPage as number | null,
      prevPage: productsRes?.prevPage as number | null,
    },
  }
}
