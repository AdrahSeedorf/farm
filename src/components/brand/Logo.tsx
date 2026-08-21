interface LogoProps {
  /** `full` includes the wordmark; `mark` is the egg alone, for tight spaces. */
  variant?: 'full' | 'mark';
  /** `reversed` for use on deep green or dark photography. */
  tone?: 'default' | 'reversed';
  className?: string;
  height?: number;
}

/**
 * The ADRAH Farms mark: a hen's head resolved inside an egg form.
 *
 * Built from circles and straight edges only, so it survives being stamped on a
 * crate, embroidered on a shirt, or rendered 20 pixels wide in a browser tab.
 */
export function Logo({ variant = 'full', tone = 'default', className, height }: LogoProps) {
  const shell = tone === 'reversed' ? '#F7F5EF' : '#14532D';
  const head = tone === 'reversed' ? '#14532D' : '#F7F5EF';
  const gold = '#B78628';
  const wordmark = tone === 'reversed' ? '#F7F5EF' : '#14532D';
  const subMark = tone === 'reversed' ? '#E8C46A' : '#B78628';

  const mark = (
    <>
      <path
        d="M50 5 C69 5 84 28 84 55 C84 77 69 95 50 95 C31 95 16 77 16 55 C16 28 31 5 50 5 Z"
        fill={shell}
      />
      <g fill={gold}>
        <circle cx="39" cy="37" r="6" />
        <circle cx="48" cy="33" r="6.8" />
        <circle cx="57" cy="36.5" r="5.6" />
      </g>
      <path d="M60 49 L79 55.5 L60 62 Z" fill={gold} />
      <path d="M58 62 C64 62 65 72 58 74 C54 75 52 70 53 66 Z" fill={gold} />
      <circle cx="47" cy="55" r="15.5" fill={head} />
      <circle cx="53" cy="49.5" r="2.8" fill={shell} />
    </>
  );

  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 100 100"
        height={height ?? 40}
        width={height ?? 40}
        className={className}
        role="img"
        aria-label="ADRAH Farms"
      >
        {mark}
      </svg>
    );
  }

  // Width is set explicitly from the aspect ratio. Without it the <svg> stretches
  // to fill a flex or grid parent and preserveAspectRatio centres the artwork,
  // which silently breaks left alignment wherever the logo is placed.
  const h = height ?? 44;

  return (
    <svg
      viewBox="0 0 430 110"
      height={h}
      width={Math.round((h * 430) / 110)}
      className={className}
      role="img"
      aria-label="ADRAH Farms"
    >
      <g transform="translate(6,5)">{mark}</g>
      <text
        x="112"
        y="59"
        fontFamily="var(--font-sans)"
        fontSize="43"
        fontWeight="700"
        letterSpacing="1.5"
        fill={wordmark}
      >
        ADRAH
      </text>
      <text
        x="114"
        y="83"
        fontFamily="var(--font-sans)"
        fontSize="17"
        fontWeight="500"
        letterSpacing="8.8"
        fill={subMark}
      >
        FARMS
      </text>
    </svg>
  );
}
