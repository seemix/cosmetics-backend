import { CollectionAfterReadHook } from 'payload'

export const populateRelatedProducts: CollectionAfterReadHook = async ({
                                                                         doc,
                                                                         req,
                                                                       }) => {
  if (!doc?.relatedProducts?.length) return doc

  const ids = doc.relatedProducts.map((item: any) =>
    typeof item === 'string' ? item : item.id,
  )

  if (!ids.length) return doc

  const related = await req.payload.find({
    collection: 'products',
    where: {
      id: {
        in: ids,
      },
    },
    depth: 2,
    limit: ids.length,
  })

  doc.relatedProducts = related.docs.map(p => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    article: p.article,
    price: p.price,
    promotionalPrice: p.promotionalPrice,
    //gallery: p.gallery?.[0]?.image ?? null,
     gallery: p.gallery,
    subtitle: p.subtitle,
  }))

  return doc
}