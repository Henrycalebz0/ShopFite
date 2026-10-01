import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ShopFite home">
      <img className="brand-icon" src="/icon.svg" alt="" aria-hidden="true" />
      <span className="brand-name">shopfite<span className="brand-dot">.</span></span>
    </Link>
  );
}
