import { useEffect } from "react";
import { StarIcon } from "./Icons";

export interface BannerShow {
  key: number;
  text: string;
  tone: "star" | "event";
}

const BANNER_MS = 2600;

// A big headline across the top of the board for moments that matter: a star, an
// event, a steal.
export function Banner({ banner, onDone }: { banner: BannerShow | null; onDone: () => void }) {
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(onDone, BANNER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.key]);
  if (!banner) return null;
  return (
    <div className="banner-wrap" aria-live="polite">
      <div key={banner.key} className={`banner ${banner.tone}`}>
        {banner.tone === "star" && <StarIcon />}
        <span>{banner.text}</span>
        {banner.tone === "star" && <StarIcon />}
      </div>
    </div>
  );
}
