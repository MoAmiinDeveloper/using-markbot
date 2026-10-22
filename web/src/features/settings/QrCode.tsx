import { useMemo } from 'react'
import { encode } from 'uqr'

/** Crisp SVG QR code (always dark-on-white so phone cameras read it in either theme). */
export function QrCode({ value, size = 176, className }: { value: string; size?: number; className?: string }) {
  const { path, n } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, n: qr.size }
  }, [value])
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
      className={className}
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#0b0e15" />
    </svg>
  )
}
