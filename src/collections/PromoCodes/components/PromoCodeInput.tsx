// components/PromoCodeInput.tsx
'use client';

import React from 'react';
import { useField } from '@payloadcms/ui';
import { generatePromo } from '../services/generatePromo';

export const PromoCodeInput: React.FC<{ path: string }> = ({ path }) => {
  const { value, setValue } = useField<string>({ path });

  const handleGenerate = (e: React.MouseEvent) => {
    e.preventDefault();
    setValue(generatePromo(5));
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <label className="field-label" style={{ display: 'block', marginBottom: '5px' }}>
        Промокод
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          style={{
            flex: 1,
            padding: '10px',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            fontWeight: 'bold',
          }}
        />
        <button
          type="button"
          onClick={handleGenerate}
          className="btn btn--style-secondary btn--size-medium"
        >
          🔄 Generate
        </button>
      </div>
    </div>
  );
};