import { useState } from 'react';
import { Package } from 'lucide-react';

interface ProductImageProps {
  src?: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<ProductImageProps['size']>, string> = {
  sm: 'h-11 w-11 rounded-md',
  md: 'h-28 w-28 rounded-lg',
  lg: 'h-44 w-44 rounded-lg',
};

const ICON_CLASSES: Record<NonNullable<ProductImageProps['size']>, string> = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

/**
 * Displays a consistent aspect-square product image with object-fit: cover,
 * falling back to a clean placeholder if no image is uploaded or loading fails.
 */
export function ProductImage({
  src,
  alt,
  size = 'sm',
  className = '',
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div
      className={`aspect-square shrink-0 overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center ${SIZE_CLASSES[size]} ${className}`}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          onError={() => setFailedSrc(src ?? null)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-slate-400 select-none">
          <Package className={ICON_CLASSES[size]} />
          {size !== 'sm' && (
            <span className="mt-1 text-[10px] font-medium text-slate-400">
              No image
            </span>
          )}
        </div>
      )}
    </div>
  );
}

