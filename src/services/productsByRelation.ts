import { PayloadRequest } from 'payload'

type RelationConfig = {
  relationCollection: 'brands' | 'categories'
  relationField: 'brand' | 'categories'
}

type Filter = {
  categories?: false
  brand?: false
}

export async function getProductsByRelation(
  req: PayloadRequest,
  slug: string | undefined,
  config: RelationConfig,
) {
  if (!slug) return []
  const page = Number(req.query?.page ?? 1)
  const limit = Number(req.query?.limit ?? 10)

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

  const relationId = relationRes.docs[0]?.id
  if (!relationId) return []

  const productsRes = await req.payload.find({
    collection: 'products',
    locale: req.locale,
    draft: false,
    page,
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
      [config.relationField]: { equals: relationId },
    },
  })

  if (!productsRes.docs.length) {
    return { products: [] }
  }

  const firstProduct = productsRes.docs[0]
  const extension: Record<string, unknown> = {}

  // 🟦 Categories extension
  if (config.relationField === 'categories') {
    const category = firstProduct.categories?.[0]

    if (category) {
      extension.categories = category.parent
        ? [category.parent, { ...category, parent: undefined }]
        : [category]
    }
  }

  // 🟨 Brand extension
  if (config.relationField === 'brand' && firstProduct.brand) {
    const { description, generateSlug, ...safeBrand } = firstProduct.brand
    extension.brand = safeBrand
  }


  return {
    ...extension,

    products: productsRes.docs.map((product) => {
      const base = {
        ...product,
        gallery: Array.isArray(product.gallery)
          ? product.gallery.slice(0, 1)
          : [],
      }

      if (!isWholesaleUser) {
        delete (base as any).wholesalePrice
      }

      if (config.relationField === 'categories') {
        const { categories, ...rest } = base
        return rest
      }

      if (config.relationField === 'brand') {
        const { brand, ...rest } = base
        return rest
      }

      return base
    }),

    pagination: {
      page: productsRes.page,
      limit: productsRes.limit,
      totalPages: productsRes.totalPages,
      totalDocs: productsRes.totalDocs,
      hasNextPage: productsRes.hasNextPage,
      hasPrevPage: productsRes.hasPrevPage,
      nextPage: productsRes.nextPage,
      prevPage: productsRes.prevPage,
    },
  }
}
