import type { CollectionBeforeValidateHook } from 'payload';

import { generatePromo } from '../services/generatePromo';

export const generateUniquePromo: CollectionBeforeValidateHook = async ({
                                                                          data,
                                                                          req,
                                                                        }) => {
  if (!data) return data;

  if (data.code) return data;

  let code: string;
  let exists: boolean;

  do {
    code = generatePromo(5);

    const result = await req.payload.find({
      collection: 'promo-codes',
      where: {
        code: {
          equals: code,
        },
      },
      limit: 1,
    });

    exists = result.totalDocs > 0;
  } while (exists);

  data.code = code;

  return data;
};